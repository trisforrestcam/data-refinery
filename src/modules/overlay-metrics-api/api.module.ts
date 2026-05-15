import { Module } from '@nestjs/common';
import { PersistenceModule } from '@infrastructure/persistence/persistence.module';
import { KafkaModule } from '@modules/overlay-metrics-etl/kafka/kafka.module';
import { MetricsApiController } from './metrics-api.controller';
import { MetricsApiService } from './metrics-api.service';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [PersistenceModule, KafkaModule, RealtimeModule],
  controllers: [MetricsApiController],
  providers: [MetricsApiService],
})
export class ApiModule {}
