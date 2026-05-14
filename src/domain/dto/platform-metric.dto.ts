export class PlatformMetricDto {
  timelineId!: string;
  matchId!: string;
  tenantId!: string;
  platform!: string;
  sent!: number;
  received!: number;
  rendered!: number;
  failed!: number;
  receiveRate!: number;
  renderRate!: number;
  failureRate!: number;
  netSuccessRate!: number;
  avgRenderMs!: number;
  intervalFrom!: Date;
  intervalTo!: Date;
}
