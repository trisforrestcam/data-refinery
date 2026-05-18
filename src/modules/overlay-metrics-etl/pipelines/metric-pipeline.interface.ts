import { MetricType } from '@domain/enums/metric-type.enum';
import { PipelineContext } from './pipeline.context';

/**
 * Interface chung cho mỗi metric pipeline trong ETL.
 * Mỗi metric type = 1 class implement interface này.
 * Strategy pattern giúp thêm metric mới mà không cần sửa processor hay file khác.
 */
export interface MetricPipeline {
  /** Metric type duy nhất để phân biệt pipeline. */
  readonly type: MetricType;

  /**
   * Thực thi toàn bộ flow extract → transform → load cho metric type này.
   * Mỗi pipeline tự quản lý error handling và logging riêng.
   */
  execute(ctx: PipelineContext): Promise<void>;
}
