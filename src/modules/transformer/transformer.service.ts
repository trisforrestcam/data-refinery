import { Injectable } from '@nestjs/common';
import { RefinedDataDto } from './dto/refined-data.dto';

@Injectable()
export class TransformerService {
  transform(rawData: any[]): RefinedDataDto[] {
    return rawData
      .map((item) => this.mapSingle(item))
      .filter((dto): dto is RefinedDataDto => this.isValid(dto));
  }

  private mapSingle(item: any): RefinedDataDto | null {
    const timestampRaw = item['@timestamp'] || item.timestamp;
    const timestamp = timestampRaw ? new Date(timestampRaw) : new Date(NaN);

    return {
      traceId: item.trace?.id || item.trace_id,
      transactionId: item.transaction?.id || item.transaction_id,
      spanId: item.span?.id || item.span_id,
      serviceName: item.service?.name,
      serviceEnvironment: item.service?.environment,
      timestamp,
      durationUs:
        item.transaction?.duration?.us || item.span?.duration?.us || 0,
      transactionName: item.transaction?.name,
      transactionType: item.transaction?.type,
      spanName: item.span?.name,
      spanType: item.span?.type,
      spanSubtype: item.span?.subtype,
      metadata: {
        host: item.host,
        process: item.process,
        observer: item.observer,
        http: item.http,
        url: item.url,
      },
      labels: item.labels || {},
    };
  }

  private isValid(dto: RefinedDataDto | null): dto is RefinedDataDto {
    if (!dto) return false;
    return (
      !!dto.traceId &&
      !!dto.transactionId &&
      !!dto.serviceName &&
      dto.timestamp instanceof Date &&
      !isNaN(dto.timestamp.getTime()) &&
      typeof dto.durationUs === 'number'
    );
  }
}
