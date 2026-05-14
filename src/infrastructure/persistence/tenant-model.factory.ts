import { Injectable } from '@nestjs/common';
import { Schema, Model } from 'mongoose';
import { MetricType } from '@domain/enums/metric-type.enum';
import {
  OverlayMetricsPlatform,
  OverlayMetricsPlatformSchema,
  OverlayMetricsDevice,
  OverlayMetricsDeviceSchema,
  OverlayMetricsTransport,
  OverlayMetricsTransportSchema,
  OverlayMetricsSdk,
  OverlayMetricsSdkSchema,
  OverlayMetricsFailure,
  OverlayMetricsFailureSchema,
  OverlayMetricsTimeseries,
  OverlayMetricsTimeseriesSchema,
  OverlayMetricsLatency,
  OverlayMetricsLatencySchema,
} from '@domain/schemas';
import { TenantConnectionManager } from './tenant-connection.manager';

interface ModelDefinition {
  name: string;
  schema: Schema;
}

/**
 * Factory tạo Mongoose Model động theo tenant và metric type.
 * Mỗi tenant có connection riêng, model được đăng ký trên connection đó
 * để đảm bảo dữ liệu tenant được cách ly ở tầng database.
 */
@Injectable()
export class TenantModelFactory {
  private readonly schemaMap: Record<MetricType, ModelDefinition>;

  constructor(private readonly connectionManager: TenantConnectionManager) {
    this.schemaMap = {
      [MetricType.PLATFORM]: {
        name: OverlayMetricsPlatform.name,
        schema: OverlayMetricsPlatformSchema,
      },
      [MetricType.DEVICE]: {
        name: OverlayMetricsDevice.name,
        schema: OverlayMetricsDeviceSchema,
      },
      [MetricType.TRANSPORT]: {
        name: OverlayMetricsTransport.name,
        schema: OverlayMetricsTransportSchema,
      },
      [MetricType.SDK]: {
        name: OverlayMetricsSdk.name,
        schema: OverlayMetricsSdkSchema,
      },
      [MetricType.FAILURE]: {
        name: OverlayMetricsFailure.name,
        schema: OverlayMetricsFailureSchema,
      },
      [MetricType.TIMESERIES]: {
        name: OverlayMetricsTimeseries.name,
        schema: OverlayMetricsTimeseriesSchema,
      },
      [MetricType.LATENCY]: {
        name: OverlayMetricsLatency.name,
        schema: OverlayMetricsLatencySchema,
      },
    };
  }

  /**
   * Lấy Mongoose Model tương ứng với metric type trên connection của tenant.
   * Nếu model chưa được đăng ký trên connection này sẽ tự động tạo mới.
   */
  async getModelByType(tenantId: string, type: MetricType): Promise<Model<any>> {
    const mapping = this.schemaMap[type];
    const conn = await this.connectionManager.getConnection(tenantId);
    return conn.model(mapping.name, mapping.schema);
  }
}
