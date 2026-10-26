import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { useProfile } from '../settings/useProfile';
import { istDateKey } from '../../lib/time';
import { COLLECTIONS, masterAttention, type AttentionItem, type Department } from '../../lib/masters';
import { addDays, COLLECTION_JOB_ORDERS, deadlineUpdate, formatDay, isEditable, jobOrderAttention, type JoAttention, type JobOrder } from '../../lib/jobOrders';
import { useMasterData } from '../masters/useMasterData';
import { useCollection } from '../masters/useCollection';
import { permissionHint } from '../orders/OrderBits';
import { TrackBar } from '../orders/TrackBar';
import { COLLECTION_STOCK_COUNTS, overAllocated, parseItemKey, planMaterials, toBuyAcrossOrders, type StockCount } from '../../lib/materials';
import { gapColor, trackGroup, trackLabel, type Track } from '../../lib/progress';
import { lineProgresses, orderTrack, overrunningSteps } from '../../lib/route';
import { useWorkCalendar } from '../calendar/useWorkCalendar';
import { WorkCalendarCard } from '../calendar/WorkCalendarCard';
import { readRedAt } from '../../lib/theme';
import { backupReminder } from '../../lib/backup';
import { buildToday } from '../../lib/today';
import { KpiStrip } from '../reports/KpiPage';
import { TodayCard } from '../reports/TodayCard';
import { formatQty, unitLabel } from '../../lib/units';

const KIND: Record<AttentionItem['kind'], { title: string; hint: string; cls: string; tab: string }> = {
  BOM_MISSING: { title: 'BOM missing', hint: 'Raw materials cannot be calculated for this product.', cls: 'bad', tab: 'bom' },
  BOM_PROVISIONAL: { title: 'BOM not confirmed', hint: 'Some BOM lines are estimated or pending verification.', cls: 'warn', tab: 'bom' },
  NO_CONVERSION: { title: 'Size / GSM missing', hint: 'Orders in sq m or kg cannot be converted for this product.', cls: 'warn', tab: 'details' },
};

const JO_KIND: Record<JoAttention['kind'], { title: string; cls: string }> = {
  DELIVERY_PASSED: { title: 'Delivery date passed', cls: 'bad' },
  OVERDUE: { title: 'Internal deadline passed', cls: 'bad' },
  DUE_SOON: { title: 'Deadline near', cls: 'warn' },
  UNDECIDED: { title: 'Make or buy?', cls: 'warn' },
  CONVERSION: { title: 'Conversion needed', cls: 'warn' },
  BOM_CHANGED: { title: 'BOM changed', cls: 'warn' },
};

const GROUPS = [
  { id: 'ON_TRACK', label: 'On track', edge: 'oklch(0.58 0.13 150)' },
  { id: 'BEHIND', label: 'Behind', edge: 'oklch(0.72 0.15 75)' },
  { id: 'LATE', label: 'Late', edge: 'oklch(0.56 0.19 28)' },
  { id: 'NOT_TRACKED', label: 'Not tracked', edge: 'var(--line)' },
] as const;

const STRIP_DAYS = 21;
const dayHead = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Urgency order: late, then furthest behind, then untracked, drafts last. */
function urgency(t: Track): number {
  if (t.kind === 'LATE') return -1000 + t.daysLeft;
  if (t.kind === 'TRACKED') return t.gap ?? 0;
  if (t.kind === 'NOT_TRACKED') return 500;
  if (t.kind === 'DONE') return 800;
  return 900;
}

export function HomePage() {
  const { t, workspaceId, mode } = useApp();
  const { profile } = useProfile(workspaceId);
  const master = useMasterData(workspaceId);
  const jos = useCollection<JobOrder>(workspaceId, COLLECTION_JOB_ORDERS);
  const departments = useCollection<Department>(workspaceId, COLLECTIONS.departments);
  const counts = useCollection<StockCount>(workspaceId, COLLECTION_STOCK_COUNTS);
  const products = master.products;
  const company = profile?.companyName?.value;
  const today = istDateKey(new Date());
  const redAt = readRedAt();
  const { cal } = useWorkCalendar();
  const planningDays = profile?.planningDays;
  const ctx = useMemo(() => ({ md: master.md, cal, planningDays }), [master.md, cal, planningDays]);

  const open = useMemo(() => {
    return jos.items
      .filter((j) => isEditable(j.status))
      .map((j) => {
        const track = orderTrack(j, today, ctx);
        const now = j.status === 'DRAFT' ? [] : lineProgresses(j, today, ctx).map(({ line, lp }) => `${line.productName}: ${lp.current ? lp.current.step.label : 'done'}`);
        return { jo: j, track, now, color: gapColor(track, redAt) };
      })
      .sort((a, b) => urgency(a.track) - urgency(b.track));
  }, [jos.items, today, redAt, ctx]);

  const groupCount = useMemo(() => {
    const c: Record<string, number> = { ON_TRACK: 0, BEHIND: 0, LATE: 0, NOT_TRACKED: 0 };
    for (const o of open) c[trackGroup(o.track)]! += 1;
    return c;
  }, [open]);

  // Next three weeks: internal deadlines (solid) and customer deliveries (light).
  const strip = useMemo(() => {
    const days = Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i)!);
    const events: { date: string; label: string; color: string; strong: boolean }[] = [];
    for (const o of open) {
      if (o.jo.status !== 'CONFIRMED') continue;
      events.push({ date: o.jo.deadline.internalDeadline, label: `${o.jo.joNumber} internal deadline`, color: o.color, strong: true });
      events.push({ date: o.jo.deliveryDate, label: `${o.jo.joNumber} delivery`, color: o.color, strong: false });
    }
    const inRange = events.filter((e) => e.date >= today && e.date <= days[days.length - 1]!).sort((a, b) => a.date.localeCompare(b.date));
    const cells = days.map((d) => {
      const ev = inRange.filter((e) => e.date === d);
      const strong = ev.find((e) => e.strong);
      return { date: d, today: d === today, color: strong?.color ?? ev[0]?.color ?? null, light: !strong && ev.length > 0 };
    });
    return { cells, events: inRange };
  }, [open, today]);

  // Materials: how many required items are fully covered by stock set aside (confirmed orders).
  const materials = useMemo(() => {
    let covered = 0;
    let total = 0;
    for (const j of jos.items) {
      if (j.status !== 'CONFIRMED') continue;
      const p = planMaterials(j, master.md);
      for (const r of [...p.toProduce, ...p.toBuy]) {
        if (!(r.gross > 0)) continue;
        total += 1;
        if (r.net === 0) covered += 1;
      }
    }
    const buy = toBuyAcrossOrders(jos.items, master.md, false);
    return { covered, total, toBuy: buy.rows.length, incomplete: buy.ordersWithErrors.length };
  }, [jos.items, master.md]);

  const attention = useMemo(() => masterAttention(products.items, master.md), [products.items, master.md]);
  const joAttention = useMemo(
    () => jobOrderAttention(jos.items, master.md, master.bomRev, today).filter((a) => a.kind !== 'DUE_SOON'),
    [jos.items, master.md, master.bomRev, today],
  );
  const over = useMemo(
    () => overAllocated(jos.items, new Map(counts.items.map((c) => [`${c.itemType}_${c.itemId}`, c]))),
    [jos.items, counts.items],
  );
  const loading = master.loading || jos.loading;
  const overruns = useMemo(
    () => jos.items.filter((j) => j.status === 'CONFIRMED').flatMap((j) => overrunningSteps(j, today, ctx).map((o) => ({ jo: j, ...o }))),
    [jos.items, today, ctx],
  );
  const deadlineChanges = useMemo(
    () => jos.items.filter((j) => j.status === 'CONFIRMED').flatMap((j) => {
      const u = deadlineUpdate(j, cal);
      return u ? [{ jo: j, next: u }] : [];
    }),
    [jos.items, cal],
  );
  // ACTUAL only, once real data exists: remind to back up every 7 days.
  const backupDue = useMemo(
    () => backupReminder(mode, workspaceId, products.items.length > 0 || jos.items.length > 0, new Date()),
    [mode, workspaceId, products.items.length, jos.items.length],
  );
  // Backup stays in Needs attention; the shareable summary is about the orders.
  const todaySummary = useMemo(() => buildToday({ jobOrders: jos.items, ctx, today }), [jos.items, ctx, today]);
  const total = attention.length + joAttention.length + over.length + overruns.length + deadlineChanges.length + (backupDue ? 1 : 0);

  return (
    <section className="dash">
      <div className="row between dash-head">
        <div>
          <span className="mono muted small caps">{dayHead.format(new Date(`${today}T00:00:00Z`))}</span>
          <h2>Where orders stand</h2>
          {company && <span className="muted small">{company}</span>}
        </div>
        <div className="row dash-actions">
          <Link className="button secondary small icon-btn" to="/tools" aria-label="Calculator and unit converter" title="Calculator and unit converter">
            🧮
          </Link>
          <Link className="button primary small" to="/orders/new">
            + New JO
          </Link>
        </div>
      </div>

      {jos.error && <p className="error small">{permissionHint(jos.error)}</p>}

      {!loading && jos.items.some((j) => j.status === 'CONFIRMED' || j.status === 'DRAFT') && <TodayCard summary={todaySummary} company={company ?? ''} compact departments={departments.items} />}

      {!loading && <KpiStrip />}

      <section aria-label="Order status counts" className="counts">
        {GROUPS.map((g) => (
          <div key={g.id} style={{ boxShadow: `inset 0 4px 0 ${g.edge}` }}>
            <span className="mono count">{loading ? '–' : groupCount[g.id]}</span>
            <span className="muted small">{g.label}</span>
          </div>
        ))}
      </section>

      <section aria-labelledby="h-strip" className="card">
        <h3 id="h-strip">Next 3 weeks</h3>
        <div className="strip" aria-hidden="true">
          {strip.cells.map((c) => (
            <div
              key={c.date}
              className={`strip-day${c.today ? ' today' : ''}${c.light ? ' light' : ''}`}
              style={c.color && !c.today ? { ['--day' as string]: c.color } : undefined}
            />
          ))}
        </div>
        {strip.events.length === 0 ? (
          <p className="muted small">No deadlines or deliveries in the next 3 weeks.</p>
        ) : (
          <ul className="strip-list small">
            {strip.events.slice(0, 5).map((e) => (
              <li key={`${e.date}-${e.label}`}>
                <span className="dot" style={{ background: e.color, opacity: e.strong ? 1 : 0.45 }} aria-hidden="true" />
                <span className="mono">{formatDay(e.date).slice(0, 6)}</span> {e.label}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="h-pva">
        <h3 id="h-pva">Planned vs actual</h3>
        {!loading && open.length === 0 && <p className="muted">{t('homeEmpty')}</p>}
        <ul className="master-list">
          {open.map(({ jo, track, color, now }) => (
            <li key={jo.id}>
              <Link
                to={`/orders/${jo.id}`}
                className={`card link edge${jo.status === 'DRAFT' ? ' dashed' : ''}`}
                style={{ ['--edge' as string]: jo.status === 'DRAFT' ? 'transparent' : color }}
              >
                <div className="row between">
                  <span>
                    <strong>{jo.joNumber}</strong> <span className="muted small">{jo.customerName}</span>
                  </span>
                  <span className="track-label">
                    <span className="dot" style={{ background: color }} aria-hidden="true" />
                    {track.kind === 'DRAFT' ? 'Draft' : trackLabel(track)}
                  </span>
                </div>
                {jo.status === 'DRAFT' ? (
                  <span className="muted small block">Tracking starts when the order is confirmed</span>
                ) : (
                  <>
                    <TrackBar track={track} color={color} />
                    <div className="row between small">
                      <span>Is {track.actual === null ? '—' : `${track.actual}%`}</span>
                      <span>Should be {track.planned}%</span>
                      <span>{track.daysLeft >= 0 ? `${track.daysLeft} day${track.daysLeft === 1 ? '' : 's'} left` : 'past deadline'}</span>
                    </div>
                    {track.updatedDaysAgo !== null && track.updatedDaysAgo > 3 && <span className="muted small block">Progress updated {track.updatedDaysAgo} days ago</span>}
                    {now.length > 0 && <span className="small block now-line">Now · {now.join(' · ')}</span>}
                  </>
                )}
              </Link>
            </li>
          ))}
        </ul>
        {open.some((o) => o.jo.status === 'CONFIRMED') && (
          <p className="muted small legend">
            <span>
              <span className="legend-mark" aria-hidden="true" /> Should be here today
            </span>
            <span>
              <span className="legend-gap" aria-hidden="true" /> Gap to catch up
            </span>
          </p>
        )}
      </section>

      <section aria-label="Materials and purchasing" className="tiles">
        <div className="card">
          <span className="muted small">Covered by stock</span>
          <span className="mono tile-num">{materials.total ? `${materials.covered}/${materials.total}` : '—'}</span>
          <span className="muted small">items on confirmed orders</span>
        </div>
        <Link className="card link" to="/orders?tab=to-buy">
          <span className="muted small">To buy</span>
          <span className="mono tile-num">{materials.toBuy} →</span>
          <span className="muted small">{materials.incomplete ? `${materials.incomplete} order(s) incomplete` : 'items, all confirmed orders'}</span>
        </Link>
      </section>

      <div className="card">
        <div className="row between">
          <h3>Needs attention</h3>
          {!loading && <span className="muted small">{total}</span>}
        </div>
        {loading && <p className="muted small">{t('loading')}</p>}
        {!loading && products.items.length === 0 && (
          <p className="muted small">
            No products yet. <Link to="/masters/products/new">Add the first product</Link>.
          </p>
        )}
        {!loading && products.items.length > 0 && total === 0 && <p className="ok small">Nothing needs attention right now.</p>}
        <ul className="attention">
          {backupDue && (
            <li>
              <Link to="/settings">
                <span className="pill warn">Backup due</span> <strong>ACTUAL data</strong>
                <span className="muted small block">
                  {backupDue.days === null ? 'No backup taken on this phone yet.' : `Last backup ${backupDue.days} days ago.`} Settings → Backup → Share backup (e.g. to Google Drive).
                </span>
              </Link>
            </li>
          )}
          {overruns.map((o) => (
            <li key={`${o.jo.id}-${o.line.id}-${o.view.step.key}`}>
              <Link to={`/orders/${o.jo.id}?tab=products`}>
                <span className="pill bad">Step overrun</span> <strong>{o.jo.joNumber}</strong>
                <span className="muted small block">
                  {o.line.productName}: {o.view.step.label} — {formatQty(o.view.actualDays ?? 0)} working days so far, {formatQty(o.view.step.plannedDays ?? 0)} planned
                </span>
              </Link>
            </li>
          ))}
          {deadlineChanges.map((c) => (
            <li key={`${c.jo.id}-deadline`}>
              <Link to={`/orders/${c.jo.id}?tab=order`}>
                <span className="pill warn">Deadline can be recalculated</span> <strong>{c.jo.joNumber}</strong>
                <span className="muted small block">
                  With the working-day calendar the internal deadline would be {formatDay(c.next.internalDeadline)} (now {formatDay(c.jo.deadline.internalDeadline)})
                </span>
              </Link>
            </li>
          ))}
          {over.map((o) => {
            const it = parseItemKey(o.key);
            const name = (it && (master.md.products.get(it.id)?.name ?? master.md.rawMaterials.get(it.id)?.name)) ?? o.key;
            const unit = (it && (master.md.products.get(it.id)?.baseUnit ?? master.md.rawMaterials.get(it.id)?.baseUnit)) ?? '';
            return (
              <li key={o.key}>
                <Link to="/orders?tab=to-buy">
                  <span className="pill bad">Stock over-allocated</span> <strong>{name}</strong>
                  <span className="muted small block">
                    {formatQty(o.allocation.confirmed)} {unitLabel(unit)} set aside on confirmed orders · {formatQty(o.allocation.counted ?? 0)} {unitLabel(unit)} counted
                  </span>
                </Link>
              </li>
            );
          })}
          {joAttention.map((a) => {
            const k = JO_KIND[a.kind];
            return (
              <li key={`${a.joId}-${a.kind}`}>
                <Link to={`/orders/${a.joId}`}>
                  <span className={`pill ${k.cls}`}>{k.title}</span> <strong>{a.joNumber}</strong>
                  <span className="muted small block">{a.detail}</span>
                </Link>
              </li>
            );
          })}
          {attention.map((a) => {
            const k = KIND[a.kind];
            return (
              <li key={`${a.productId}-${a.kind}`}>
                <Link to={`/masters/products/${a.productId}?tab=${k.tab}`}>
                  <span className={`pill ${k.cls}`}>{k.title}</span> <strong>{a.productName}</strong>
                  <span className="muted small block">{k.hint}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <WorkCalendarCard />
    </section>
  );
}
