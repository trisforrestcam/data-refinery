export class ApmQueryDto {
  index?: string;
  from!: Date;
  to!: Date;
  serviceName?: string;
  transactionType?: string;
  size?: number;
}
