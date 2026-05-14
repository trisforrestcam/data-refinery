import { Module } from '@nestjs/common';
import { TenantManagementController } from './tenant-management.controller';
import { TenantManagementService } from './tenant-management.service';

@Module({
  controllers: [TenantManagementController],
  providers: [TenantManagementService],
})
export class TenantManagementModule {}
