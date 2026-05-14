/**
 * Thông tin tenant được cache từ collection `tenants` trong DB gốc.
 * Key là `name` (vd: 'vtvlive').
 */
export interface Tenant {
  /** Tên tenant — dùng làm key trong cache */
  name: string;

  /** MongoDB URI riêng của tenant */
  mongoUri: string;

  /** Trạng thái: ACTIVE, INACTIVE, v.v. */
  status: string;
}
