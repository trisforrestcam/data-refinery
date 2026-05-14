import { Module } from '@nestjs/common';
import { PersistenceModule } from '@infrastructure/persistence/persistence.module';
import { LoaderService } from './loader.service';

@Module({
  imports: [PersistenceModule],
  providers: [LoaderService],
  exports: [LoaderService],
})
export class LoaderModule {}
