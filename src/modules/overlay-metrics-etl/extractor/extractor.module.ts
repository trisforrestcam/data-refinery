import { Module } from '@nestjs/common';
import { TrackingEsService } from './elasticsearch/tracking-es.service';

/**
 * ExtractorModule cung cấp TrackingEsService để các pipeline query Elasticsearch.
 * Facade ExtractorService đã được loại bỏ — pipeline strategies gọi ES trực tiếp
 * để giảm 1 layer indirection không cần thiết.
 */
@Module({
  providers: [TrackingEsService],
  exports: [TrackingEsService],
})
export class ExtractorModule {}
