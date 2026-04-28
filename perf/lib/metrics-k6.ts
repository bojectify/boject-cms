import { Trend, Counter } from 'k6/metrics';

export const drainLatency = new Trend('perf_drain_page_ms', true);
export const drainWallClock = new Trend('perf_drain_total_ms', true);
export const crudCreateLatency = new Trend('perf_crud_create_ms', true);
export const crudReadLatency = new Trend('perf_crud_read_ms', true);
export const crudDeleteLatency = new Trend('perf_crud_delete_ms', true);
export const intentional429s = new Counter('perf_intentional_429');
export const unexpectedErrors = new Counter('perf_unexpected_errors');
