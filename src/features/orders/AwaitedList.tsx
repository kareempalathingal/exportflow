import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDay, type JobOrder } from '../../lib/jobOrders';
import type { Supplier } from '../../lib/masters';
import { supplierMessage } from '../../lib/contacts';
import { awaitedItems, awaitedText, AWAITED_BUCKET_LABEL, AWAITED_KIND_LABEL, type AwaitedBucket, type AwaitedItem, type AwaitedKind } from '../../lib/followUp';
import { awaitedDoc } from '../../lib/docs/managerDocs';
import type { PlanContext } from '../../lib/route';
import { formatDateTime } from '../../lib/time';
import { DocButtons } from '../docs/DocButtons';
import { SupplierContact } from '../masters/ContactButtons';
import { shareText } from '../reports/TodayCard';

/** Everything awaited from outside, all orders (mockup C, confirmed 5 Nov 2026): late first. */
export function AwaitedList(props: { jos: (JobOrder & { id: string })[]; ctx: PlanContext; suppliers: (Supplier & { id: string })[]; today: string; alertDays: number; company: string }) {
  const { today } = props;
  const [kind, setKind] = useState<AwaitedKind | 'ALL'>('ALL');
  const [msg, setMsg] = useState<string | null>(null);
  const all = useMemo(() => awaitedItems(props.jos, props.ctx, today, props.alertDays), [props.jos, props.ctx, today, props.alertDays]);
  const sup = useMemo(() => new Map(props.suppliers.map((s) => [s.id, s])), [props.suppliers]);
  const name = (id: string | null) => (id ? (sup.get(id)?.name ?? 'Supplier') : 'No supplier yet');
  const items = kind === 'ALL' ? all : all.filter((i) => i.kind === kind);
  const count = (k: AwaitedKind) => all.filter((i) => i.kind === k).length;

  return (
    <section>
      <p className="muted small">Job work sent out, bought items and materials still to come in, from every confirmed order. Dates are the ones the supplier or vendor gave.</p>
      <div className="chips" role="group" aria-label="Filter">
        <button type="button" className={kind === 'ALL' ? 'chip on' : 'chip'} onClick={() => setKind('ALL')}>
          All {all.length}
        </button>
        {(['JOB_WORK', 'BOUGHT', 'MATERIAL'] as AwaitedKind[]).map((k) => (
          <button key={k} type="button" className={kind === k ? 'chip on' : 'chip'} onClick={() => setKind(k)}>
            {AWAITED_KIND_LABEL[k]} {count(k)}
          </button>
        ))}
      </div>
      {items.length === 0 && <p className="muted">Nothing awaited{kind === 'ALL' ? '' : ' of this kind'}.</p>}
      {(['LATE', 'SOON', 'LATER', 'UNKNOWN'] as AwaitedBucket[]).map((b) => {
        const list = items.filter((i) => i.bucket === b);
        if (!list.length) return null;
        return (
          <div key={b} className="card">
            <h3 className={`small caps ${b === 'LATE' ? 'error' : b === 'SOON' || b === 'UNKNOWN' ? 'warn' : 'muted'}`}>{AWAITED_BUCKET_LABEL[b]}</h3>
            <ul className="plain-list awaited">
              {list.map((i) => (
                <AwaitedRow key={`${i.joId}-${i.kind}-${i.what}-${i.product}`} i={i} supplier={i.supplierId ? sup.get(i.supplierId) : undefined} name={name(i.supplierId)} today={today} />
              ))}
            </ul>
          </div>
        );
      })}
      {all.length > 0 && (
        <div className="card doc-card">
          <button
            type="button"
            className="secondary small"
            onClick={async () => {
              const r = await shareText('Awaited from outside', awaitedText(items, name, formatDay, today));
              setMsg(r === 'copied' ? 'Copied — paste it into WhatsApp or email.' : null);
            }}
          >
            Share list (text)
          </button>
          {msg && <p className="ok small">{msg}</p>}
          <DocButtons label="By supplier (PDF)" build={() => awaitedDoc(items, { company: props.company, today, generatedAt: `${formatDateTime(new Date())} IST`, supplierName: name })} />
        </div>
      )}
    </section>
  );
}

function AwaitedRow({ i, supplier, name, today }: { i: AwaitedItem; supplier: Supplier | undefined; name: string; today: string }) {
  const title = `Follow up: ${i.what}${i.product && i.product !== i.what ? ` (${i.product})` : ''} - ${name}${i.poNo ? ` PO ${i.poNo}` : ''}`;
  const task = `/work/new?${new URLSearchParams({ title, person: supplier?.contactPerson || supplier?.name || '', due: today, jo: i.joId, joNo: i.joNumber }).toString()}`;
  return (
    <li>
      <div className="row between">
        <strong>
          {i.what}
          <span className="muted small"> · {name}</span>
        </strong>
        <span className={`small ${i.bucket === 'LATE' ? 'error' : i.bucket === 'SOON' ? 'warn' : 'muted'}`}>
          {i.lateDays ? `${i.lateDays} day${i.lateDays === 1 ? '' : 's'} late` : i.expectedOn ? formatDay(i.expectedOn) : 'date to be confirmed'}
        </span>
      </div>
      <span className="small block">
        <Link to={i.link}>{i.joNumber}</Link>
        {i.product && i.product !== i.what && ` · ${i.product}`} · {i.outstanding}
        {i.poNo && ` · PO ${i.poNo}`}
        {i.promisedFirst && <span className="muted"> · first said {formatDay(i.promisedFirst)}</span>}
        {i.note && <span className="muted"> · {i.note}</span>}
      </span>
      <div className="row gap step-actions">
        <SupplierContact
          supplier={supplier}
          message={(p) => supplierMessage({ person: p.name, joNumber: i.joNumber, what: i.what, outstanding: i.outstanding, poNo: i.poNo, expectedOn: i.expectedOn ? formatDay(i.expectedOn) : null, late: !!i.lateDays })}
        />
        <Link className="button secondary small" to={task}>
          + Task
        </Link>
        <Link className="button secondary small" to={i.link}>
          New date
        </Link>
      </div>
    </li>
  );
}
