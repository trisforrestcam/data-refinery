import { IsOptional, IsString, IsDateString, IsEnum } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum RealtimeDimension {
  BROWSER = 'browser',
  OS = 'os',
  DEVICE_CLASS = 'deviceClass',
}

export enum RealtimeTimeseriesMetric {
  SENT = 'sent',
  RECEIVED = 'received',
  RENDERED = 'rendered',
  FAILED = 'failed',
  AVG_RENDER_MS = 'avgRenderMs',
}

export class RealtimeQueryDto {
  @ApiPropertyOptional({ description: 'Timeline ID(s)' })
  @IsOptional()
  @IsString({ each: true })
  @Transform(({ value }: { value: string | string[] }) =>
    Array.isArray(value) ? value : value ? [value] : [],
  )
  timelineIds?: string[];

  @ApiPropertyOptional({ description: 'Tenant ID' })
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiPropertyOptional({ description: 'Start date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'End date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Platform filter' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({
    description: 'Match ID (maps to labels.media_content_id in ES)',
  })
  @IsOptional()
  @IsString()
  matchId?: string;

  @ApiPropertyOptional({
    description: 'Question ID (maps to labels.timeline_id in ES)',
  })
  @IsOptional()
  @IsString()
  questionId?: string;
}

export class RealtimeDeviceQueryDto extends RealtimeQueryDto {
  @ApiPropertyOptional({ enum: RealtimeDimension })
  @IsOptional()
  @IsEnum(RealtimeDimension)
  dimension?: RealtimeDimension;
}

export class RealtimeTimeseriesQueryDto extends RealtimeQueryDto {
  @ApiPropertyOptional({ description: 'Time interval', example: '1m' })
  @IsOptional()
  @IsString()
  interval?: string;

  @ApiPropertyOptional({ enum: RealtimeTimeseriesMetric })
  @IsOptional()
  @IsEnum(RealtimeTimeseriesMetric)
  metric?: RealtimeTimeseriesMetric;
}
