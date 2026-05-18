import { Injectable } from '@nestjs/common';
import { MetricType } from '@domain/enums/metric-type.enum';
import { TrackingEsService } from '@modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service';
import { TransformerService } from '@modules/overlay-metrics-etl/transformer/transformer.service';
import { LoaderService } from '@modules/overlay-metrics-etl/loader/loader.service';
import { MetricPipeline } from './metric-pipeline.interface';
import { PipelineContext } from './pipeline.context';

/**
 * Pipeline xử lý metric PLATFORM theo pattern extract → transform → load.
 * Thực thi 1 ES aggregation query platform và persist DTOs vào MongoDB.
 */
@Injectable()
export class PlatformPipeline implements MetricPipeline {
  readonly type = MetricType.PLATFORM;

  constructor(
    private readonly extractor: TrackingEsService,
    private readonly transformer: TransformerService,
    private readonly loader: LoaderService,
  ) {}

  /**
   * Chạy toàn bộ flow ETL cho platform metrics.
   * Query ES theo timeline, transform aggregation thành DTOs, rồi upsert vào DB.
   */
  async execute(ctx: PipelineContext): Promise<void> {
    const result = await this.extractor.queryPlatformMetrics(ctx.query);
    const data = this.transformer.transformPlatformMetrics(
      result.aggregations,
      ctx,
    );
    await this.loader.load(ctx.tenantId, this.type, data);
  }
}
