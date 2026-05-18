import { Injectable, Logger } from '@nestjs/common';
import { OverlayMetricsRepository } from '@infrastructure/persistence/overlay-metrics.repository';
import { MetricType } from '@domain/enums/metric-type.enum';

/**
 * Loader nhận DTOs đã transform từ TransformerService và persist vào MongoDB.
 * Là tầng cuối cùng của ETL pipeline, chỉ delegate cho Repository để giữ sạch business logic.
 *
 * Dùng generic `load()` thay vì 7 method riêng lẻ để tránh duplicate code.
 * Type safety được đảm bảo ở Transformer layer — Loader chỉ là dumb persist.
 */
@Injectable()
export class LoaderService {
  private readonly logger = new Logger(LoaderService.name);

  constructor(private readonly repository: OverlayMetricsRepository) {}

  /**
   * Persist bất kỳ metric type nào vào MongoDB qua Repository.
   * Nếu items rỗng thì skip để tránh query vô nghĩa.
   */
  async load(
    tenantId: string,
    type: MetricType,
    items: unknown[],
  ): Promise<void> {
    if (!items.length) return;
    await this.repository.upsert(
      tenantId,
      type,
      items as Record<string, unknown>[],
    );
    this.logger.log(`Upserted ${items.length} ${type} metrics`);
  }
}
