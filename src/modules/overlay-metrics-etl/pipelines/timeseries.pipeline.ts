import { Injectable, Logger } from '@nestjs/common';
import { MetricType } from '@domain/enums/metric-type.enum';
import { MetricPipeline } from './metric-pipeline.interface';
import { PipelineContext } from './pipeline.context';
import { TrackingEsService } from '@modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service';
import { TransformerService } from '@modules/overlay-metrics-etl/transformer/transformer.service';
import { LoaderService } from '@modules/overlay-metrics-etl/loader/loader.service';

/**
 * Pipeline xử lý metric TIMESERIES — chạy 5 metric riêng biệt
 * (sent, received, rendered, failed, avgRenderMs) với interval 5 phút.
 * Mỗi metric trả về 1 array TimeseriesPointDto, load ngay sau khi transform.
 */
@Injectable()
export class TimeseriesPipeline implements MetricPipeline {
  readonly type = MetricType.TIMESERIES;

  private readonly logger = new Logger(TimeseriesPipeline.name);

  private static readonly METRICS: string[] = [
    'sent',
    'received',
    'rendered',
    'failed',
    'avgRenderMs',
  ];

  private static readonly INTERVAL = '5m';

  constructor(
    private readonly trackingEsService: TrackingEsService,
    private readonly transformerService: TransformerService,
    private readonly loaderService: LoaderService,
  ) {}

  /**
   * Thực thi ETL cho timeseries: lặp qua 5 metric, mỗi metric query ES riêng,
   * transform thành TimeseriesPointDto[], rồi load vào MongoDB.
   * Nếu 1 metric lỗi thì throw để Kafka consumer retry hoặc DLQ.
   */
  async execute(ctx: PipelineContext): Promise<void> {
    this.logger.debug(
      `TimeseriesPipeline start — tenant=${ctx.tenantId} match=${ctx.matchId} timeline=${ctx.timelineId}`,
    );

    for (const metric of TimeseriesPipeline.METRICS) {
      this.logger.debug(
        `TimeseriesPipeline metric=${metric} — tenant=${ctx.tenantId} match=${ctx.matchId} timeline=${ctx.timelineId}`,
      );

      const result = await this.trackingEsService.queryTimeseries(
        ctx.query,
        metric,
        TimeseriesPipeline.INTERVAL,
      );
      const data = this.transformerService.transformTimeseries(
        result.aggregations,
        ctx,
        metric,
        TimeseriesPipeline.INTERVAL,
      );

      await this.loaderService.load(ctx.tenantId, this.type, data);
    }

    this.logger.debug(
      `TimeseriesPipeline done — tenant=${ctx.tenantId} match=${ctx.matchId} timeline=${ctx.timelineId}`,
    );
  }
}
