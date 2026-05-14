import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { ElasticsearchCoreModule } from '@common/modules/elasticsearch-core.module';
import appConfig from '@config/app.config';
import mongoConfig from '@config/mongo.config';
import redisConfig from '@config/redis.config';
import elasticsearchConfig from '@config/elasticsearch.config';
import { EtlModule } from '@modules/overlay-metrics-etl/etl.module';
import { ApiModule } from '@modules/overlay-metrics-api/api.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, mongoConfig, redisConfig, elasticsearchConfig],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('mongo.uri'),
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('redis.host'),
          port: configService.get<number>('redis.port'),
          password: configService.get<string>('redis.password') || undefined,
        },
      }),
    }),
    ElasticsearchCoreModule,
    EtlModule,
    ApiModule,
  ],
})
export class AppModule {}
