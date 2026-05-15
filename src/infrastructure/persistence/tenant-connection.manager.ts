import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Connection, createConnection, Model } from 'mongoose';
import { TenantCacheService } from '@common/modules/tenant-cache/tenant-cache.service';

/**
 * Quản lý kết nối MongoDB động theo tenant.
 *
 * Mỗi tenant có một MongoDB URI riêng. Class này cache các kết nối
 * `mongoose.Connection` trong bộ nhớ để tránh tạo connection pool
 * lặp lại cho cùng một tenant. Kết nối được đóng sạch khi module destroy.
 */
@Injectable()
export class TenantConnectionManager implements OnModuleDestroy {
  private readonly connections = new Map<string, Connection>();
  private readonly pending = new Map<string, Promise<Connection>>();

  constructor(private readonly tenantCache: TenantCacheService) {}

  /**
   * Lấy kết nối MongoDB cho một tenant.
   *
   * Nếu đã có trong cache thì trả về ngay.
   * Nếu chưa có thì tra tenant config từ `TenantCacheService`,
   * tạo connection mới với `maxPoolSize: 10`,
   * lưu vào cache rồi trả về.
   *
   * Sử dụng in-flight promise map để tránh race condition khi nhiều
   * request đồng thờ gọi cùng một tenant.
   *
   * Throw nếu tenant không tồn tại trong cache.
   */
  async getConnection(tenantId: string): Promise<Connection> {
    const cached = this.connections.get(tenantId);
    if (cached) {
      return cached;
    }

    const existing = this.pending.get(tenantId);
    if (existing) {
      return existing;
    }

    const promise = this.createConnection(tenantId);
    this.pending.set(tenantId, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(tenantId);
    }
  }

  private async createConnection(tenantId: string): Promise<Connection> {
    const tenant = this.tenantCache.get(tenantId);
    if (!tenant) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }

    const connection = createConnection(tenant.mongoUri, {
      maxPoolSize: 10,
    });

    this.connections.set(tenantId, connection);
    return connection;
  }

  /**
   * Lấy Mongoose Model từ connection của tenant.
   *
   * Giả định `getConnection` đã được gọi trước đó để cache connection.
   * Nếu connection chưa tồn tại trong cache thì throw.
   */
  getModel<T>(tenantId: string, name: string, schema: any): Model<T> {
    const connection = this.connections.get(tenantId);
    if (!connection) {
      throw new Error(`Connection not found for tenant: ${tenantId}`);
    }
    return connection.model<T>(name, schema);
  }

  /**
   * Đóng toàn bộ connection pool khi module bị hủy.
   *
   * Tránh rò rỉ socket hoặc kết nối zombie khi app shutdown.
   */
  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      Array.from(this.connections.values()).map((conn) => conn.close()),
    );
  }
}
