import {
  Controller,
  Get,
  Headers,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RealtimeService } from './realtime.service';
import {
  RealtimeQueryDto,
  RealtimeDeviceQueryDto,
  RealtimeTimeseriesQueryDto,
} from './realtime-query.dto';
import { InternalApiGuard } from '@common/guards/internal-api.guard';
import {
  ApiTags,
  ApiHeader,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';

/**
 * Realtime tracking API — query ES trực tiếp và return data format tương thích
 * với backend's TrackingModule DTOs.
 * Backend gọi endpoints này thay vì query ES trực tiếp.
 */
@ApiTags('Realtime')
@ApiHeader({ name: 'x-tenant-id', description: 'Tenant identifier', required: true })
@ApiHeader({ name: 'x-internal-api-key', description: 'Internal API key', required: true })
@UseGuards(InternalApiGuard)
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtimeService: RealtimeService) {}

  @Get('funnel')
  @ApiOperation({ summary: 'Get funnel metrics (realtime from ES)' })
  async getFunnel(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: RealtimeQueryDto,
  ) {
    return this.realtimeService.getFunnel(query, tenantId);
  }

  @Get('latency')
  @ApiOperation({ summary: 'Get latency percentiles (realtime from ES)' })
  async getLatency(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: RealtimeQueryDto,
  ) {
    return this.realtimeService.getLatency(query, tenantId);
  }

  @Get('failures')
  @ApiOperation({ summary: 'Get failure analysis (realtime from ES)' })
  async getFailures(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: RealtimeQueryDto,
  ) {
    return this.realtimeService.getFailures(query, tenantId);
  }

  @Get('device-breakdown')
  @ApiOperation({ summary: 'Get device breakdown (realtime from ES)' })
  async getDeviceBreakdown(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: RealtimeDeviceQueryDto,
  ) {
    return this.realtimeService.getDeviceBreakdown(query, tenantId);
  }

  @Get('transport-comparison')
  @ApiOperation({ summary: 'Get transport comparison (realtime from ES)' })
  async getTransportComparison(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: RealtimeQueryDto,
  ) {
    return this.realtimeService.getTransportComparison(query, tenantId);
  }

  @Get('sdk-versions')
  @ApiOperation({ summary: 'Get SDK version distribution (realtime from ES)' })
  async getSdkVersions(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: RealtimeQueryDto,
  ) {
    return this.realtimeService.getSdkVersions(query, tenantId);
  }

  @Get('timeseries')
  @ApiOperation({ summary: 'Get timeseries data (realtime from ES)' })
  async getTimeseries(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: RealtimeTimeseriesQueryDto,
  ) {
    return this.realtimeService.getTimeseries(query, tenantId);
  }

  @Get('heatmap')
  @ApiOperation({ summary: 'Get heatmap/platform breakdown (realtime from ES)' })
  async getHeatmap(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: RealtimeQueryDto,
  ) {
    return this.realtimeService.getHeatmap(query, tenantId);
  }

  @Get('debug/funnel')
  @ApiOperation({ summary: 'Debug funnel pipeline — trả về ES query + raw aggregations + transformed data' })
  async debugFunnel(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: RealtimeQueryDto,
  ) {
    return this.realtimeService.debugFunnel(query, tenantId);
  }

  @Get('debug/latency')
  @ApiOperation({ summary: 'Debug latency pipeline — trả về ES query + raw aggregations + transformed data' })
  async debugLatency(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: RealtimeQueryDto,
  ) {
    return this.realtimeService.debugLatency(query, tenantId);
  }
}
