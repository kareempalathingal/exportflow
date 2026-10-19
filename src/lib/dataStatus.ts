/** Data confidence / provenance (Requirements §41, §75.1). */
export const DATA_STATUSES = [
  'VERIFIED',
  'USER_PROVIDED',
  'ESTIMATED',
  'PENDING_VERIFICATION',
  'UNAVAILABLE',
] as const;

export type DataStatus = (typeof DATA_STATUSES)[number];

export interface Tracked<T> {
  value: T | null;
  status: DataStatus;
  source: string;
}

export function tracked<T>(value: T | null, status: DataStatus, source = ''): Tracked<T> {
  if (value === null && status !== 'UNAVAILABLE' && status !== 'PENDING_VERIFICATION') {
    throw new Error('An empty value must be Unavailable or Pending Verification');
  }
  return { value, status, source: source.trim() };
}

export function unavailable<T>(): Tracked<T> {
  return { value: null, status: 'UNAVAILABLE', source: '' };
}

export function isDataStatus(v: unknown): v is DataStatus {
  return typeof v === 'string' && (DATA_STATUSES as readonly string[]).includes(v);
}

/** True when a value may be used as a firm input to a calculation. */
export function isUsableForCalculation(t: Tracked<unknown>): boolean {
  return t.value !== null && (t.status === 'VERIFIED' || t.status === 'USER_PROVIDED');
}
