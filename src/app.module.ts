import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ElasticsearchCoreModule } from '@common/modules/elasticsearch-core.module';
import { TenantCacheModule } from '@common/modules/tenant-cache/tenant-cache.module';
import appConfig from '@config/app.config';
import mongoConfig from '@config/mongo.config';
import kafkaConfig from '@config/kafka.config';
import elasticsearchConfig from '@config/elasticsearch.config';
import { EtlModule } from '@modules/overlay-metrics-etl/etl.module';
import { ApiModule } from '@modules/overlay-metrics-api/api.module';
import { TenantManagementModule } from '@modules/tenant-management/tenant-management.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, mongoConfig, kafkaConfig, elasticsearchConfig],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('mongo.uri'),
      }),
    }),
    ScheduleModule.forRoot(),
    ElasticsearchCoreModule,
    TenantCacheModule,
    EtlModule,
    ApiModule,
    TenantManagementModule,
  ],
})
export class AppModule {}
