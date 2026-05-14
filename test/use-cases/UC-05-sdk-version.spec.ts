import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { TrackingEsService } from '../../src/modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service';
import type { SdkVersionAggs } from '../../src/modules/overlay-metrics-etl/extractor/elasticsearch/types/tracking-es-aggs.types';
import { SdkVersionDto } from '../../src/domain/dto/sdk-version.dto';
import { TransformerService } from '../../src/modules/overlay-metrics-etl/transformer/transformer.service';
import type { TransformContext } from '../../src/modules/overlay-metrics-etl/transformer/transformer.service';

const ctx: TransformContext = {
  timelineId: 'timeline-uc-05',
  matchId: 'match-uc-05',
  tenantId: 'tenant-uc-05',
  intervalFrom: new Date('2026-05-13T10:00:00.000Z'),
  intervalTo: new Date('2026-05-13T10:05:00.000Z'),
};

const makeSdkBucket = (
  key: string,
  docCount: number,
  received: number,
  rendered: number,
  avgRenderMs: number | null,
) => ({
  key,
  doc_count: docCount,
  by_stage: {
    buckets: {
      received: { doc_count: received },
      rendered: {
        doc_count: rendered,
        avg_render_ms: { value: avgRenderMs },
      },
    },
  },
});

type SdkVersionSearchRequest = {
  index: string;
  aggs: {
    by_sdk_version: {
      terms: unknown;
      aggs: {
        by_stage: {
          filters: {
            filters: unknown;
          };
        };
      };
    };
  };
};

describe('UC-05 - Phân bố phiên bản SDK cho viewer', () => {
  let moduleRef: TestingModule;
  let trackingEsService: TrackingEsService;
  let transformerService: TransformerService;
  let esSearchMock: jest.Mock;

  beforeEach(async () => {
    esSearchMock = jest.fn();

    moduleRef = await Test.createTestingModule({
      providers: [
        TrackingEsService,
        TransformerService,
        {
          provide: ElasticsearchService,
          useValue: { search: esSearchMock },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown): unknown => {
              const values: Record<string, unknown> = {
                'elasticsearch.trackingIndex': 'tracking-events-test',
                'elasticsearch.trackingTimeoutMs': 12345,
                'app.elasticApmEnvironment': 'test',
              };

              return values[key] ?? defaultValue;
            }),
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

  it('mock ES trả về 5 SDK versions và transform đúng SdkVersionDto', async () => {
    const aggregations: SdkVersionAggs = {
      by_sdk_version: {
        buckets: [
          makeSdkBucket('1.0.0', 100, 100, 90, 110.123),
          makeSdkBucket('1.1.0', 200, 160, 120, 95.5),
          makeSdkBucket('2.0.0', 300, 300, 210, 80),
          makeSdkBucket('2.1.0', 400, 250, 200, 70.777),
          makeSdkBucket('3.0.0', 500, 500, 400, 65),
        ],
      },
    };

    esSearchMock.mockResolvedValueOnce({ aggregations, took: 9 });

    const result = await trackingEsService.querySdkVersions({
      tenantId: ctx.tenantId,
      timelineIds: [ctx.timelineId],
      from: ctx.intervalFrom,
      to: ctx.intervalTo,
    });

    const [searchRequest, searchOptions] = esSearchMock.mock.calls[0] as [
      SdkVersionSearchRequest,
      Record<string, unknown>,
    ];

    expect(searchOptions).toEqual({ requestTimeout: 12345 });
    expect(searchRequest.index).toBe('tracking-events-test');
    expect(searchRequest.aggs.by_sdk_version.terms).toEqual({
      field: 'labels.sdk_version',
      size: 50,
      missing: 'unknown',
    });
    expect(
      searchRequest.aggs.by_sdk_version.aggs.by_stage.filters.filters,
    ).toEqual({
      received: { term: { 'labels.stage': 'received' } },
      rendered: { term: { 'labels.stage': 'rendered' } },
    });

    const transformed = transformerService.transformSdkVersions(
      result.aggregations,
      ctx,
    );
    const firstDto: SdkVersionDto = transformed[0];

    expect(firstDto).toMatchObject({
      timelineId: ctx.timelineId,
      matchId: ctx.matchId,
      tenantId: ctx.tenantId,
      sdkVersion: '1.0.0',
      count: 100,
      renderRate: 90,
      avgRenderMs: 110.12,
      intervalFrom: ctx.intervalFrom,
      intervalTo: ctx.intervalTo,
    });
    expect(transformed).toHaveLength(5);
    expect(transformed.map((item) => item.sdkVersion)).toEqual([
      '1.0.0',
      '1.1.0',
      '2.0.0',
      '2.1.0',
      '3.0.0',
    ]);
    expect(transformed.map((item) => item.count)).toEqual([
      100, 200, 300, 400, 500,
    ]);
    expect(transformed.map((item) => item.renderRate)).toEqual([
      90, 75, 70, 80, 80,
    ]);
    expect(transformed.map((item) => item.avgRenderMs)).toEqual([
      110.12, 95.5, 80, 70.78, 65,
    ]);
  });

  it("edge case: sdk_version missing được gom thành 'unknown' và doc_count=0", () => {
    const aggregations: SdkVersionAggs = {
      by_sdk_version: {
        buckets: [makeSdkBucket('', 0, 0, 0, null)],
      },
    };

    const [dto] = transformerService.transformSdkVersions(aggregations, ctx);
    const typedDto: SdkVersionDto = dto;

    expect(typedDto).toMatchObject({
      sdkVersion: 'unknown',
      count: 0,
      renderRate: 0,
      avgRenderMs: 0,
      intervalFrom: ctx.intervalFrom,
      intervalTo: ctx.intervalTo,
    });
  });
});
