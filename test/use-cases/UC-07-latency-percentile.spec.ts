import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { TrackingEsService } from '../../src/modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service';
import { TransformerService } from '../../src/modules/overlay-metrics-etl/transformer/transformer.service';
import { TransformContext } from '../../src/modules/overlay-metrics-etl/interfaces/transform-context.interface';
import { LatencyAggs } from '../../src/modules/overlay-metrics-etl/extractor/elasticsearch/types/tracking-es-aggs.types';
import {
  LatencyPercentileDto,
  PercentileSet,
  RenderDurationSet,
} from '../../src/domain/dto/latency-percentile.dto';

describe('UC-07 - Báo cáo latency percentile', () => {
  let moduleRef: TestingModule;
  let trackingEsService: TrackingEsService;
  let transformerService: TransformerService;
  let esServiceMock: { search: jest.Mock };

  const ctx: TransformContext = {
    timelineId: 'timeline-live-001',
    matchId: 'match-001',
    tenantId: 'tenant-001',
    intervalFrom: new Date('2026-05-13T10:00:00.000Z'),
    intervalTo: new Date('2026-05-13T10:05:00.000Z'),
  };

  const latencyAggs: LatencyAggs = {
    receive_latency: {
      values: { '50.0': 10, '75.0': 20, '95.0': 45, '99.0': 90 },
    },
    render_latency: {
      values: { '50.0': 55, '75.0': 75, '95.0': 120, '99.0': 210 },
    },
    ack_latency: {
      values: { '50.0': 2, '75.0': 4, '95.0': 9, '99.0': 15 },
    },
    receive_stats: { avg: 18.456, max: 100 },
    render_stats: { avg: 66.666, max: 250 },
    ack_stats: { avg: 3.333, max: 20 },
    render_duration: {
      values: { '50.0': 50, '75.0': 70, '95.0': 115, '99.0': 205 },
    },
  };

  beforeEach(async () => {
    esServiceMock = {
      search: jest.fn().mockResolvedValue({ aggregations: latencyAggs, took: 7 }),
    };

    const configValues: Record<string, unknown> = {
      'elasticsearch.trackingIndex': 'tracking-events-*',
      'elasticsearch.trackingTimeoutMs': 15000,
      'app.elasticApmEnvironment': 'production',
    };

    moduleRef = await Test.createTestingModule({
      providers: [
        TrackingEsService,
        TransformerService,
        { provide: ElasticsearchService, useValue: esServiceMock },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (key: string, defaultValue?: unknown) =>
                configValues[key] ?? defaultValue,
            ),
          },
        },
      ],
    }).compile();

    trackingEsService = moduleRef.get(TrackingEsService);
    transformerService = moduleRef.get(TransformerService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('mock ES trả về percentiles và queryLatency khai báo đúng aggregation p50/p75/p95/p99 + stats', async () => {
    const result = await trackingEsService.queryLatency({
      tenantId: ctx.tenantId,
      timelineIds: [ctx.timelineId],
      from: ctx.intervalFrom,
      to: ctx.intervalTo,
    });

    expect(result).toEqual({ aggregations: latencyAggs, took: 7 });
    expect(esServiceMock.search).toHaveBeenCalledTimes(1);

    const [request, options] = esServiceMock.search.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    const aggs = request.aggs as Record<string, unknown>;

    expect(request.index).toBe('tracking-events-*');
    expect(request.size).toBe(0);
    expect(options).toEqual({ requestTimeout: 15000 });
    expect(aggs.receive_latency).toEqual({
      percentiles: {
        field: 'numeric_labels.receive_latency_ms',
        percents: [50, 75, 95, 99],
      },
    });
    expect(aggs.render_latency).toEqual({
      percentiles: {
        field: 'numeric_labels.render_duration_ms',
        percents: [50, 75, 95, 99],
      },
    });
    expect(aggs.ack_latency).toEqual({
      percentiles: {
        field: 'numeric_labels.ack_latency_ms',
        percents: [50, 75, 95, 99],
      },
    });
    expect(aggs.receive_stats).toEqual({
      stats: { field: 'numeric_labels.receive_latency_ms' },
    });
    expect(aggs.render_stats).toEqual({
      stats: { field: 'numeric_labels.render_duration_ms' },
    });
    expect(aggs.ack_stats).toEqual({
      stats: { field: 'numeric_labels.ack_latency_ms' },
    });
  });

  it('transformLatency map đúng values["50.0"/"75.0"/"95.0"/"99.0"], stats.avg/max và renderDuration.avg từ render_stats.avg', () => {
    const dto: LatencyPercentileDto = transformerService.transformLatency(
      latencyAggs,
      ctx,
    );

    const expectedReceive: PercentileSet = {
      p50: 10,
      p75: 20,
      p95: 45,
      p99: 90,
      avg: 18.46,
      max: 100,
    };
    const expectedRender: PercentileSet = {
      p50: 55,
      p75: 75,
      p95: 120,
      p99: 210,
      avg: 66.67,
      max: 250,
    };
    const expectedAck: PercentileSet = {
      p50: 2,
      p75: 4,
      p95: 9,
      p99: 15,
      avg: 3.33,
      max: 20,
    };
    const expectedRenderDuration: RenderDurationSet = {
      p50: 50,
      p95: 115,
      p99: 205,
      avg: 66.67,
    };

    expect(dto).toMatchObject({
      timelineId: ctx.timelineId,
      matchId: ctx.matchId,
      tenantId: ctx.tenantId,
      intervalFrom: ctx.intervalFrom,
      intervalTo: ctx.intervalTo,
    });
    expect(dto.receive).toEqual(expectedReceive);
    expect(dto.render).toEqual(expectedRender);
    expect(dto.ack).toEqual(expectedAck);
    expect(dto.renderDuration).toEqual(expectedRenderDuration);

    // renderDuration.avg phải lấy từ stats.avg của render_stats, không lấy từ render_latency percentile.
    expect(dto.renderDuration.avg).toBe(dto.render.avg);
    expect(dto.renderDuration.avg).not.toBe(latencyAggs.render_latency?.values['50.0']);
  });

  it('edge case: thiếu percentile keys hoặc stats thì default về 0', () => {
    const edgeAggs: LatencyAggs = {
      receive_latency: { values: { '50.0': null, '75.0': 12 } },
      render_latency: { values: {} },
      ack_latency: { values: { '95.0': 8 } },
      render_duration: { values: { '50.0': 40, '95.0': null } },
    };

    const dto = transformerService.transformLatency(edgeAggs, ctx);

    expect(dto.receive).toEqual({
      p50: 0,
      p75: 12,
      p95: 0,
      p99: 0,
      avg: 0,
      max: 0,
    });
    expect(dto.render).toEqual({
      p50: 0,
      p75: 0,
      p95: 0,
      p99: 0,
      avg: 0,
      max: 0,
    });
    expect(dto.ack).toEqual({
      p50: 0,
      p75: 0,
      p95: 8,
      p99: 0,
      avg: 0,
      max: 0,
    });
    expect(dto.renderDuration).toEqual({
      p50: 40,
      p95: 0,
      p99: 0,
      avg: 0,
    });
  });
});
