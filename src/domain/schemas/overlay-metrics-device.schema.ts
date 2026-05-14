import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsDeviceDocument =
  HydratedDocument<OverlayMetricsDevice>;

@Schema({ timestamps: true })
export class OverlayMetricsDevice {
  @Prop({ required: true })
  timelineId!: string;

  @Prop({ required: true })
  matchId!: string;

  @Prop({ required: true })
  tenantId!: string;

  @Prop({ required: true })
  dimension!: string;

  @Prop({ required: true })
  bucketKey!: string;

  @Prop({ required: true, type: Number })
  received!: number;

  @Prop({ required: true, type: Number })
  rendered!: number;

  @Prop({ required: true, type: Number })
  failed!: number;

  @Prop({ required: true, type: Number })
  renderRate!: number;

  @Prop({ required: true, type: Number })
  avgRenderMs!: number;

  @Prop({ required: true })
  intervalFrom!: Date;

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
