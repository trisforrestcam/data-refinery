import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsSdkDocument = HydratedDocument<OverlayMetricsSdk>;

@Schema({ timestamps: true })
export class OverlayMetricsSdk {
  @Prop({ required: true })
  timelineId!: string;

  @Prop({ required: true })
  matchId!: string;

  @Prop({ required: true })
  tenantId!: string;

  @Prop({ required: true })
  sdkVersion!: string;

  @Prop({ required: true, type: Number })
  count!: number;

  @Prop({ required: true, type: Number })
  renderRate!: number;

  @Prop({ required: true, type: Number })
  avgRenderMs!: number;

  @Prop({ required: true })
  intervalFrom!: Date;

  @Prop({ required: true })
  intervalTo!: Date;
}

export const OverlayMetricsSdkSchema =
  SchemaFactory.createForClass(OverlayMetricsSdk);
OverlayMetricsSdkSchema.index(
  { tenantId: 1, matchId: 1, sdkVersion: 1, intervalFrom: 1 },
  { unique: true },
);
OverlayMetricsSdkSchema.index({ matchId: 1, intervalFrom: -1 });
OverlayMetricsSdkSchema.index({ tenantId: 1, intervalFrom: -1 });
