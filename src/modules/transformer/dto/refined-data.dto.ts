export class RefinedDataDto {
  traceId!: string;
  transactionId!: string;
  spanId?: string;
  serviceName!: string;
  serviceEnvironment?: string;
  timestamp!: Date;
  durationUs!: number;
  transactionName?: string;
  transactionType?: string;
  spanName?: string;
  spanType?: string;
  spanSubtype?: string;
  metadata?: Record<string, any>;
  labels?: Record<string, any>;
}
