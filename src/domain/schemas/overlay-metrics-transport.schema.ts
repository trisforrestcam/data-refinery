import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsTransportDocument =
  HydratedDocument<OverlayMetricsTransport>;

@Schema({ timestamps: true })
export class OverlayMetricsTransport {
  @Prop({ required: true })
  timelineId!: string;

  @Prop({ required: true })
  matchId!: string;

  @Prop({ required: true })
  tenantId!: string;

  @Prop({ required: true })
  transportMode!: string;

  @Prop({ required: true, type: Number })
  count!: number;

  @Prop({ required: true, type: Number })
  renderRate!: number;

  @Prop({ required: true, type: Number })
  avgRenderMs!: number;

  @Prop({ required: true, type: Number })
  p95RenderMs!: number;

  @Prop({ required: true })
  intervalFrom!: Date;

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
