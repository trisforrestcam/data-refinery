import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsPlatformDocument =
  HydratedDocument<OverlayMetricsPlatform>;

/**
 * Schema lưu trữ metrics của overlay theo nền tảng (platform).
 */
@Schema({ timestamps: true })
export class OverlayMetricsPlatform {
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
   * Tên nền tảng (ví dụ: web, ios, android).
   */
  @Prop({ required: true })
  platform!: string;

  /**
   * Số lượng sự kiện đã gửi.
   */
  @Prop({ required: true, type: Number })
  sent!: number;

  /**
   * Số lượng sự kiện đã nhận.
   */
  @Prop({ required: true, type: Number })
  received!: number;

  /**
   * Số lượng sự kiện đã render thành công.
   */
  @Prop({ required: true, type: Number })
  rendered!: number;

  /**
   * Số lượng sự kiện bị lỗi.
   */
  @Prop({ required: true, type: Number })
  failed!: number;

  /**
   * Tỷ lệ nhận sự kiện (received / sent).
   */
  @Prop({ required: true, type: Number })
  receiveRate!: number;

  /**
   * Tỷ lệ render thành công (rendered / received).
   */
  @Prop({ required: true, type: Number })
  renderRate!: number;

  /**
   * Tỷ lệ lỗi (failed / sent).
   */
  @Prop({ required: true, type: Number })
  failureRate!: number;

  /**
   * Tỷ lệ thành công cuối cùng.
   */
  @Prop({ required: true, type: Number })
  netSuccessRate!: number;

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

  /**
   * Cờ đánh dấu đã xử lý.
   */
  @Prop({ default: false })
  processed!: boolean;
}

export const OverlayMetricsPlatformSchema = SchemaFactory.createForClass(
  OverlayMetricsPlatform,
);

OverlayMetricsPlatformSchema.index(
  { tenantId: 1, matchId: 1, platform: 1, intervalFrom: 1 },
  { unique: true },
);
OverlayMetricsPlatformSchema.index({ matchId: 1, intervalFrom: -1 });
OverlayMetricsPlatformSchema.index({ tenantId: 1, intervalFrom: -1 });
