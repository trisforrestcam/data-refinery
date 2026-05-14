import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guard xác thực server-to-server qua header x-internal-api-key.
 * Token được cấu hình qua env INTERNAL_API_KEY (đọc qua ConfigService).
 * Dùng cho internal services (ví dụ: interactive-backend_v2 gọi sang data-refinery).
 */
@Injectable()
export class InternalApiGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const headerKey = request.headers['x-internal-api-key'];
    const apiKey = this.config.get<string>('app.internalApiKey');

    if (!apiKey) {
      throw new UnauthorizedException('INTERNAL_API_KEY not configured');
    }

    if (!headerKey || headerKey !== apiKey) {
      throw new UnauthorizedException('Invalid or missing internal API key');
    }

    return true;
  }
}
