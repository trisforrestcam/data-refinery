import { registerAs } from '@nestjs/config';

function parseIntOrDefault(
  value: string | undefined,
  defaultValue: number,
): number {
  const parsed = parseInt(value || String(defaultValue), 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export default registerAs('app', () => ({
  env: process.env.NODE_ENV || 'development',
  port: parseIntOrDefault(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  elasticApmEnvironment: process.env.ELASTIC_APM_ENVIRONMENT || 'development',
  internalApiKey: process.env.INTERNAL_API_KEY,
}));
