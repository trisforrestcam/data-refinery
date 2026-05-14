import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsDeviceDocument =
  HydratedDocument<OverlayMetricsDevice>;

/**
 * Schema lưu trữ metrics phân tích thiết bị của overlay theo từng chiều dimension.
 */
@Schema({ timestamps: true })
export class OverlayMetricsDevice {
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
   * Chiều phân tích thiết bị (ví dụ: browser, os, deviceClass).
   */
  @Prop({ required: true })
  dimension!: string;

  /**
   * Giá trị cụ thể của chiều phân tích (ví dụ: Chrome, iOS, Mobile).
   */
  @Prop({ required: true })
  bucketKey!: string;

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

export const OverlayMetricsDeviceSchema =
  SchemaFactory.createForClass(OverlayMetricsDevice);
OverlayMetricsDeviceSchema.index(
  { tenantId: 1, matchId: 1, dimension: 1, bucketKey: 1, intervalFrom: 1 },
  { unique: true },
);
OverlayMetricsDeviceSchema.index({
  matchId: 1,
  dimension: 1,
  intervalFrom: -1,
});
OverlayMetricsDeviceSchema.index({ tenantId: 1, intervalFrom: -1 });
