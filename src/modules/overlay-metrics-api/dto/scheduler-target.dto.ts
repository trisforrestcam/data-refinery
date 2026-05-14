import { IsString, IsArray, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO cho cấu hình scheduler target.
 */
export class SchedulerTargetDto {
  @ApiProperty({ description: 'Tenant ID', example: 'tenant-001' })
  @IsString()
  tenantId: string;

  @ApiProperty({ description: 'Match ID', example: '000000000000000000000000' })
  @IsString()
  matchId: string;

  @ApiProperty({
    description: 'Danh sách timeline IDs',
    example: ['timeline-001', 'timeline-002'],
    isArray: true,
  })
  @IsArray()
  @IsString({ each: true })
  timelineIds: string[];

  @ApiPropertyOptional({ description: 'Kích hoạt target', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
