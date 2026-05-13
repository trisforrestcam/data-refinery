import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ApmRecordDocument = HydratedDocument<ApmRecord>;

@Schema({ timestamps: true })
export class ApmRecord {
  @Prop({ required: true })
  declare traceId: string;

  @Prop({ required: true })
  declare transactionId: string;

  @Prop()
  declare spanId: string;

  @Prop({ required: true })
  declare serviceName: string;

  @Prop()
  declare serviceEnvironment: string;

  @Prop({ required: true })
  declare timestamp: Date;

  @Prop({ required: true })
  declare durationUs: number;

  @Prop()
  declare transactionName: string;

  @Prop()
  declare transactionType: string;

  @Prop()
  declare spanName: string;

  @Prop()
  declare spanType: string;

  @Prop()
  declare spanSubtype: string;

  @Prop({ type: Object })
  declare metadata: Record<string, any>;

  @Prop({ type: Object })
  declare labels: Record<string, any>;

  @Prop({ default: false })
  declare processed: boolean;
}

export const ApmRecordSchema = SchemaFactory.createForClass(ApmRecord);
