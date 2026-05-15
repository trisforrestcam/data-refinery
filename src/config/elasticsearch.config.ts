import { registerAs } from '@nestjs/config';

function parseIntOrDefault(
  value: string | undefined,
  defaultValue: number,
): number {
  const parsed = parseInt(value || String(defaultValue), 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export default registerAs('elasticsearch', () => ({
  node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
  username: process.env.ELASTICSEARCH_USERNAME || undefined,
  password: process.env.ELASTICSEARCH_PASSWORD || undefined,
  apmIndex: process.env.ELASTICSEARCH_APM_INDEX || 'traces-apm-*',
  trackingIndex: process.env.TRACKING_ES_INDEX || 'tracking-apm',
  trackingTimeoutMs: parseIntOrDefault(
    process.env.TRACKING_ES_TIMEOUT_MS,
    10000,
  ),
}));
