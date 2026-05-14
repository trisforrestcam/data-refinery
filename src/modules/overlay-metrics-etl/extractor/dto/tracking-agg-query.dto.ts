import {
  IsDate,
  IsOptional,
  IsString,
  IsArray,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TrackingAggQuery {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  timelineIds?: string[];

  @IsOptional()
  @IsString()
  mediaContentId?: string;

  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  from?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  to?: Date;

  @IsOptional()
  @IsString()
  platform?: string;
}
