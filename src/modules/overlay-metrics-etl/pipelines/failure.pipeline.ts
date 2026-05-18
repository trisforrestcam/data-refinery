import { Injectable, Logger } from '@nestjs/common';
import { MetricType } from '@domain/enums/metric-type.enum';
import { MetricPipeline } from './metric-pipeline.interface';
import { PipelineContext } from './pipeline.context';
import { TrackingEsService } from '@modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service';
import { TransformerService } from '@modules/overlay-metrics-etl/transformer/transformer.service';
import { LoaderService } from '@modules/overlay-metrics-etl/loader/loader.service';

/**
 * Pipeline xử lý metric Failure — phân tích lý do và bước xảy ra lỗi.
 *
 * Flow: extract (ES aggregation theo `labels.failure_reason` × `labels.failure_step`)
 *       → transform (tính percentOfFailed)
 *       → load (persist FailureAnalysisDto vào MongoDB).
 */
@Injectable()
export class FailurePipeline implements MetricPipeline {
  readonly type = MetricType.FAILURE;
  private readonly logger = new Logger(FailurePipeline.name);

  constructor(
    private readonly esService: TrackingEsService,
    private readonly transformerService: TransformerService,
    private readonly loaderService: LoaderService,
  ) {}

  /**
   * Thực thi toàn bộ ETL flow cho failure metric.
   * Dữ liệu rỗng sau transform sẽ được Loader tự động skip.
   */
  async execute(ctx: PipelineContext): Promise<void> {
    this.logger.debug(
      `FailurePipeline start — tenant=${ctx.tenantId} match=${ctx.matchId} timeline=${ctx.timelineId}`,
    );

    const { aggregations } = await this.esService.queryFailures(ctx.query);

    const items = this.transformerService.transformFailures(aggregations, ctx);

    await this.loaderService.load(ctx.tenantId, this.type, items);

    this.logger.debug(
      `FailurePipeline done — tenant=${ctx.tenantId} items=${items.length}`,
    );
  }
}
