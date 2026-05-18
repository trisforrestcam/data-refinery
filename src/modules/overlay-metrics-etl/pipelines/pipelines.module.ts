import { Module } from '@nestjs/common';
import { ExtractorModule } from '../extractor/extractor.module';
import { TransformerModule } from '../transformer/transformer.module';
import { LoaderModule } from '../loader/loader.module';
import { PlatformPipeline } from './platform.pipeline';
import { DevicePipeline } from './device.pipeline';
import { TransportPipeline } from './transport.pipeline';
import { SdkPipeline } from './sdk.pipeline';
import { FailurePipeline } from './failure.pipeline';
import { LatencyPipeline } from './latency.pipeline';
import { TimeseriesPipeline } from './timeseries.pipeline';

/**
 * Token để inject tất cả metric pipelines dưới dạng array.
 * Dùng trong `TimelineProcessorService` để chạy pipelines song song.
 */
export const METRIC_PIPELINES = Symbol('METRIC_PIPELINES');

/**
 * Module tập hợp tất cả metric pipeline strategies.
 * Mỗi pipeline = 1 metric type, implement pattern extract → transform → load.
 * Export `METRIC_PIPELINES` token để processor inject toàn bộ array và chạy parallel.
 */
@Module({
  imports: [ExtractorModule, TransformerModule, LoaderModule],
  providers: [
    PlatformPipeline,
    DevicePipeline,
    TransportPipeline,
    SdkPipeline,
    FailurePipeline,
    LatencyPipeline,
    TimeseriesPipeline,
    {
      provide: METRIC_PIPELINES,
      useFactory: (
        platform: PlatformPipeline,
        device: DevicePipeline,
        transport: TransportPipeline,
        sdk: SdkPipeline,
        failure: FailurePipeline,
        latency: LatencyPipeline,
        timeseries: TimeseriesPipeline,
      ) => [platform, device, transport, sdk, failure, latency, timeseries],
      inject: [
        PlatformPipeline,
        DevicePipeline,
        TransportPipeline,
        SdkPipeline,
        FailurePipeline,
        LatencyPipeline,
        TimeseriesPipeline,
      ],
    },
  ],
  exports: [METRIC_PIPELINES],
})
export class PipelinesModule {}
