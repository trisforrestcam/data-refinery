import { TransformerService } from './transformer.service';
import { RefinedDataDto } from './dto/refined-data.dto';

describe('TransformerService', () => {
  let service: TransformerService;

  beforeEach(() => {
    service = new TransformerService();
  });

  it('should transform ECS nested fields correctly', () => {
    const raw = [
      {
        '@timestamp': '2024-01-15T08:30:00.000Z',
        trace: { id: 'trace-001' },
        transaction: { id: 'txn-001', name: 'GET /api/users', type: 'request', duration: { us: 1500 } },
        span: { id: 'span-001', name: 'SELECT users', type: 'db', subtype: 'postgresql' },
        service: { name: 'user-service', environment: 'production' },
        labels: { region: 'ap-southeast-1' },
        host: { name: 'host-01' },
      },
    ];

    const result: RefinedDataDto[] = service.transform(raw);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      traceId: 'trace-001',
      transactionId: 'txn-001',
      spanId: 'span-001',
      serviceName: 'user-service',
      serviceEnvironment: 'production',
      durationUs: 1500,
      transactionName: 'GET /api/users',
      transactionType: 'request',
      spanName: 'SELECT users',
      spanType: 'db',
      spanSubtype: 'postgresql',
      labels: { region: 'ap-southeast-1' },
      metadata: { host: { name: 'host-01' } },
    });
    expect(result[0].timestamp).toEqual(new Date('2024-01-15T08:30:00.000Z'));
  });

  it('should fallback to flat fields when nested ECS fields are missing', () => {
    const raw = [
      {
        '@timestamp': '2024-01-15T09:00:00.000Z',
        trace_id: 'trace-002',
        transaction_id: 'txn-002',
        span_id: 'span-002',
        service: { name: 'order-service' },
        transaction: { duration: { us: 800 } },
      },
    ];

    const result = service.transform(raw);

    expect(result).toHaveLength(1);
    expect(result[0].traceId).toBe('trace-002');
    expect(result[0].transactionId).toBe('txn-002');
    expect(result[0].spanId).toBe('span-002');
  });

  it('should filter out records missing required fields', () => {
    const raw = [
      {
        // valid record
        '@timestamp': '2024-01-15T10:00:00.000Z',
        trace: { id: 'trace-003' },
        transaction: { id: 'txn-003', duration: { us: 100 } },
        service: { name: 'payment-service' },
      },
      {
        // missing traceId
        '@timestamp': '2024-01-15T10:00:00.000Z',
        transaction: { id: 'txn-004', duration: { us: 100 } },
        service: { name: 'payment-service' },
      },
      {
        // missing serviceName
        '@timestamp': '2024-01-15T10:00:00.000Z',
        trace: { id: 'trace-005' },
        transaction: { id: 'txn-005', duration: { us: 100 } },
      },
      {
        // invalid timestamp
        '@timestamp': 'not-a-date',
        trace: { id: 'trace-006' },
        transaction: { id: 'txn-006', duration: { us: 100 } },
        service: { name: 'payment-service' },
      },
    ];

    const result = service.transform(raw);

    // Chỉ record đầu là valid
    expect(result).toHaveLength(1);
    expect(result[0].traceId).toBe('trace-003');
  });

  it('should return empty array when input is empty', () => {
    expect(service.transform([])).toEqual([]);
  });

  it('should default durationUs to 0 and labels to empty object when missing', () => {
    const raw = [
      {
        '@timestamp': '2024-01-15T11:00:00.000Z',
        trace: { id: 'trace-007' },
        transaction: { id: 'txn-007' },
        service: { name: 'notification-service' },
      },
    ];

    const result = service.transform(raw);

    expect(result).toHaveLength(1);
    expect(result[0].durationUs).toBe(0);
    expect(result[0].labels).toEqual({});
    expect(result[0].spanId).toBeUndefined();
  });
});
