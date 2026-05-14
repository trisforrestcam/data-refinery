import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsSdkDocument = HydratedDocument<OverlayMetricsSdk>;

/**
 * Schema lưu trữ overlay metrics theo phiên bản SDK.
 */
@Schema({ timestamps: true })
export class OverlayMetricsSdk {
  /**
   * ID của timeline chứa overlay metrics.
   */
  @Prop({ required: true })
  timelineId!: string;

  /**
   * ID của trận đấu.
   */
  @Prop({ required: true })
  matchId!: string;

  /**
   * ID của tenant/phân hệ khách hàng.
   */
  @Prop({ required: true })
  tenantId!: string;

  /**
   * Phiên bản SDK.
   */
  @Prop({ required: true })
  sdkVersion!: string;

  /**
   * Tổng số lượng sự kiện.
   */
  @Prop({ required: true, type: Number })
  count!: number;

  /**
   * Tỷ lệ render thành công.
   */
  @Prop({ required: true, type: Number })
  renderRate!: number;

  /**
   * Thờ gian render trung bình (ms).
   */
  @Prop({ required: true, type: Number })
  avgRenderMs!: number;

  /**
   * Thờ điểm bắt đầu khoảng thờ gian thống kê.
   */
  @Prop({ required: true })
  intervalFrom!: Date;

  /**
   * Thờ điểm kết thúc khoảng thờ gian thống kê.
   */
  @Prop({ required: true })
  intervalTo!: Date;
}

export const OverlayMetricsSdkSchema =
  SchemaFactory.createForClass(OverlayMetricsSdk);
OverlayMetricsSdkSchema.index(
  { tenantId: 1, matchId: 1, sdkVersion: 1, intervalFrom: 1 },
  { unique: true },
);
OverlayMetricsSdkSchema.index({ matchId: 1, intervalFrom: -1 });
OverlayMetricsSdkSchema.index({ tenantId: 1, intervalFrom: -1 });
