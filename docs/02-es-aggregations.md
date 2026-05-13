# ES Aggregation Queries — Overlay Metrics

> Tài liệu này định nghĩa toàn bộ Elasticsearch aggregation queries được dùng trong ETL pipeline. **Mục tiêu: đưa 100% logic tính toán vào ES query**, Transformer chỉ cần map buckets sang DTO.

## 1. Platform Metrics (Tổng quan)

```json
{
  "size": 0,
  "query": {
    "bool": {
      "must": [
        { "term": { "labels.timeline_id": "{{timelineId}}" } },
        { "term": { "labels.tenant_id": "{{tenantId}}" } },
        { "term": { "labels.environment": "{{environment}}" } },
        { "range": { "@timestamp": { "gte": "{{from}}", "lte": "{{to}}" } } }
      ]
    }
  },
  "aggs": {
    "platforms": {
      "terms": {
        "field": "labels.platform",
        "size": 100,
        "missing": "unknown"
      },
      "aggs": {
        "sent": {
          "filter": { "term": { "labels.stage": "sent" } },
          "aggs": {
            "room_size_sum": { "sum": { "field": "numeric_labels.room_size" } }
          }
        },
        "received": {
          "filter": { "term": { "labels.stage": "received" } }
        },
        "rendered": {
          "filter": { "term": { "labels.stage": "rendered" } },
          "aggs": {
            "avg_render_ms": { "avg": { "field": "numeric_labels.render_duration_ms" } }
          }
        },
        "failed": {
          "filter": { "term": { "labels.stage": "render-failed" } }
        }
      }
    }
  }
}
```

**Công thức tính ở Transformer:**

| Field | Công thức |
|-------|-----------|
| `sent` | `platforms.buckets[i].sent.room_size_sum.value` |
| `received` | `platforms.buckets[i].received.doc_count` |
| `rendered` | `platforms.buckets[i].rendered.doc_count` |
| `failed` | `platforms.buckets[i].failed.doc_count` |
| `receiveRate` | `received / sent * 100` |
| `renderRate` | `rendered / sent * 100` |
| `failureRate` | `failed / received * 100` |
| `avgRenderMs` | `platforms.buckets[i].rendered.avg_render_ms.value` |

---

## 2. Device Breakdown (Thiết bị)

Dimension: `browser` | `os` | `deviceClass`

```json
{
  "size": 0,
  "query": { "bool": { "must": [...] } },
  "aggs": {
    "by_dimension": {
      "terms": {
        "field": "labels.{{dimensionField}}",
        "size": 50,
        "missing": "unknown"
      },
      "aggs": {
        "by_stage": {
          "filters": {
            "filters": {
              "received": { "term": { "labels.stage": "received" } },
              "rendered": { "term": { "labels.stage": "rendered" } },
              "failed": { "term": { "labels.stage": "render-failed" } }
            }
          },
          "aggs": {
            "avg_render_ms": { "avg": { "field": "numeric_labels.render_duration_ms" } }
          }
        }
      }
    }
  }
}
```

**Field mapping:**

| Dimension | ES field |
|-----------|----------|
| `browser` | `labels.browser` |
| `os` | `labels.client_os` |
| `deviceClass` | `labels.device_class` |

---

## 3. Transport Comparison (Transport)

```json
{
  "size": 0,
  "query": { "bool": { "must": [...] } },
  "aggs": {
    "by_transport": {
      "terms": {
        "field": "labels.transport_mode",
        "size": 10,
        "missing": "unknown"
      },
      "aggs": {
        "by_stage": {
          "filters": {
            "filters": {
              "received": { "term": { "labels.stage": "received" } },
              "rendered": { "term": { "labels.stage": "rendered" } }
            }
          },
          "aggs": {
            "avg_render_ms": { "avg": { "field": "numeric_labels.render_duration_ms" } },
            "p95_render_ms": {
              "percentiles": {
                "field": "numeric_labels.render_duration_ms",
                "percents": [95]
              }
            }
          }
        }
      }
    }
  }
}
```

---

## 4. SDK Versions (SDK)

```json
{
  "size": 0,
  "query": { "bool": { "must": [...] } },
  "aggs": {
    "by_sdk_version": {
      "terms": {
        "field": "labels.sdk_version",
        "size": 50,
        "missing": "unknown"
      },
      "aggs": {
        "by_stage": {
          "filters": {
            "filters": {
              "received": { "term": { "labels.stage": "received" } },
              "rendered": { "term": { "labels.stage": "rendered" } }
            }
          },
          "aggs": {
            "avg_render_ms": { "avg": { "field": "numeric_labels.render_duration_ms" } }
          }
        }
      }
    }
  }
}
```

---

## 5. Failure Analysis (Lỗi)

```json
{
  "size": 0,
  "query": { "bool": { "must": [...] } },
  "aggs": {
    "by_reason": {
      "terms": {
        "field": "labels.failure_reason",
        "size": 50
      },
      "aggs": {
        "by_step": {
          "terms": {
            "field": "labels.failure_step",
            "size": 20
          }
        }
      }
    }
  }
}
```

**Công thức tính:**
- `totalFailed` = sum(doc_count of all step buckets)
- `percentOfFailed` = `count / totalFailed * 100`

---

## 6. Latency Percentiles (Độ trễ)

```json
{
  "size": 0,
  "query": { "bool": { "must": [...] } },
  "aggs": {
    "receive_latency": {
      "percentiles": {
        "field": "numeric_labels.receive_latency_ms",
        "percents": [50, 75, 95, 99]
      }
    },
    "render_latency": {
      "percentiles": {
        "field": "numeric_labels.render_duration_ms",
        "percents": [50, 75, 95, 99]
      }
    },
    "ack_latency": {
      "percentiles": {
        "field": "numeric_labels.ack_latency_ms",
        "percents": [50, 75, 95, 99]
      }
    },
    "receive_stats": { "stats": { "field": "numeric_labels.receive_latency_ms" } },
    "render_stats": { "stats": { "field": "numeric_labels.render_duration_ms" } },
    "ack_stats": { "stats": { "field": "numeric_labels.ack_latency_ms" } },
    "render_duration": {
      "percentiles": {
        "field": "numeric_labels.render_duration_ms",
        "percents": [50, 95, 99]
      }
    }
  }
}
```

---

## 7. Timeseries (Thờ gian)

```json
{
  "size": 0,
  "query": { "bool": { "must": [...] } },
  "aggs": {
    "timeseries": {
      "date_histogram": {
        "field": "@timestamp",
        "fixed_interval": "{{interval}}"
      },
      "aggs": {
        "metric_value": {
          "{{metricAggType}}": {
            "field": "{{metricField}}"
          }
        }
      }
    }
  }
}
```

**Metric mapping:**

| Metric | Agg type | Field |
|--------|----------|-------|
| `sent` | `sum` | `numeric_labels.room_size` |
| `received` | `filter` + `value_count` | `labels.stage: received` |
| `rendered` | `filter` + `value_count` | `labels.stage: rendered` |
| `failed` | `filter` + `value_count` | `labels.stage: render-failed` |
| `avgRenderMs` | `avg` | `numeric_labels.render_duration_ms` |

---

## 8. Match-Level Funnel (by matchId)

Khi query theo `matchId`, cần resolve `timelineIds` trước, sau đó dùng `terms` filter:

```json
{
  "size": 0,
  "query": {
    "bool": {
      "must": [
        { "terms": { "labels.timeline_id": ["t1", "t2", "t3"] } },
        { "term": { "labels.tenant_id": "{{tenantId}}" } }
      ]
    }
  },
  "aggs": {
    "stages": {
      "filters": {
        "filters": {
          "sent": { "term": { "labels.stage": "sent" } },
          "received": { "term": { "labels.stage": "received" } },
          "rendered": { "term": { "labels.stage": "rendered" } },
          "failed": { "term": { "labels.stage": "render-failed" } }
        }
      },
      "aggs": {
        "room_size_sum": { "sum": { "field": "numeric_labels.room_size" } }
      }
    },
    "by_timeline": {
      "terms": { "field": "labels.timeline_id", "size": 500 },
      "aggs": {
        "sent": {
          "filter": { "term": { "labels.stage": "sent" } },
          "aggs": { "room_size_sum": { "sum": { "field": "numeric_labels.room_size" } } }
        },
        "received": { "filter": { "term": { "labels.stage": "received" } } },
        "rendered": { "filter": { "term": { "labels.stage": "rendered" } } }
      }
    }
  }
}
```

---

## Quy ước chung

- **Environment filter:** Luôn thêm `{ "term": { "labels.environment": "{{env}}" } }`
- **Time range:** Dùng `range` trên `@timestamp` với `gte`/`lte`
- **Platform filter (optional):** Thêm `{ "term": { "labels.platform": "{{platform}}" } }`
- **Missing values:** Dùng `"missing": "unknown"` cho `terms` aggregation
- **Size:** `size: 0` ở query root (không cần hits)
