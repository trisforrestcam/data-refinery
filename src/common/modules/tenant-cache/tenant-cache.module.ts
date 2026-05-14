import { Global, Module } from '@nestjs/common';
import { TenantCacheService } from './tenant-cache.service';

/**
 * Module cache tenant config trong bộ nhớ.
 * @Global để toàn bộ app có thể inject TenantCacheService mà không cần import module.
 *
 * Load toàn bộ tenants từ DB gốc khi bootstrap, key là `name` (vd: 'vtvlive').
 * Mỗi tenant chứa `mongoUri` và `status` để các module khác dùng kết nối DB riêng.
 */
@Global()
@Module({
  providers: [TenantCacheService],
  exports: [TenantCacheService],
})
export class TenantCacheModule {}
