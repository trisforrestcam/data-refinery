export class DeviceBreakdownDto {
  timelineId!: string;
  matchId!: string;
  tenantId!: string;
  dimension!: string;
  bucketKey!: string;
  received!: number;
  rendered!: number;
  failed!: number;
  renderRate!: number;
  avgRenderMs!: number;
  intervalFrom!: Date;
  intervalTo!: Date;
}
