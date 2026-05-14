import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
class PercentileSet {
  @Prop({ required: true, type: Number })
  p50!: number;

  @Prop({ required: true, type: Number })
  p75!: number;

  @Prop({ required: true, type: Number })
  p95!: number;

  @Prop({ required: true, type: Number })
  p99!: number;

  @Prop({ required: true, type: Number })
  avg!: number;

  @Prop({ required: true, type: Number })
  max!: number;
}

@Schema({ _id: false })
class RenderDurationSet {
  @Prop({ required: true, type: Number })
  p50!: number;

  @Prop({ required: true, type: Number })
  p95!: number;

  @Prop({ required: true, type: Number })
  p99!: number;

  @Prop({ required: true, type: Number })
  avg!: number;
}

export type OverlayMetricsLatencyDocument =
  HydratedDocument<OverlayMetricsLatency>;

@Schema({ timestamps: true })
export class OverlayMetricsLatency {
  @Prop({ required: true })
  timelineId!: string;

  @Prop({ required: true })
  matchId!: string;

  @Prop({ required: true })
  tenantId!: string;

  @Prop({ type: PercentileSet, required: true })
  receive!: PercentileSet;

  @Prop({ type: PercentileSet, required: true })
  render!: PercentileSet;

  @Prop({ type: PercentileSet, required: true })
  ack!: PercentileSet;

  @Prop({ type: RenderDurationSet, required: true })
  renderDuration!: RenderDurationSet;

  @Prop({ required: true })
  intervalFrom!: Date;

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
