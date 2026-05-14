import { Module } from '@nestjs/common';
import { PersistenceModule } from '@infrastructure/persistence/persistence.module';
import { KafkaModule } from '@modules/overlay-metrics-etl/kafka/kafka.module';
import { MetricsApiController } from './metrics-api.controller';
import { MetricsApiService } from './metrics-api.service';

@Module({
  imports: [PersistenceModule, KafkaModule],
  controllers: [MetricsApiController],
  providers: [MetricsApiService],
})
export class ApiModule {}
