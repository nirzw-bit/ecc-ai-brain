export interface QuotaSample {
  metric: string; value: number; softLimit: number; unit: string;
}
export function shouldDefer(sample: QuotaSample): boolean {
  return !Number.isFinite(sample.value) || sample.value >= sample.softLimit;
}
export const FREE_TIER_SOFT_LIMITS = {
  workerRequestsPerDay: 75_000,
  d1RowsReadPerDay: 3_500_000,
  d1RowsWrittenPerDay: 70_000,
  d1StorageBytes: 400 * 1024 * 1024,
  r2StorageBytes: 8 * 1024 * 1024 * 1024
} as const;
