import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

/**
 * Interface định nghĩa cấu hình scheduler cho một match đang live.
 */
export interface SchedulerTarget {
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
    @InjectModel('SchedulerTarget')
    private readonly targetModel: Model<any>,
  ) {}

  /**
   * Lấy danh sách targets đang active từ DB.
   * Nếu DB chưa có data, fallback về env vars.
   */
  async getActiveTargets(): Promise<SchedulerTarget[]> {
    try {
      const dbTargets = await this.targetModel
        .find({ enabled: true })
        .lean()
        .exec();

      if (dbTargets.length > 0) {
        return dbTargets.map((t) => ({
          tenantId: t.tenantId,
          matchId: t.matchId,
          timelineIds: t.timelineIds,
          enabled: t.enabled,
        }));
      }
    } catch (error) {
      this.logger.warn(
        `Failed to read scheduler targets from DB: ${(error as Error).message}. Falling back to env vars.`,
      );
    }

    // Fallback to env vars
    const tenantId = process.env.OVERLAY_METRICS_TENANT_ID;
    const matchId = process.env.OVERLAY_METRICS_MATCH_ID;
    const timelineIds = process.env.OVERLAY_METRICS_TIMELINE_IDS
      ? process.env.OVERLAY_METRICS_TIMELINE_IDS.split(',').map((s) => s.trim())
      : [];

    if (!tenantId || !matchId || timelineIds.length === 0) {
      return [];
    }

    return [{ tenantId, matchId, timelineIds, enabled: true }];
  }

  /**
   * Thêm hoặc cập nhật target trong DB.
   */
  async upsertTarget(target: Omit<SchedulerTarget, 'enabled'> & { enabled?: boolean }): Promise<void> {
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
