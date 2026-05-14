import { registerAs } from '@nestjs/config';

function parseIntOrDefault(
  value: string | undefined,
  defaultValue: number,
): number {
  const parsed = parseInt(value || String(defaultValue), 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export default registerAs('redis', () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseIntOrDefault(process.env.REDIS_PORT, 6379),
  password: process.env.REDIS_PASSWORD || undefined,
}));
