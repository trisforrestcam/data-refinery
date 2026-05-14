export class TransportComparisonDto {
  timelineId!: string;
  matchId!: string;
  tenantId!: string;
  transportMode!: string;
  count!: number;
  renderRate!: number;
  avgRenderMs!: number;
  p95RenderMs!: number;
  intervalFrom!: Date;
  intervalTo!: Date;
}
