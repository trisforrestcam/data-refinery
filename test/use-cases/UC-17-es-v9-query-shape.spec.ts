import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { TrackingEsService } from '../../src/modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service';
import type { TrackingAggQuery } from '../../src/modules/overlay-metrics-etl/extractor/dto/tracking-agg-query.dto';

const INDEX = 'tracking-events-v9-shape-test';
const REQUEST_TIMEOUT = 54321;
const ENVIRONMENT = 'staging';

const fullQuery: TrackingAggQuery = {
  tenantId: 'tenant-uc-17',
  timelineIds: ['timeline-1', 'timeline-2'],
  mediaContentId: 'match-uc-17',
  from: new Date('2026-05-13T10:00:00.000Z'),
  to: new Date('2026-05-13T10:05:00.000Z'),
  platform: 'web',
};

const expectedBaseQuery = {
  bool: {
    must: [
      { term: { 'labels.tenant_id': fullQuery.tenantId } },
      { term: { 'labels.environment': ENVIRONMENT } },
      { terms: { 'labels.timeline_id': fullQuery.timelineIds } },
      { term: { 'labels.media_content_id': fullQuery.mediaContentId } },
      {
        range: {
          '@timestamp': {
            gte: fullQuery.from?.toISOString(),
            lt: fullQuery.to?.toISOString(),
          },
        },
      },
      { term: { 'labels.platform': fullQuery.platform } },
    ],
  },
};

type SearchCall = [Record<string, unknown>, Record<string, unknown> | undefined];

describe('UC-17 ES v9 query shape use case', () => {
  let moduleRef: TestingModule;
  let trackingEsService: TrackingEsService;
  let esSearchMock: jest.Mock;

  beforeEach(async () => {
    esSearchMock = jest.fn().mockResolvedValue({ aggregations: {}, took: 1 });

    moduleRef = await Test.createTestingModule({
      providers: [
        TrackingEsService,
        {
          provide: ElasticsearchService,
          useValue: { search: esSearchMock },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown): unknown => {
              const values: Record<string, unknown> = {
                'elasticsearch.trackingIndex': INDEX,
                'elasticsearch.trackingTimeoutMs': REQUEST_TIMEOUT,
                'app.elasticApmEnvironment': ENVIRONMENT,
              };

              return values[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    trackingEsService = moduleRef.get(TrackingEsService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  const expectFlatSearchRequest = (expectedRequest: Record<string, unknown>) => {
    expect(esSearchMock).toHaveBeenCalledTimes(1);

    const [request, options] = esSearchMock.mock.calls[0] as SearchCall;

    expect(request).toEqual(expectedRequest);
    expect(request).not.toHaveProperty('body');
    expect(options).toEqual({ requestTimeout: REQUEST_TIMEOUT });
  };

  it('buildBaseQuery builds bool.must and only adds optional filters when values exist', () => {
    const buildBaseQuery = (
      trackingEsService as unknown as {
        buildBaseQuery: (query: TrackingAggQuery) => Record<string, unknown>;
      }
    ).buildBaseQuery.bind(trackingEsService);

    expect(buildBaseQuery(fullQuery)).toEqual(expectedBaseQuery);

    expect(
      buildBaseQuery({
        tenantId: 'tenant-minimal',
        timelineIds: [],
        mediaContentId: '',
        platform: '',
      }),
    ).toEqual({
      bool: {
        must: [
          { term: { 'labels.tenant_id': 'tenant-minimal' } },
          { term: { 'labels.environment': ENVIRONMENT } },
        ],
      },
    });

    expect(
      buildBaseQuery({
        tenantId: 'tenant-from-only',
        from: fullQuery.from,
      }),
    ).toEqual({
      bool: {
        must: [
          { term: { 'labels.tenant_id': 'tenant-from-only' } },
          { term: { 'labels.environment': ENVIRONMENT } },
          {
            range: {
              '@timestamp': {
                gte: fullQuery.from?.toISOString(),
              },
            },
          },
        ],
      },
    });

    expect(
      buildBaseQuery({
        tenantId: 'tenant-to-only',
        to: fullQuery.to,
      }),
    ).toEqual({
      bool: {
        must: [
          { term: { 'labels.tenant_id': 'tenant-to-only' } },
          { term: { 'labels.environment': ENVIRONMENT } },
          {
            range: {
              '@timestamp': {
                lt: fullQuery.to?.toISOString(),
              },
            },
          },
        ],
      },
    });
  });

  it('queryPlatformMetrics sends flat ES v9 params with platform aggregations', async () => {
    await trackingEsService.queryPlatformMetrics(fullQuery);

    expectFlatSearchRequest({
      index: INDEX,
      size: 0,
      query: expectedBaseQuery,
      aggs: {
        platforms: {
          terms: {
            field: 'labels.platform',
            size: 100,
            missing: 'unknown',
          },
          aggs: {
            sent: {
              filter: { term: { 'labels.stage': 'sent' } },
              aggs: {
                room_size_sum: {
                  sum: { field: 'numeric_labels.room_size' },
                },
              },
            },
            received: {
              filter: { term: { 'labels.stage': 'received' } },
            },
            rendered: {
              filter: { term: { 'labels.stage': 'rendered' } },
              aggs: {
                avg_render_ms: {
                  avg: { field: 'numeric_labels.render_duration_ms' },
                },
              },
            },
            failed: {
              filter: { term: { 'labels.stage': 'render-failed' } },
            },
          },
        },
      },
    });
  });

  it.each([
    ['browser', 'labels.browser'],
    ['os', 'labels.client_os'],
    ['deviceClass', 'labels.device_class'],
  ])(
    'queryDeviceBreakdown uses %s dimension field and by_stage filters',
    async (dimension: string, expectedField: string) => {
      await trackingEsService.queryDeviceBreakdown(fullQuery, dimension);

      expectFlatSearchRequest({
        index: INDEX,
        size: 0,
        query: expectedBaseQuery,
        aggs: {
          by_dimension: {
            terms: {
              field: expectedField,
              size: 50,
              missing: 'unknown',
            },
            aggs: {
              by_stage: {
                filters: {
                  filters: {
                    received: { term: { 'labels.stage': 'received' } },
                    rendered: { term: { 'labels.stage': 'rendered' } },
                    failed: { term: { 'labels.stage': 'render-failed' } },
                  },
                },
                aggs: {
                  avg_render_ms: {
                    avg: { field: 'numeric_labels.render_duration_ms' },
                  },
                },
              },
            },
          },
        },
      });
    },
  );

  it('queryTransportComparison sends transport terms aggregation with p95 percentile', async () => {
    await trackingEsService.queryTransportComparison(fullQuery);

    expectFlatSearchRequest({
      index: INDEX,
      size: 0,
      query: expectedBaseQuery,
      aggs: {
        by_transport: {
          terms: {
            field: 'labels.transport_mode',
            size: 10,
            missing: 'unknown',
          },
          aggs: {
            by_stage: {
              filters: {
                filters: {
                  received: { term: { 'labels.stage': 'received' } },
                  rendered: { term: { 'labels.stage': 'rendered' } },
                },
              },
              aggs: {
                avg_render_ms: {
                  avg: { field: 'numeric_labels.render_duration_ms' },
                },
                p95_render_ms: {
                  percentiles: {
                    field: 'numeric_labels.render_duration_ms',
                    percents: [95],
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('querySdkVersions sends sdk version terms aggregation', async () => {
    await trackingEsService.querySdkVersions(fullQuery);

    expectFlatSearchRequest({
      index: INDEX,
      size: 0,
      query: expectedBaseQuery,
      aggs: {
        by_sdk_version: {
          terms: {
            field: 'labels.sdk_version',
            size: 50,
            missing: 'unknown',
          },
          aggs: {
            by_stage: {
              filters: {
                filters: {
                  received: { term: { 'labels.stage': 'received' } },
                  rendered: { term: { 'labels.stage': 'rendered' } },
                },
              },
              aggs: {
                avg_render_ms: {
                  avg: { field: 'numeric_labels.render_duration_ms' },
                },
              },
            },
          },
        },
      },
    });
  });

  it('queryFailures sends failure reason terms aggregation with nested by_step terms', async () => {
    await trackingEsService.queryFailures(fullQuery);

    expectFlatSearchRequest({
      index: INDEX,
      size: 0,
      query: expectedBaseQuery,
      aggs: {
        by_reason: {
          terms: { field: 'labels.failure_reason', size: 50 },
          aggs: {
            by_step: {
              terms: { field: 'labels.failure_step', size: 20 },
            },
          },
        },
      },
    });
  });

  it('queryLatency sends percentile and stats aggregations in flat ES v9 shape', async () => {
    await trackingEsService.queryLatency(fullQuery);

    expectFlatSearchRequest({
      index: INDEX,
      size: 0,
      query: expectedBaseQuery,
      aggs: {
        receive_latency: {
          percentiles: {
            field: 'numeric_labels.receive_latency_ms',
            percents: [50, 75, 95, 99],
          },
        },
        render_latency: {
          percentiles: {
            field: 'numeric_labels.render_duration_ms',
            percents: [50, 75, 95, 99],
          },
        },
        ack_latency: {
          percentiles: {
            field: 'numeric_labels.ack_latency_ms',
            percents: [50, 75, 95, 99],
          },
        },
        receive_stats: {
          stats: { field: 'numeric_labels.receive_latency_ms' },
        },
        render_stats: {
          stats: { field: 'numeric_labels.render_duration_ms' },
        },
        ack_stats: {
          stats: { field: 'numeric_labels.ack_latency_ms' },
        },
        render_duration: {
          percentiles: {
            field: 'numeric_labels.render_duration_ms',
            percents: [50, 95, 99],
          },
        },
        render_duration_stats: {
          stats: { field: 'numeric_labels.render_duration_ms' },
        },
      },
    });
  });

  it.each([
    ['sent', { sum: { field: 'numeric_labels.room_size' } }],
    ['received', { filter: { term: { 'labels.stage': 'received' } } }],
    ['rendered', { filter: { term: { 'labels.stage': 'rendered' } } }],
    ['failed', { filter: { term: { 'labels.stage': 'render-failed' } } }],
    [
      'avgRenderMs',
      { avg: { field: 'numeric_labels.render_duration_ms' } },
    ],
  ])(
    'queryTimeseries uses fixed_interval and metric_value agg for %s',
    async (metric: string, expectedMetricAgg: Record<string, unknown>) => {
      await trackingEsService.queryTimeseries(fullQuery, metric, '5m');

      expectFlatSearchRequest({
        index: INDEX,
        size: 0,
        query: expectedBaseQuery,
        aggs: {
          timeseries: {
            date_histogram: {
              field: '@timestamp',
              fixed_interval: '5m',
            },
            aggs: {
              metric_value: expectedMetricAgg,
            },
          },
        },
      });
    },
  );
});
