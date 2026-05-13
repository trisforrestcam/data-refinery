import { IsDate, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class ApmQueryDto {
  @IsOptional()
  @IsString()
  index?: string;

  @IsDate()
  from!: Date;

  @IsDate()
  to!: Date;

  @IsOptional()
  @IsString()
  serviceName?: string;

  @IsOptional()
  @IsString()
  transactionType?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10000)
  size?: number;
}
