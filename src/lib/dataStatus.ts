/** Data confidence / provenance (Requirements §41, §75.1). */
export const DATA_STATUSES = [
  'VERIFIED',
  'USER_PROVIDED',
  'ESTIMATED',
  'PENDING_VERIFICATION',
  'UNAVAILABLE',
] as const;

export type DataStatus = (typeof DATA_STATUSES)[number];

/**
 * Labels say how sure a figure is and where it came from (confirmed 21 Oct
 * 2026) — not who typed it: everything is entered by the user.
 */
export const DATA_STATUS_LABEL: Record<DataStatus, string> = {
  VERIFIED: 'Confirmed',
  USER_PROVIDED: 'Known',
  ESTIMATED: 'My estimate',
  PENDING_VERIFICATION: 'To be confirmed',
  UNAVAILABLE: 'Not available',
};

export const DATA_STATUS_HINT: Record<DataStatus, string> = {
  VERIFIED: 'Checked in a company document or confirmed by the person responsible.',
  USER_PROVIDED: 'I know it or was told it; good enough to use.',
  ESTIMATED: 'An approximate figure; used, but marked as an estimate.',
  PENDING_VERIFICATION: 'Not known yet; to be asked. Not used in calculations.',
  UNAVAILABLE: 'Cannot be obtained for now. Not used in calculations.',
};

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
