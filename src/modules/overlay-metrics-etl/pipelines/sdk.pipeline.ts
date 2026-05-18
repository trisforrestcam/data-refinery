import { Injectable, Logger } from '@nestjs/common';
import { MetricType } from '@domain/enums/metric-type.enum';
import { MetricPipeline } from './metric-pipeline.interface';
import { PipelineContext } from './pipeline.context';
import { TrackingEsService } from '@modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service';
import { TransformerService } from '@modules/overlay-metrics-etl/transformer/transformer.service';
import { LoaderService } from '@modules/overlay-metrics-etl/loader/loader.service';

/**
 * Pipeline xử lý metric SDK — phân bố version và hiệu suất render theo SDK.
 *
 * Flow: extract (ES aggregation theo `labels.sdk_version`)
 *       → transform (tính render rate, avg render ms)
 *       → load (persist SdkVersionDto vào MongoDB).
 */
@Injectable()
export class SdkPipeline implements MetricPipeline {
  readonly type = MetricType.SDK;
  private readonly logger = new Logger(SdkPipeline.name);

  constructor(
    private readonly esService: TrackingEsService,
    private readonly transformerService: TransformerService,
    private readonly loaderService: LoaderService,
  ) {}

  /**
   * Thực thi toàn bộ ETL flow cho SDK metric.
   * Dữ liệu rỗng sau transform sẽ được Loader tự động skip.
   */
  async execute(ctx: PipelineContext): Promise<void> {
    this.logger.debug(
      `SdkPipeline start — tenant=${ctx.tenantId} match=${ctx.matchId} timeline=${ctx.timelineId}`,
    );

    const { aggregations } = await this.esService.querySdkVersions(ctx.query);

    const items = this.transformerService.transformSdkVersions(
      aggregations,
      ctx,
    );

    await this.loaderService.load(ctx.tenantId, this.type, items);

    this.logger.debug(
      `SdkPipeline done — tenant=${ctx.tenantId} items=${items.length}`,
    );
  }
}
