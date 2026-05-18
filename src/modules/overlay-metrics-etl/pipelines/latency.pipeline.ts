import { Injectable, Logger } from '@nestjs/common';
import { MetricType } from '@domain/enums/metric-type.enum';
import { MetricPipeline } from './metric-pipeline.interface';
import { PipelineContext } from './pipeline.context';
import { TrackingEsService } from '@modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service';
import { TransformerService } from '@modules/overlay-metrics-etl/transformer/transformer.service';
import { LoaderService } from '@modules/overlay-metrics-etl/loader/loader.service';

/**
 * Pipeline xử lý metric LATENCY — extract percentiles từ ES,
 * transform thành 1 object duy nhất, rồi load vào MongoDB dưới dạng array 1 phần tử.
 */
@Injectable()
export class LatencyPipeline implements MetricPipeline {
  readonly type = MetricType.LATENCY;

  private readonly logger = new Logger(LatencyPipeline.name);

  constructor(
    private readonly trackingEsService: TrackingEsService,
    private readonly transformerService: TransformerService,
    private readonly loaderService: LoaderService,
  ) {}

  /**
   * Thực thi ETL cho latency: query ES → transform single DTO → load [dto].
   * Nếu không có aggregation data vẫn transform (trả về object zero-value) để đảm bảo
   * mỗi timeline luôn có 1 document latency, không bị thiếu dữ liệu.
   */
  async execute(ctx: PipelineContext): Promise<void> {
    this.logger.debug(
      `LatencyPipeline start — tenant=${ctx.tenantId} match=${ctx.matchId} timeline=${ctx.timelineId}`,
    );

    const result = await this.trackingEsService.queryLatency(ctx.query);
    const data = this.transformerService.transformLatency(
      result.aggregations,
      ctx,
    );

    await this.loaderService.load(ctx.tenantId, this.type, [data]);

    this.logger.debug(
      `LatencyPipeline done — tenant=${ctx.tenantId} match=${ctx.matchId} timeline=${ctx.timelineId}`,
    );
  }
}
