import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from '@src/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') || 5001;
  const env = configService.get<string>('app.env') || 'development';

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (env !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('DataRefinery Metrics API')
      .setDescription('Overlay metrics read API for cross-service consumption')
      .setVersion('1.0')
      .addApiKey(
        { type: 'apiKey', name: 'x-tenant-id', in: 'header' },
        'x-tenant-id',
      )
      .addApiKey(
        { type: 'apiKey', name: 'x-internal-api-key', in: 'header' },
        'x-internal-api-key',
      )
      .addSecurityRequirements('x-tenant-id')
      .addSecurityRequirements('x-internal-api-key')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  app.enableShutdownHooks();

  await app.listen(port);
  console.log(`DataRefinery is running on port ${port}`);
}
void bootstrap();
