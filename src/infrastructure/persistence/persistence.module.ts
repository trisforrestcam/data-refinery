import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
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
import { OverlayMetricsRepository } from './overlay-metrics.repository';
import { TenantConnectionManager } from './tenant-connection.manager';
import { TenantModelFactory } from './tenant-model.factory';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: OverlayMetricsPlatform.name,
        schema: OverlayMetricsPlatformSchema,
      },
      { name: OverlayMetricsDevice.name, schema: OverlayMetricsDeviceSchema },
      {
        name: OverlayMetricsTransport.name,
        schema: OverlayMetricsTransportSchema,
      },
      { name: OverlayMetricsSdk.name, schema: OverlayMetricsSdkSchema },
      { name: OverlayMetricsFailure.name, schema: OverlayMetricsFailureSchema },
      {
        name: OverlayMetricsTimeseries.name,
        schema: OverlayMetricsTimeseriesSchema,
      },
      { name: OverlayMetricsLatency.name, schema: OverlayMetricsLatencySchema },
    ]),
  ],
  providers: [
    OverlayMetricsRepository,
    TenantConnectionManager,
    TenantModelFactory,
  ],
  exports: [
    OverlayMetricsRepository,
    TenantConnectionManager,
    TenantModelFactory,
  ],
})
export class PersistenceModule {}
