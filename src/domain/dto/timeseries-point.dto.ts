export class TimeseriesPointDto {
  timelineId!: string;
  matchId!: string;
  tenantId!: string;
  metric!: string;
  interval!: string;
  time!: Date;
  value!: number;
  intervalFrom!: Date;
  intervalTo!: Date;
}
