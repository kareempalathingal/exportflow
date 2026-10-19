import { daysBetween, deadlineState, JO_STATUS_LABEL, type JobOrder, type JoStatus } from '../../lib/jobOrders';

const STATUS_CLS: Record<JoStatus, string> = { DRAFT: 'neutral', CONFIRMED: 'ok', COMPLETED: 'neutral', CANCELLED: 'bad' };

export function StatusPill({ status }: { status: JoStatus }) {
  return <span className={`pill ${STATUS_CLS[status]}`}>{JO_STATUS_LABEL[status]}</span>;
}

/** Days left to the internal deadline, or what has been missed. */
export function DeadlinePill({ jo, today }: { jo: Pick<JobOrder, 'status' | 'deadline' | 'deliveryDate'>; today: string }) {
  const st = deadlineState(jo, today);
  if (st === 'CLOSED') return null;
  if (st === 'DELIVERY_PASSED') return <span className="pill bad">Delivery date passed</span>;
  if (st === 'OVERDUE') return <span className="pill bad">Internal deadline passed</span>;
  const left = daysBetween(today, jo.deadline.internalDeadline) ?? 0;
  const text = left === 0 ? 'Due today' : `${left} day${left === 1 ? '' : 's'} left`;
  return <span className={`pill ${st === 'DUE_SOON' ? 'warn' : 'ok'}`}>{text}</span>;
}

export function permissionHint(error: string | null): string | null {
  if (!error) return null;
  return error === 'permission-denied'
    ? 'No access to Job Orders. If the app was just updated, publish the new Firestore rules in the Firebase console.'
    : `Could not load Job Orders (${error}).`;
}
