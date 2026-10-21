import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocsFromServer, limit, query } from 'firebase/firestore';
import { db } from '../../firebase';
import { useApp } from '../../AppContext';
import { BACKUP_REMIND_DAYS, daysSinceBackup, readLastBackup } from '../../lib/backup';
import { clearErrors, errorReport, quotaErrors, readErrors, subscribeErrors, type ErrorEntry } from '../../lib/errorLog';
import { checkIntegrity } from '../../lib/integrity';
import { COLLECTION_JOB_ORDERS, type JobOrder } from '../../lib/jobOrders';
import { COLLECTIONS, type Customer, type Department, type Process, type Supplier } from '../../lib/masters';
import { readinessWorkspace } from '../../lib/readiness';
import { summarize } from '../../lib/syncState';
import { formatDateTime } from '../../lib/time';
import { useCollection } from '../masters/useCollection';
import { useMasterData } from '../masters/useMasterData';
import { useSyncOps } from '../sync/syncStore';

export function useErrors(): ErrorEntry[] {
  const [list, setList] = useState(readErrors);
  useEffect(() => subscribeErrors(() => setList(readErrors())), []);
  return list;
}

/** Collections added to the rules over time: if one cannot be read, the published rules are older than the app. */
const RULES_PROBES = [
  { collection: 'processes', since: 'Phase 4 (processes, calendar)' },
  { collection: 'departments', since: 'departments and contacts' },
];

type RulesState = { state: 'idle' | 'checking' | 'ok' | 'old' | 'error'; text?: string };

/** Settings card: backups, sync, errors on this phone, rules version and data checks. */
export function HealthCard() {
  const app = useApp();
  const { workspaceId, mode, online } = app;
  const errors = useErrors();
  const counts = summarize(useSyncOps());
  const actualWs = readinessWorkspace(app.user?.uid, workspaceId);
  const actualDays = actualWs ? daysSinceBackup(readLastBackup(actualWs), new Date()) : null;
  const [rules, setRules] = useState<RulesState>({ state: 'idle' });
  const [checks, setChecks] = useState(false);
  const [copied, setCopied] = useState(false);
  const quota = quotaErrors(errors);

  async function checkRules() {
    if (!workspaceId) return;
    setRules({ state: 'checking' });
    try {
      for (const p of RULES_PROBES) {
        try {
          await getDocsFromServer(query(collection(db, `workspaces/${workspaceId}/${p.collection}`), limit(1)));
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code === 'permission-denied') return setRules({ state: 'old', text: `The published Firestore rules are older than the app (missing ${p.since}).` });
          throw e;
        }
      }
      setRules({ state: 'ok' });
    } catch (e) {
      setRules({ state: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function copy() {
    const text = errorReport(errors, { userAgent: navigator.userAgent });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy these error details:', text);
    }
  }

  const backupOk = actualDays !== null && actualDays <= BACKUP_REMIND_DAYS;
  return (
    <div className="card health">
      <h3>System health</h3>
      <ul className="health-list">
        <li>
          <span className={`dot ${backupOk ? 'ok' : 'warn'}`} aria-hidden="true" />
          <span>
            ACTUAL backup: {actualDays === null ? 'never taken on this phone' : actualDays === 0 ? 'today' : `${actualDays} day${actualDays === 1 ? '' : 's'} ago`}
            {!backupOk && <span className="muted small block">Take one at least every {BACKUP_REMIND_DAYS} days (Backup, above, in ACTUAL mode).</span>}
          </span>
        </li>
        <li>
          <span className={`dot ${counts.FAILED + counts.CONFLICT > 0 ? 'bad' : counts.PENDING > 0 ? 'warn' : 'ok'}`} aria-hidden="true" />
          <span>
            Sync: {counts.PENDING} waiting · {counts.FAILED} failed · {counts.CONFLICT} conflict{counts.CONFLICT === 1 ? '' : 's'}
            {counts.PENDING > 0 && !online && <span className="muted small block">Waiting for the internet. Do not clear the browser data until they are sent.</span>}
          </span>
        </li>
        <li>
          <span className={`dot ${quota.length ? 'bad' : errors.length ? 'warn' : 'ok'}`} aria-hidden="true" />
          <span>
            Errors on this phone: {errors.length}
            {errors[0] && (
              <span className="muted small block">
                Last: {formatDateTime(new Date(errors[0].at))} · {errors[0].where} · {errors[0].message.slice(0, 120)}
              </span>
            )}
            {quota.length > 0 && <span className="error small block">The free plan’s daily limit was reached ({formatDateTime(new Date(quota[0]!.at))}). Saving resumes the next day; nothing saved is lost.</span>}
          </span>
        </li>
        <li>
          <span className={`dot ${rules.state === 'ok' ? 'ok' : rules.state === 'old' || rules.state === 'error' ? 'bad' : 'idle'}`} aria-hidden="true" />
          <span>
            Firestore rules:{' '}
            {rules.state === 'idle' ? 'not checked' : rules.state === 'checking' ? 'checking…' : rules.state === 'ok' ? 'up to date' : rules.text}
            {rules.state === 'old' && <span className="small block">Publish firestore.rules from GitHub in the Firebase console (Firestore → Rules → Publish).</span>}
          </span>
        </li>
      </ul>
      <div className="row gap wrap">
        <button type="button" className="secondary small" disabled={!online || rules.state === 'checking'} onClick={() => void checkRules()}>
          Check rules
        </button>
        <button type="button" className="secondary small" onClick={() => setChecks(true)} disabled={checks}>
          Check data ({mode})
        </button>
        {errors.length > 0 && (
          <>
            <button type="button" className="secondary small" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy error details'}
            </button>
            <button type="button" className="secondary small" onClick={() => window.confirm('Clear the error list on this phone?') && clearErrors()}>
              Clear errors
            </button>
          </>
        )}
      </div>
      {checks && <DataChecks />}
      <p className="muted small">Errors are kept on this phone only (last 50) and are never sent anywhere. Copy them when asking for a fix.</p>
    </div>
  );
}

/** Loads the workspace data only when asked, then lists anything that does not fit together. */
function DataChecks() {
  const { workspaceId } = useApp();
  const master = useMasterData(workspaceId);
  const jos = useCollection<JobOrder>(workspaceId, COLLECTION_JOB_ORDERS);
  const customers = useCollection<Customer>(workspaceId, COLLECTIONS.customers);
  const processes = useCollection<Process>(workspaceId, COLLECTIONS.processes);
  const suppliers = useCollection<Supplier>(workspaceId, COLLECTIONS.suppliers);
  const departments = useCollection<Department>(workspaceId, COLLECTIONS.departments);
  const loading = master.loading || jos.loading || customers.loading || processes.loading || suppliers.loading;
  const issues = useMemo(
    () => (loading ? [] : checkIntegrity({ md: master.md, jobOrders: jos.items, customers: customers.items, processes: processes.items, suppliers: suppliers.items, departments: departments.items })),
    [loading, master.md, jos.items, customers.items, processes.items, suppliers.items, departments.items],
  );
  if (loading) return <p className="muted small">Checking…</p>;
  if (issues.length === 0) return <p className="ok small">All records fit together: no missing links, loops or broken orders found.</p>;
  return (
    <ul className="attention small">
      {issues.map((i, n) => (
        <li key={n}>
          <Link to={i.link}>
            <span className={`pill ${i.severity === 'error' ? 'bad' : 'warn'}`}>{i.severity === 'error' ? 'Fix' : 'Check'}</span> {i.text}
          </Link>
        </li>
      ))}
    </ul>
  );
}
