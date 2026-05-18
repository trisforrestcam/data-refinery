import { Injectable } from '@nestjs/common';
import { MetricType } from '@domain/enums/metric-type.enum';
import { TrackingEsService } from '@modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service';
import { TransformerService } from '@modules/overlay-metrics-etl/transformer/transformer.service';
import { LoaderService } from '@modules/overlay-metrics-etl/loader/loader.service';
import { MetricPipeline } from './metric-pipeline.interface';
import { PipelineContext } from './pipeline.context';

/**
 * Pipeline xử lý metric DEVICE theo pattern extract → transform → load.
 * Chạy 3 ES aggregation queries theo các dimensions browser, os, deviceClass
 * và persist tất cả DTOs vào MongoDB.
 */
@Injectable()
export class DevicePipeline implements MetricPipeline {
  readonly type = MetricType.DEVICE;

  constructor(
    private readonly extractor: TrackingEsService,
    private readonly transformer: TransformerService,
    private readonly loader: LoaderService,
  ) {}

  /**
   * Chạy toàn bộ flow ETL cho device breakdown.
   * Lặp qua từng dimension để query ES, transform aggregation thành DTOs, rồi upsert vào DB.
   */
  async execute(ctx: PipelineContext): Promise<void> {
    const dimensions = ['browser', 'os', 'deviceClass'] as const;

    for (const dimension of dimensions) {
      const result = await this.extractor.queryDeviceBreakdown(
        ctx.query,
        dimension,
      );
      const data = this.transformer.transformDeviceBreakdown(
        result.aggregations,
        ctx,
        dimension,
      );
      await this.loader.load(ctx.tenantId, this.type, data);
    }
  }
}
