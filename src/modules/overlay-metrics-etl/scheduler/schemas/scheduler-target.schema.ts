import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * Schema lưu cấu hình scheduler targets trong MongoDB.
 * Cho phép quản lý động nhiều match/timeline mà không cần restart service.
 */
@Schema({ timestamps: true })
export class SchedulerTarget extends Document {
  @Prop({ required: true })
  tenantId: string;

  @Prop({ required: true, unique: true })
  matchId: string;

  @Prop({ type: [String], required: true })
  timelineIds: string[];

  @Prop({ default: true })
  enabled: boolean;
}

export const SchedulerTargetSchema = SchemaFactory.createForClass(SchedulerTarget);
