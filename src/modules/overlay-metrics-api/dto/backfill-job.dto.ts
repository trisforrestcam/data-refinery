import { IsString, IsArray, IsOptional, IsDateString, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO cho yêu cầu backfill/recalculate metrics.
 * Cho phép tính lại dữ liệu cho match cụ thể trong khoảng thời gian tùy chọn.
 */
export class BackfillJobDto {
  @ApiProperty({ description: 'Tenant ID', example: 'tenant-001' })
  @IsString()
  tenantId: string;

  @ApiProperty({ description: 'Match ID cần tính lại', example: '000000000000000000000000' })
  @IsString()
  matchId: string;

  @ApiProperty({
    description: 'Danh sách timeline IDs cần tính lại',
    example: ['timeline-001', 'timeline-002'],
    isArray: true,
  })
  @IsArray()
  @IsString({ each: true })
  timelineIds: string[];

  @ApiPropertyOptional({
    description: 'Thờ điểm bắt đầu (ISO 8601). Nếu không có, tính từ hiện tại - timeRangeMinutes',
    example: '2024-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  intervalFrom?: string;

  @ApiPropertyOptional({
    description: 'Thời điểm kết thúc (ISO 8601). Nếu không có, tính đến hiện tại',
    example: '2024-01-01T01:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  intervalTo?: string;

  @ApiPropertyOptional({
    description: 'Khoảng thời gian mỗi interval (phút). Mặc định 5 phút',
    example: 5,
    default: 5,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  timeRangeMinutes?: number;
}
