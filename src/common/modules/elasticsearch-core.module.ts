import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchModule } from '@nestjs/elasticsearch';

@Global()
@Module({
  imports: [
    ElasticsearchModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const node = configService.get<string>('elasticsearch.node');
        const username = configService.get<string>('elasticsearch.username');
        const password = configService.get<string>('elasticsearch.password');

        return {
          node,
          auth: username && password ? { username, password } : undefined,
        };
      },
    }),
  ],
  exports: [ElasticsearchModule],
})
export class ElasticsearchCoreModule {}
