import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsTimeseriesDocument =
  HydratedDocument<OverlayMetricsTimeseries>;

const TIMESERIES_RETENTION_SECONDS = 90 * 24 * 60 * 60;

@Schema({ timestamps: true })
export class OverlayMetricsTimeseries {
  @Prop({ required: true })
  timelineId!: string;

  @Prop({ required: true })
  matchId!: string;

  @Prop({ required: true })
  tenantId!: string;

  @Prop({ required: true })
  metric!: string;

  @Prop({ required: true })
  interval!: string;

  @Prop({ required: true })
  time!: Date;

  @Prop({ required: true, type: Number })
  value!: number;

  @Prop({ required: true })
  intervalFrom!: Date;

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
