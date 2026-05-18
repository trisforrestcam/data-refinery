import { Controller, Post, UseGuards } from '@nestjs/common';
import { TenantManagementService } from './tenant-management.service';
import { InternalApiGuard } from '@common/guards/internal-api.guard';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

/**
 * API quản lý tenant.
 * Tách riêng khỏi overlay-metrics-api vì đây là operation cấp hệ thống,
 * dùng khi có thay đổi cấu hình tenant mà không muốn restart app.
 */
@ApiTags('Tenant Management')
@UseGuards(InternalApiGuard)
@Controller('tenant-management')
export class TenantManagementController {
  constructor(
    private readonly tenantManagementService: TenantManagementService,
  ) {}

  /**
   * Làm mới tenant cache: reload toàn bộ active tenants từ DB gốc vào bộ nhớ.
   * Dùng khi admin thay đổi tenant config (thêm/sửa/xóa) để app không cần restart.
   */
  @Post('refresh-cache')
  @ApiOperation({ summary: 'Refresh tenant cache' })
  @ApiResponse({ status: 200, description: 'Cache refreshed successfully' })
  @ApiResponse({ status: 500, description: 'Failed to refresh cache' })
  async refreshTenantCache() {
    return this.tenantManagementService.refreshCache();
  }
}
