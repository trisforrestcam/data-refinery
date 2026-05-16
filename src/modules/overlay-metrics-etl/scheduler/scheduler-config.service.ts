import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SchedulerTarget } from '@domain/schemas/scheduler-target.schema';
import { TenantCacheService } from '@common/modules/tenant-cache/tenant-cache.service';

/**
 * Interface định nghĩa cấu hình scheduler cho một match đang live.
 */
export interface SchedulerTargetConfig {
  tenantId: string;
  matchId: string;
  timelineIds: string[];
  enabled: boolean;
}

/**
 * Service quản lý cấu hình scheduler targets.
 * Ưu tiên đọc từ MongoDB collection `scheduler_targets`, fallback về env vars nếu không có.
 * Cho phép quản lý động nhiều match/timeline mà không cần restart service.
 */
@Injectable()
export class SchedulerConfigService {
  private readonly logger = new Logger(SchedulerConfigService.name);

  constructor(
    @InjectModel(SchedulerTarget.name)
    private readonly targetModel: Model<SchedulerTarget>,
    private readonly tenantCache: TenantCacheService,
  ) {}

  /**
   * Lấy danh sách targets đang active từ DB.
   * Targets được lọc theo OVERLAY_METRICS_TENANT_ID env var (nếu có) và validate tenant tồn tại trong cache.
   */
  async getActiveTargets(): Promise<SchedulerTargetConfig[]> {
    let targets: SchedulerTargetConfig[];

    try {
      const dbTargets = await this.targetModel
        .find({ enabled: true })
        .lean()
        .exec();

      targets = dbTargets.map((t) => ({
        tenantId: t.tenantId,
        matchId: t.matchId,
        timelineIds: t.timelineIds,
        enabled: t.enabled,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to read scheduler targets from DB: ${(error as Error).message}.`,
      );
      throw error;
    }


    targets = targets.filter((t) => {
      if (!this.tenantCache.has(t.tenantId)) {
        this.logger.warn(
          `Tenant ${t.tenantId} not found in cache, skipping target for match ${t.matchId}`,
        );
        return false;
      }
      return true;
    });

    return targets;
  }

  /**
   * Thêm hoặc cập nhật target trong DB.
   */
  async upsertTarget(target: Omit<SchedulerTargetConfig, 'enabled'> & { enabled?: boolean }): Promise<void> {
    if (!target.timelineIds || target.timelineIds.length === 0) {
      throw new Error('timelineIds must not be empty');
    }
    await this.targetModel.updateOne(
      { matchId: target.matchId, tenantId: target.tenantId },
      {
        $set: {
          ...target,
          enabled: target.enabled ?? true,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
  }

  /**
   * Vô hiệu hóa target (không xóa).
   */
  async disableTarget(matchId: string, tenantId: string): Promise<void> {
    await this.targetModel.updateOne(
      { matchId, tenantId },
      { $set: { enabled: false, updatedAt: new Date() } },
    );
  }
}
