import { Injectable, Logger } from '@nestjs/common';
import { MetricType } from '@domain/enums/metric-type.enum';
import { MetricPipeline } from './metric-pipeline.interface';
import { PipelineContext } from './pipeline.context';
import { TrackingEsService } from '@modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service';
import { TransformerService } from '@modules/overlay-metrics-etl/transformer/transformer.service';
import { LoaderService } from '@modules/overlay-metrics-etl/loader/loader.service';

/**
 * Pipeline xử lý metric Transport — so sánh hiệu suất giữa các transport mode.
 *
 * Flow: extract (ES aggregation theo `labels.transport_mode`)
 *       → transform (tính render rate, p95)
 *       → load (persist TransportComparisonDto vào MongoDB).
 */
@Injectable()
export class TransportPipeline implements MetricPipeline {
  readonly type = MetricType.TRANSPORT;
  private readonly logger = new Logger(TransportPipeline.name);

  constructor(
    private readonly esService: TrackingEsService,
    private readonly transformerService: TransformerService,
    private readonly loaderService: LoaderService,
  ) {}

  /**
   * Thực thi toàn bộ ETL flow cho transport metric.
   * Dữ liệu rỗng sau transform sẽ được Loader tự động skip.
   */
  async execute(ctx: PipelineContext): Promise<void> {
    this.logger.debug(
      `TransportPipeline start — tenant=${ctx.tenantId} match=${ctx.matchId} timeline=${ctx.timelineId}`,
    );

    const { aggregations } = await this.esService.queryTransportComparison(
      ctx.query,
    );

    const items = this.transformerService.transformTransportComparison(
      aggregations,
      ctx,
    );

    await this.loaderService.load(ctx.tenantId, this.type, items);

    this.logger.debug(
      `TransportPipeline done — tenant=${ctx.tenantId} items=${items.length}`,
    );
  }
}
