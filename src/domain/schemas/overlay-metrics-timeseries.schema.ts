import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsTimeseriesDocument =
  HydratedDocument<OverlayMetricsTimeseries>;

/**
 * Thờ gian giữ dữ liệu timeseries (90 ngày).
 */
const TIMESERIES_RETENTION_SECONDS = 90 * 24 * 60 * 60;

/**
 * Schema lưu dữ liệu timeseries của overlay metrics.
 */
@Schema({ timestamps: true })
export class OverlayMetricsTimeseries {
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
   * Tên chỉ số timeseries (ví dụ: sent, received, rendered, failed, avgRenderMs).
   */
  @Prop({ required: true })
  metric!: string;

  /**
   * Khoảng thờ gian của điểm dữ liệu (ví dụ: 1m, 5m).
   */
  @Prop({ required: true })
  interval!: string;

  /**
   * Thờ điểm cụ thể của điểm dữ liệu.
   */
  @Prop({ required: true })
  time!: Date;

  /**
   * Giá trị chỉ số tại thờ điểm đó.
   */
  @Prop({ required: true, type: Number })
  value!: number;

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

export const OverlayMetricsTimeseriesSchema = SchemaFactory.createForClass(
  OverlayMetricsTimeseries,
);
OverlayMetricsTimeseriesSchema.index(
  { tenantId: 1, matchId: 1, metric: 1, interval: 1, time: 1 },
  { unique: true },
);
OverlayMetricsTimeseriesSchema.index({ matchId: 1, metric: 1, time: -1 });
OverlayMetricsTimeseriesSchema.index({ tenantId: 1, metric: 1, time: -1 });
OverlayMetricsTimeseriesSchema.index(
  { intervalFrom: 1 },
  { expireAfterSeconds: TIMESERIES_RETENTION_SECONDS },
);
