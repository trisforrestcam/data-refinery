import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsFailureDocument =
  HydratedDocument<OverlayMetricsFailure>;

@Schema({ timestamps: true })
export class OverlayMetricsFailure {
  @Prop({ required: true })
  timelineId!: string;

  @Prop({ required: true })
  matchId!: string;

  @Prop({ required: true })
  tenantId!: string;

  @Prop({ required: true })
  failureReason!: string;

  @Prop({ required: true })
  failureStep!: string;

  @Prop({ required: true, type: Number })
  count!: number;

  @Prop({ required: true, type: Number })
  percentOfFailed!: number;

  @Prop({ required: true })
  intervalFrom!: Date;

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
