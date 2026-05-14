import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Tenant } from '@domain/interfaces/tenant.interface';

/**
 * Service cache tenant config trong bộ nhớ.
 * Load toàn bộ tenants từ DB gốc khi app bootstrap, lưu vào Map để truy cập nhanh.
 * Key là `name` của tenant (vd: 'vtvlive').
 */
@Injectable()
export class TenantCacheService implements OnModuleInit {
  private readonly logger = new Logger(TenantCacheService.name);
  private readonly cache = new Map<string, Tenant>();

  constructor(
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  /**
   * Load toàn bộ tenants từ DB gốc vào cache khi module khởi động.
   * Chỉ cache tenant có status = 'ACTIVE'.
   */
  async onModuleInit(): Promise<void> {
    try {
      const tenants = await this.connection
        .collection('tenants')
        .find({ status: 'ACTIVE' })
        .toArray();

      for (const doc of tenants) {
        const tenant: Tenant = {
          name: doc.name,
          mongoUri: doc.mongoUri,
          status: doc.status,
        };
        this.cache.set(tenant.name, tenant);
      }

      this.logger.log(
        `Loaded ${this.cache.size} active tenant(s) into cache: ${Array.from(this.cache.keys()).join(', ')}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to load tenants into cache: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Lấy tenant theo name.
   * Trả về undefined nếu không tìm thấy.
   */
  get(name: string): Tenant | undefined {
    return this.cache.get(name);
  }

  /**
   * Kiểm tra tenant có tồn tại trong cache không.
   */
  has(name: string): boolean {
    return this.cache.has(name);
  }

  /**
   * Lấy toàn bộ tenants trong cache.
   */
  values(): Tenant[] {
    return Array.from(this.cache.values());
  }

  /**
   * Lấy danh sách tên tenants (keys).
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Làm mới cache bằng cách reload từ DB.
   * Dùng khi admin thay đổi tenant config.
   */
  async refresh(): Promise<void> {
    this.cache.clear();
    await this.onModuleInit();
  }
}
