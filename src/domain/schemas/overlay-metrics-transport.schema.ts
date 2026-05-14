import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsTransportDocument =
  HydratedDocument<OverlayMetricsTransport>;

/**
 * Schema lưu trữ metrics phương thức vận chuyển dữ liệu (transport) của overlay.
 */
@Schema({ timestamps: true })
export class OverlayMetricsTransport {
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
   * Phương thức vận chuyển dữ liệu (ví dụ: websocket, polling).
   */
  @Prop({ required: true })
  transportMode!: string;

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
   * Thời gian render trung bình (ms).
   */
  @Prop({ required: true, type: Number })
  avgRenderMs!: number;

  /**
   * Thời gian render tại phân vị 95 (ms).
   */
  @Prop({ required: true, type: Number })
  p95RenderMs!: number;

  /**
   * Thời điểm bắt đầu khoảng thời gian thống kê.
   */
  @Prop({ required: true })
  intervalFrom!: Date;

  /**
   * Thời điểm kết thúc khoảng thời gian thống kê.
   */
  @Prop({ required: true })
  intervalTo!: Date;
}

export const OverlayMetricsTransportSchema = SchemaFactory.createForClass(
  OverlayMetricsTransport,
);
OverlayMetricsTransportSchema.index(
  { tenantId: 1, matchId: 1, transportMode: 1, intervalFrom: 1 },
  { unique: true },
);
OverlayMetricsTransportSchema.index({ matchId: 1, intervalFrom: -1 });
OverlayMetricsTransportSchema.index({ tenantId: 1, intervalFrom: -1 });
