import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ApmRecordDocument = HydratedDocument<ApmRecord>;

@Schema({ timestamps: true })
export class ApmRecord {
  @Prop({ required: true })
  traceId: string;

  @Prop({ required: true })
  transactionId: string;

  @Prop()
  spanId: string;

  @Prop({ required: true })
  serviceName: string;

  @Prop()
  serviceEnvironment: string;

  @Prop({ required: true })
  timestamp: Date;

  @Prop({ required: true })
  durationUs: number;

  @Prop()
  transactionName: string;

  @Prop()
  transactionType: string;

  @Prop()
  spanName: string;

  @Prop()
  spanType: string;

  @Prop()
  spanSubtype: string;

  @Prop({ type: Object })
  metadata: Record<string, any>;

  @Prop({ type: Object })
  labels: Record<string, any>;

  @Prop({ default: false })
  processed: boolean;
}

export const ApmRecordSchema = SchemaFactory.createForClass(ApmRecord);
