import { registerAs } from '@nestjs/config';

function parseIntOrDefault(
  value: string | undefined,
  defaultValue: number,
): number {
  const parsed = parseInt(value || String(defaultValue), 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export default registerAs('redis', () => {
  const clusterNodes = process.env.REDIS_CLUSTER_NODES;

  // Cluster mode: REDIS_CLUSTER_NODES=host1:port1,host2:port2,host3:port3
  if (clusterNodes) {
    return {
      isCluster: true as const,
      clusterNodes: clusterNodes.split(',').map((node) => {
        const [host, port] = node.trim().split(':');
        return { host, port: parseInt(port, 10) };
      }),
      password: process.env.REDIS_PASSWORD || undefined,
    };
  }

  // Standalone mode (default)
  return {
    isCluster: false as const,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseIntOrDefault(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  };
});
