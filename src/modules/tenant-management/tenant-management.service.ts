import { Injectable } from '@nestjs/common';
import { TenantCacheService } from '@common/modules/tenant-cache/tenant-cache.service';

/**
 * Service phục vụ quản lý tenant.
 * Hiện tại chứa nghiệp vụ reload tenant cache khi có thay đổi cấu hình.
 * Dễ mở rộng thêm các operation khác (validate, sync, health check) mà không bị ràng buộc bởi tên module.
 */
@Injectable()
export class TenantManagementService {
  constructor(private readonly tenantCache: TenantCacheService) {}

  /**
   * Làm mới tenant cache bằng cách reload toàn bộ active tenants từ DB gốc.
   * Dùng khi admin thêm/sửa/xóa tenant config để các kết nối DB mới được cập nhật ngay lập tức.
   */
  async refreshCache() {
    await this.tenantCache.refresh();
    return {
      status: 'refreshed',
      tenantCount: this.tenantCache.keys().length,
      tenants: this.tenantCache.keys(),
    };
  }
}
