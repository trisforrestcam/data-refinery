import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Bộ phân vị thống kê gồm các mốc p50, p75, p95, p99, avg và max.
 */
@Schema({ _id: false })
class PercentileSet {
  /**
   * Phân vị 50 (trung vị).
   */
  @Prop({ required: true, type: Number })
  p50!: number;

  /**
   * Phân vị 75.
   */
  @Prop({ required: true, type: Number })
  p75!: number;

  /**
   * Phân vị 95.
   */
  @Prop({ required: true, type: Number })
  p95!: number;

  /**
   * Phân vị 99.
   */
  @Prop({ required: true, type: Number })
  p99!: number;

  /**
   * Giá trị trung bình.
   */
  @Prop({ required: true, type: Number })
  avg!: number;

  /**
   * Giá trị lớn nhất.
   */
  @Prop({ required: true, type: Number })
  max!: number;
}

/**
 * Bộ phân vị đo thờ gian render gồm các mốc p50, p95, p99 và avg.
 */
@Schema({ _id: false })
class RenderDurationSet {
  /**
   * Phân vị 50 (trung vị).
   */
  @Prop({ required: true, type: Number })
  p50!: number;

  /**
   * Phân vị 95.
   */
  @Prop({ required: true, type: Number })
  p95!: number;

  /**
   * Phân vị 99.
   */
  @Prop({ required: true, type: Number })
  p99!: number;

  /**
   * Giá trị trung bình.
   */
  @Prop({ required: true, type: Number })
  avg!: number;
}

export type OverlayMetricsLatencyDocument =
  HydratedDocument<OverlayMetricsLatency>;

/**
 * Schema lưu trữ metrics độ trễ (latency) của overlay,
 * bao gồm các bộ phân vị cho receive, render, ack và renderDuration.
 */
@Schema({ timestamps: true })
export class OverlayMetricsLatency {
  /**
   * ID của timeline chứa overlay metrics.
   *
   * **Lưu ý:** `timelineId` không nằm trong unique key của latency
   * (`tenantId + matchId + intervalFrom`). Khi nhiều timeline cùng match
   * và interval được xử lý, field này phản ánh **timeline cuối cùng**
   * đã góp phần vào record aggregate.
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
   * Bộ phân vị đo độ trễ nhận dữ liệu.
   */
  @Prop({ type: PercentileSet, required: true })
  receive!: PercentileSet;

  /**
   * Bộ phân vị đo độ trễ render.
   */
  @Prop({ type: PercentileSet, required: true })
  render!: PercentileSet;

  /**
   * Bộ phân vị đo độ trễ xác nhận (ack).
   */
  @Prop({ type: PercentileSet, required: true })
  ack!: PercentileSet;

  /**
   * Bộ phân vị đo thờ gian render.
   */
  @Prop({ type: RenderDurationSet, required: true })
  renderDuration!: RenderDurationSet;

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

export const OverlayMetricsLatencySchema = SchemaFactory.createForClass(
  OverlayMetricsLatency,
);
OverlayMetricsLatencySchema.index(
  { tenantId: 1, matchId: 1, intervalFrom: 1 },
  { unique: true },
);
OverlayMetricsLatencySchema.index({ matchId: 1, intervalFrom: -1 });
OverlayMetricsLatencySchema.index({ tenantId: 1, intervalFrom: -1 });
