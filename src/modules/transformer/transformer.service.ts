import { Injectable } from '@nestjs/common';
import { RefinedDataDto } from './dto/refined-data.dto';

/**
 * TransformerService chịu trách nhiệm map raw APM records (ECS format)
 * từ Elasticsearch sang RefinedDataDto để persist vào MongoDB.
 *
 * Lưu ý:
 * - Elasticsearch APM thường lưu fields dạng nested (vd: trace.id).
 * - Một số ingestion pipeline khác có thể flatten thành snake_case (vd: trace_id).
 * - Service này hỗ trợ cả 2 dạng (ưu tiên nested, fallback flat).
 * - Record nào thiếu traceId, transactionId, serviceName hoặc timestamp invalid
 *   sẽ bị filter ra (không được persist).
 */
@Injectable()
export class TransformerService {
  transform(rawData: any[]): RefinedDataDto[] {
    return rawData
      .map((item) => this.mapSingle(item))
      .filter((dto): dto is RefinedDataDto => this.isValid(dto));
  }

  private mapSingle(item: any): RefinedDataDto | null {
    // ECS dùng @timestamp; một số source khác dùng trường timestamp thuần
    const timestampRaw = item['@timestamp'] || item.timestamp;
    const timestamp = timestampRaw ? new Date(timestampRaw) : new Date(NaN);

    return {
      // Ưu tiên nested ECS fields, fallback về flat fields nếu ingestion pipeline khác flatten ra
      traceId: item.trace?.id || item.trace_id,
      transactionId: item.transaction?.id || item.transaction_id,
      spanId: item.span?.id || item.span_id,
      serviceName: item.service?.name,
      serviceEnvironment: item.service?.environment,
      timestamp,
      // duration có thể nằm ở transaction hoặc span tùy loại record
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

  /** Chỉ cho qua những record có đủ thông tin tối thiểu và timestamp hợp lệ. */
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
