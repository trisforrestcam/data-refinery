import { IsNumber, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PercentileSet {
  @IsNumber()
  p50!: number;

  @IsNumber()
  p75!: number;

  @IsNumber()
  p95!: number;

  @IsNumber()
  p99!: number;

  @IsNumber()
  avg!: number;

  @IsNumber()
  max!: number;
}

export class RenderDurationSet {
  @IsNumber()
  p50!: number;

  @IsNumber()
  p95!: number;

  @IsNumber()
  p99!: number;

  @IsNumber()
  avg!: number;
}

export class LatencyPercentileDto {
  timelineId!: string;
  matchId!: string;
  tenantId!: string;

  @ValidateNested()
  @Type(() => PercentileSet)
  receive!: PercentileSet;

  @ValidateNested()
  @Type(() => PercentileSet)
  render!: PercentileSet;

  @ValidateNested()
  @Type(() => PercentileSet)
  ack!: PercentileSet;

  @ValidateNested()
  @Type(() => RenderDurationSet)
  renderDuration!: RenderDurationSet;

  intervalFrom!: Date;
  intervalTo!: Date;
}
