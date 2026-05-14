import { Controller, Get, Post, Patch, Headers, Query, Body, UseGuards, Param } from '@nestjs/common';
import { MetricsApiService } from './metrics-api.service';
import { MetricsQueryDto } from './dto/metrics-query.dto';
import { BackfillJobDto } from './dto/backfill-job.dto';
import { SchedulerTargetDto } from './dto/scheduler-target.dto';
import { InternalApiGuard } from '@common/guards/internal-api.guard';
import {
  ApiTags,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';

/**
 * Read API cho overlay metrics.
 * Tất cả endpoints đều yêu cầu header `x-tenant-id` và query từ MongoDB (không động ES).
 * Dữ liệu được pre-aggregate mỗi 5 phút bởi ETL pipeline.
 */
@ApiTags('Metrics')
@ApiHeader({
  name: 'x-tenant-id',
  description: 'Tenant identifier (required)',
  required: true,
})
@ApiHeader({
  name: 'x-internal-api-key',
  description: 'Internal API key for server-to-server auth',
  required: true,
})
@UseGuards(InternalApiGuard)
@Controller('metrics')
export class MetricsApiController {
  constructor(private readonly metricsApiService: MetricsApiService) {}

  /**
   * Lấy platform metrics: tỷ lệ nhận, render, lỗi theo platform.
   * Dùng cho tab "Tổng quan".
   */
  @Get('platform')
  @ApiOperation({ summary: 'Get platform metrics' })
  @ApiResponse({ status: 200, description: 'List of platform metrics' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async getPlatform(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: MetricsQueryDto,
  ) {
    return this.metricsApiService.getPlatformMetrics(tenantId, query);
  }

  /**
   * Lấy device breakdown: phân bố theo browser/OS/device class.
   * Dùng cho tab "Thiết bị".
   */
  @Get('device')
  @ApiOperation({ summary: 'Get device breakdown' })
  @ApiResponse({ status: 200, description: 'List of device breakdowns' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async getDevice(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: MetricsQueryDto,
  ) {
    return this.metricsApiService.getDeviceBreakdown(tenantId, query);
  }

  /**
   * Lấy transport comparison: WebSocket vs Long Polling.
   * Dùng cho tab "Transport".
   */
  @Get('transport')
  @ApiOperation({ summary: 'Get transport comparison' })
  @ApiResponse({ status: 200, description: 'List of transport comparisons' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async getTransport(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: MetricsQueryDto,
  ) {
    return this.metricsApiService.getTransportComparison(tenantId, query);
  }

  /**
   * Lấy SDK version distribution.
   * Dùng cho tab "SDK".
   */
  @Get('sdk')
  @ApiOperation({ summary: 'Get SDK version metrics' })
  @ApiResponse({ status: 200, description: 'List of SDK version metrics' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async getSdk(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: MetricsQueryDto,
  ) {
    return this.metricsApiService.getSdkVersions(tenantId, query);
  }

  /**
   * Lấy failure analysis: lý do lỗi × bước lỗi.
   * Dùng cho tab "Lỗi".
   */
  @Get('failures')
  @ApiOperation({ summary: 'Get failure analysis' })
  @ApiResponse({ status: 200, description: 'List of failure records' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async getFailures(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: MetricsQueryDto,
  ) {
    return this.metricsApiService.getFailures(tenantId, query);
  }

  /**
   * Lấy latency percentiles: p50/p75/p95/p99.
   * Dùng cho tab "Latency".
   */
  @Get('latency')
  @ApiOperation({ summary: 'Get latency percentiles' })
  @ApiResponse({ status: 200, description: 'List of latency records' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async getLatency(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: MetricsQueryDto,
  ) {
    return this.metricsApiService.getLatency(tenantId, query);
  }

  /**
   * Lấy timeseries data cho biểu đồ xu hướng.
   * Có thể filter theo metric name để lấy 1 series cụ thể.
   * Dùng cho biểu đồ thờ gian trên dashboard.
   */
  @Get('timeseries')
  @ApiOperation({ summary: 'Get timeseries data' })
  @ApiQuery({
    name: 'metric',
    required: false,
    description: 'Metric name filter (e.g. sent, received, rendered, failed, avgRenderMs)',
    example: 'sent',
  })
  @ApiResponse({ status: 200, description: 'List of timeseries points' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async getTimeseries(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: MetricsQueryDto,
    @Query('metric') metric?: string,
  ) {
    return this.metricsApiService.getTimeseries(tenantId, query, metric);
  }

  /**
   * Trigger backfill/recalculate cho match cụ thể.
   * Dùng khi cần tính lại dữ liệu cho match chưa tính xong hoặc data chưa phải mới nhất.
   * Enqueue job vào BullMQ queue để processor xử lý async.
   */
  @Post('backfill')
  @ApiOperation({ summary: 'Trigger backfill/recalculate for a match' })
  @ApiResponse({ status: 202, description: 'Job enqueued successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async backfill(
    @Headers('x-tenant-id') tenantId: string,
    @Body() dto: BackfillJobDto,
  ) {
    return this.metricsApiService.triggerBackfill(tenantId, dto);
  }

  /**
   * Lấy danh sách scheduler targets đang active.
   */
  @Get('scheduler-targets')
  @ApiOperation({ summary: 'Get active scheduler targets' })
  @ApiResponse({ status: 200, description: 'List of scheduler targets' })
  async getSchedulerTargets(
    @Headers('x-tenant-id') tenantId: string,
  ) {
    return this.metricsApiService.getSchedulerTargets(tenantId);
  }

  /**
   * Thêm hoặc cập nhật scheduler target.
   */
  @Post('scheduler-targets')
  @ApiOperation({ summary: 'Add or update scheduler target' })
  @ApiResponse({ status: 200, description: 'Target upserted' })
  async upsertSchedulerTarget(
    @Headers('x-tenant-id') tenantId: string,
    @Body() dto: SchedulerTargetDto,
  ) {
    return this.metricsApiService.upsertSchedulerTarget(tenantId, dto);
  }

  /**
   * Vô hiệu hóa scheduler target.
   */
  @Patch('scheduler-targets/:matchId/disable')
  @ApiOperation({ summary: 'Disable scheduler target' })
  @ApiResponse({ status: 200, description: 'Target disabled' })
  async disableSchedulerTarget(
    @Headers('x-tenant-id') tenantId: string,
    @Param('matchId') matchId: string,
  ) {
    return this.metricsApiService.disableSchedulerTarget(tenantId, matchId);
  }
}
