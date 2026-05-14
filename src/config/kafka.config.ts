import { registerAs } from '@nestjs/config';

function parseIntOrDefault(
  value: string | undefined,
  defaultValue: number,
): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export default registerAs('kafka', () => ({
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092')
    .split(',')
    .map((b) => b.trim()),
  clientId: process.env.KAFKA_CLIENT_ID || 'data-refinery',
  groupId: process.env.KAFKA_GROUP_ID || 'data-refinery-etl-consumers',
  dlqTopic: process.env.KAFKA_DLQ_TOPIC || 'overlay-metrics.etl.dlq',
  maxRetries: parseIntOrDefault(process.env.KAFKA_MAX_RETRIES, 3),
  retryDelayMs: parseIntOrDefault(process.env.KAFKA_RETRY_DELAY_MS, 5000),
}));
