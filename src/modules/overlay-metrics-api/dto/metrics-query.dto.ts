import { IsOptional, IsString, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MetricsQueryDto {
  @ApiPropertyOptional({
    description: 'Match ID',
    example: '000000000000000000000000',
  })
  @IsOptional()
  @IsString()
  matchId?: string;

  @ApiPropertyOptional({
    description: 'Timeline ID(s). Accept single or multiple values.',
    example: ['timeline-001'],
    isArray: true,
  })
  @IsOptional()
  @IsString({ each: true })
  @Transform(({ value }: { value: string | string[] }) =>
    Array.isArray(value) ? value : [value],
  )
  timelineIds?: string[];

  @ApiPropertyOptional({
    description: 'Start date (ISO 8601)',
    example: '2024-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'End date (ISO 8601)',
    example: '2024-01-02T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
