import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsPlatformDocument =
  HydratedDocument<OverlayMetricsPlatform>;

@Schema({ timestamps: true })
export class OverlayMetricsPlatform {
  @Prop({ required: true })
  timelineId!: string;

  @Prop({ required: true })
  matchId!: string;

  @Prop({ required: true })
  tenantId!: string;

  @Prop({ required: true })
  platform!: string;

  @Prop({ required: true, type: Number })
  sent!: number;

  @Prop({ required: true, type: Number })
  received!: number;

  @Prop({ required: true, type: Number })
  rendered!: number;

  @Prop({ required: true, type: Number })
  failed!: number;

  @Prop({ required: true, type: Number })
  receiveRate!: number;

  @Prop({ required: true, type: Number })
  renderRate!: number;

  @Prop({ required: true, type: Number })
  failureRate!: number;

  @Prop({ required: true, type: Number })
  netSuccessRate!: number;

  @Prop({ required: true, type: Number })
  avgRenderMs!: number;

  @Prop({ required: true })
  intervalFrom!: Date;

  @Prop({ required: true })
  intervalTo!: Date;

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
