import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsFailureDocument =
  HydratedDocument<OverlayMetricsFailure>;

/**
 * Schema lưu trữ metrics phân tích lỗi của overlay.
 */
@Schema({ timestamps: true })
export class OverlayMetricsFailure {
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
   * Lý do lỗi.
   */
  @Prop({ required: true })
  failureReason!: string;

  /**
   * Bước xử lý xảy ra lỗi.
   */
  @Prop({ required: true })
  failureStep!: string;

  /**
   * Số lượng lỗi.
   */
  @Prop({ required: true, type: Number })
  count!: number;

  /**
   * Tỷ lệ phần trăm lỗi này so với tổng số lỗi.
   */
  @Prop({ required: true, type: Number })
  percentOfFailed!: number;

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

export const OverlayMetricsFailureSchema = SchemaFactory.createForClass(
  OverlayMetricsFailure,
);
OverlayMetricsFailureSchema.index(
  {
    tenantId: 1,
    matchId: 1,
    failureReason: 1,
    failureStep: 1,
    intervalFrom: 1,
  },
  { unique: true },
);
OverlayMetricsFailureSchema.index({ matchId: 1, intervalFrom: -1 });
OverlayMetricsFailureSchema.index({ tenantId: 1, intervalFrom: -1 });
