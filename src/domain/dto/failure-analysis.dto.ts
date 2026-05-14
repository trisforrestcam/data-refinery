export class FailureAnalysisDto {
  timelineId!: string;
  matchId!: string;
  tenantId!: string;
  failureReason!: string;
  failureStep!: string;
  count!: number;
  percentOfFailed!: number;
  intervalFrom!: Date;
  intervalTo!: Date;
}
