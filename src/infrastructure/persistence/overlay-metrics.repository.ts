import { Injectable } from '@nestjs/common';
import { AnyBulkWriteOperation } from 'mongodb';
import { MetricType } from '@domain/enums/metric-type.enum';
import { UNIQUE_FIELDS, INC_FIELDS, SORT_FIELDS } from './metric-meta';
import { TenantModelFactory } from './tenant-model.factory';

/**
 * Repository trung gian cho toàn bộ 7 collections overlay metrics.
 * Tách biệt persistence logic (bulkWrite, find) khỏi ETL pipeline và Read API
 * để dễ thay đổi storage strategy sau này (ví dụ: thêm cache layer, đổi DB).
 *
 * Upsert logic: accumulate raw counts ($inc) thay vì ghi đè ($set).
 * Điều này cho phép chạy ETL nhiều lần cho cùng matchId mà không mất data.
 * Derived metrics (rate, percentile) vẫn được $set với giá trị mới nhất.
 */
@Injectable()
export class OverlayMetricsRepository {
  constructor(private readonly tenantModelFactory: TenantModelFactory) {}

  /**
   * Upsert accumulate: cộng dồn raw counts ($inc) và ghi đè derived metrics ($set).
   * Dùng trong ETL pipeline để aggregate data từ nhiều timelines vào cùng match record.
   * Mỗi metric type có composite unique key riêng (ví dụ: tenant + match + platform + interval).
   * Model được lấy động qua TenantModelFactory theo tenantId để đảm bảo cách ly dữ liệu.
   */
  async upsert(
    tenantId: string,
    type: MetricType,
    items: Record<string, unknown>[],
  ): Promise<void> {
    if (!items.length) return;
    const model = await this.tenantModelFactory.getModelByType(tenantId, type);
    const ops = this.buildUpsertOps(
      items,
      UNIQUE_FIELDS[type],
      INC_FIELDS[type],
    );
    await model.bulkWrite(ops, { ordered: false });
  }

  /**
   * Query metrics từ MongoDB để phục vụ API read.
   * Sort mặc định theo thờ gian mới nhất để UI hiển thị interval gần nhất trước.
   * Model được lấy động qua TenantModelFactory theo tenantId để đảm bảo cách ly dữ liệu.
   */
  async find<T = unknown>(
    tenantId: string,
    type: MetricType,
    filter: Record<string, unknown>,
  ): Promise<T[]> {
    const model = await this.tenantModelFactory.getModelByType(tenantId, type);
    const sortField = SORT_FIELDS[type];
    return model
      .find(filter)
      .sort({ [sortField]: -1 })
      .lean()
      .exec() as Promise<T[]>;
  }

  /**
   * Build MongoDB bulkWrite operations cho accumulate upsert.
   * - $inc: cộng dồn raw counts (sent, received, rendered, failed, count, value)
   * - $set: ghi đè derived metrics và metadata (rate, percentile, platform, v.v.)
   * - $setOnInsert: chỉ set createdAt khi insert mới
   * - $currentDate: luôn refresh updatedAt
   */
  private buildUpsertOps<T extends object>(
    items: T[],
    uniqueFields: string[],
    incFields: string[],
  ): AnyBulkWriteOperation<any>[] {
    return items.map((item) => {
      const record = item as Record<string, unknown>;
      const filter: Record<string, unknown> = {};

      for (const field of uniqueFields) {
        if (record[field] === undefined || record[field] === null) {
          throw new Error(
            `Missing unique field "${field}" required for upsert filter`,
          );
        }
        filter[field] = record[field];
      }

      const $inc: Record<string, number> = {};
      const $set: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(record)) {
        if (value === undefined) continue;

        if (incFields.includes(key) && typeof value === 'number') {
          $inc[key] = value;
        } else {
          $set[key] = value;
        }
      }

      const update: Record<string, unknown> = {
        $setOnInsert: { createdAt: new Date() },
        $currentDate: { updatedAt: true },
      };

      if (Object.keys($inc).length > 0) {
        update.$inc = $inc;
      }
      if (Object.keys($set).length > 0) {
        update.$set = $set;
      }

      return {
        updateOne: {
          filter,
          update,
          upsert: true,
        },
      };
    });
  }
}
