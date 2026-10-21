/**
 * Smoke-render the Phase 2 screens with Firebase replaced by in-memory data,
 * to catch crashes that type checks cannot (the real backend is not reachable in CI unit tests).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Product, RawMaterial, Bom, Customer } from '../../src/lib/masters';
import type { JobOrder } from '../../src/lib/jobOrders';

const product: Product & { id: string; rev: number; pending: boolean } = {
  id: 'p1', rev: 3, pending: false, name: 'Mat A', code: '', active: true, notes: '', baseUnit: 'pcs', supplyType: 'MANUFACTURED', specifications: '',
  size: { length: 40, width: 60, unit: 'cm', status: 'VERIFIED' },
  thicknessMm: { value: null, status: 'UNAVAILABLE', source: '' },
  gsm: { value: 1500, status: 'VERIFIED', source: '' },
  weightPerPieceKg: { value: null, status: 'UNAVAILABLE', source: '' },
  customUnits: [{ name: 'bale', factor: 20, status: 'USER_PROVIDED' }],
};
const rm: RawMaterial & { id: string; rev: number; pending: boolean } = {
  id: 'r1', rev: 1, pending: false, name: 'Fibre', active: true, notes: '', baseUnit: 'kg', gsm: { value: null, status: 'UNAVAILABLE', source: '' }, customUnits: [],
};
const bom: Bom & { id: string; rev: number; pending: boolean } = {
  id: 'p1', rev: 2, pending: false, productId: 'p1', notes: '',
  lines: [{ rawMaterialId: 'r1', qty: 300, unit: 'g', wastagePct: 5, status: 'VERIFIED', source: '' }],
};
const customer: Customer & { id: string; rev: number; pending: boolean } = {
  id: 'c1', rev: 1, pending: false, name: 'Buyer GmbH', active: true, notes: '', country: 'Germany', customerType: 'AGENT', contactPerson: '', phone: '', email: '',
};

const jobOrder: JobOrder & { id: string; rev: number; pending: boolean } = {
  id: 'j1', rev: 2, pending: false, joNumber: 'JO-77', customerId: 'c1', customerName: 'Buyer GmbH', poNumber: 'PO-9',
  receivedDate: '2026-11-01', deliveryDate: '2026-12-30', deliveryDateType: 'PORT',
  deadline: { orderPeriodDays: 59, bufferDays: 6, internalDeadline: '2026-12-24', ruleVersion: 'buffer-10pct-ceil-min1/v1' },
  status: 'CONFIRMED', lines: [{ id: 'l1', productId: 'p1', productName: 'Mat A', qty: 24, unit: 'sqm', supply: 'MAKE' }],
  notes: '', bomSnapshot: { p1: { rev: 1, lines: bom.lines } }, confirmedOn: '2026-11-01',
};

const supplier = { id: 's1', rev: 1, pending: false, name: 'Kerala Fibre Traders', active: true, notes: '', place: 'Alappuzha', contactPerson: '', phone: '', email: '', gstin: '', items: ['RAW_MATERIAL:r1'] };

const processes = [
  { id: 'pr1', rev: 1, pending: false, name: 'Weaving', active: true, notes: '' },
  { id: 'pr2', rev: 1, pending: false, name: 'Bleaching', active: true, notes: '' },
];
product.route = [
  { processId: 'pr1', perDay: 50, perDayUnit: 'pcs', fixedDays: null, status: 'USER_PROVIDED', source: '' },
  { processId: 'pr2', perDay: null, perDayUnit: 'pcs', fixedDays: null, status: 'PENDING_VERIFICATION', source: '' },
];
const stepped: JobOrder & { id: string; rev: number; pending: boolean } = {
  ...jobOrder, id: 'j2', joNumber: 'JO-88', receivedDate: '2026-10-01', confirmedOn: '2026-10-01',
  deadline: { orderPeriodDays: 40, bufferDays: 4, internalDeadline: '2026-11-06', ruleVersion: 'buffer-10pct-ceil-min1/v1' },
  lines: [{ ...jobOrder.lines[0]!, steps: [
    { key: 'a', processId: 'pr1', label: 'Weaving', forProduct: 'Mat A', productId: 'p1', perDay: 50, perDayUnit: 'pcs', fixedDays: null, doneAt: '2026-10-08T06:00:00Z' },
    { key: 'b', processId: 'pr2', label: 'Bleaching', forProduct: 'Mat A', productId: 'p1', perDay: null, perDayUnit: null, fixedDays: null, doneAt: null },
  ] }],
};

const data: Record<string, { id: string }[]> = { products: [product], rawMaterials: [rm], boms: [bom], customers: [customer], jobOrders: [jobOrder, stepped], suppliers: [supplier], processes };

vi.mock('../../src/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } }, offlineCacheEnabled: true }));
vi.mock('../../src/features/settings/useProfile', () => ({ useProfile: () => ({ profile: null, loading: false, pendingWrite: false, fromCache: false, error: null }) }));
vi.mock('../../src/AppContext', () => ({
  useApp: () => ({ workspaceId: 'u1_actual', t: (k: string) => k, mode: 'ACTUAL', online: true }),
}));
vi.mock('../../src/features/masters/useCollection', () => ({
  useCollection: (_ws: string, name: string) => ({ items: data[name] ?? [], loading: false, error: null }),
  useDocument: (_ws: string, name: string, id: string | null) => ({
    item: (data[name] ?? []).find((x) => x.id === id) ?? null,
    loading: false,
    error: null,
  }),
  newId: () => 'new-id',
}));

const { MastersPage } = await import('../../src/features/masters/MastersPage');
const { ProductForm } = await import('../../src/features/masters/ProductForm');
const { RawMaterialForm } = await import('../../src/features/masters/RawMaterialForm');
const { CustomerForm } = await import('../../src/features/masters/CustomerForm');
const { HomePage } = await import('../../src/features/home/HomePage');
const { SupplierForm } = await import('../../src/features/masters/SupplierForm');
const { OrdersPage } = await import('../../src/features/orders/OrdersPage');
const { JobOrderPage } = await import('../../src/features/orders/JobOrderPage');
const { ProcessForm } = await import('../../src/features/masters/ProcessForm');
const { RestoreCard } = await import('../../src/features/settings/RestoreCard');
const { HealthCard } = await import('../../src/features/settings/HealthCard');
const { ReportsPage } = await import('../../src/features/reports/ReportsPage');
const { PerformancePage } = await import('../../src/features/reports/PerformancePage');
const { Layout } = await import('../../src/components/Layout');

function render(path: string, pattern: string, el: React.ReactElement) {
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={el} />
      </Routes>
    </MemoryRouter>,
  ).replace(/<!-- -->/g, '');
}

describe('Phase 2 screens render', () => {
  it('masters list shows products with BOM status', () => {
    const html = render('/masters', '/masters', <MastersPage />);
    expect(html).toContain('Mat A');
    expect(html).toContain('BOM ready');
  });
  it('home shows the attention list', () => {
    const html = render('/', '/', <HomePage />);
    expect(html).toContain('Needs attention');
  });
  it('manufactured product opens on the BOM tab with a summary', () => {
    const html = render('/masters/products/p1', '/masters/products/:id', <ProductForm />);
    expect(html).toContain('BOM ready');
    expect(html).toContain('components for 1');
    expect(html).toContain('Production time');
  });
  it('product details and conversion tabs render', () => {
    expect(render('/masters/products/p1?tab=details', '/masters/products/:id', <ProductForm />)).toContain('Size of one piece');
    expect(render('/masters/products/p1?tab=conversion', '/masters/products/:id', <ProductForm />)).toContain('Conversion check');
  });
  it('new product form renders', () => {
    expect(render('/masters/products/new', '/masters/products/:id', <ProductForm />)).toContain('New product');
  });
  it('raw material and customer forms render', () => {
    expect(render('/masters/raw-materials/r1', '/masters/raw-materials/:id', <RawMaterialForm />)).toContain('Base unit');
    expect(render('/masters/customers/c1', '/masters/customers/:id', <CustomerForm />)).toContain('Country');
  });
});

describe('Phase 3b materials render', () => {
  it('materials tab explodes the order with the saved BOM', () => {
    const html = render('/orders/j1?tab=materials', '/orders/:id', <JobOrderPage />);
    expect(html).toContain('Materials &amp; stock');
    expect(html).toContain('Fibre');
    expect(html).toContain('31.5 kg'); // 100 pcs × 300 g × 1.05
    expect(html).toContain('manual only');
  });
  it('orders To buy tab totals confirmed orders', () => {
    const html = render('/orders?tab=to-buy', '/orders', <OrdersPage />);
    expect(html).toContain('Fibre');
    expect(html).toContain('JO-77');
  });
});

describe('Phase 3 Job Order screens render', () => {
  it('orders list shows the open order with its deadline', () => {
    const html = render('/orders', '/orders', <OrdersPage />);
    expect(html).toContain('JO-77');
    expect(html).toContain('Buyer GmbH');
    expect(html).toContain('24 Dec 2026');
  });
  it('a confirmed order shows deadline, buffer, BOM-changed notice and line conversion', () => {
    const html = render('/orders/j1', '/orders/:id', <JobOrderPage />);
    expect(html).toContain('Internal deadline');
    expect(html).toContain('6 of 59 calendar days');
    expect(html).toContain('BOM changed after confirmation'); // snapshot rev 1, current BOM rev 2
    expect(html).toContain('Mark completed');
    expect(html).toContain('= 100 pcs');
  });
  it('the new Job Order form renders', () => {
    const html = render('/orders/new', '/orders/:id', <JobOrderPage />);
    expect(html).toContain('New Job Order');
    expect(html).toContain('Save as draft');
  });
  it('home is the planned-vs-actual dashboard', () => {
    const html = render('/', '/', <HomePage />);
    expect(html).toContain('Where orders stand');
    expect(html).toContain('Planned vs actual');
    expect(html).toContain('JO-77');
    expect(html).toContain('Not tracked');
  });
});

describe('Suppliers', () => {
  it('suppliers tab lists suppliers with their item count', () => {
    const html = render('/masters?tab=suppliers', '/masters', <MastersPage />);
    expect(html).toContain('Kerala Fibre Traders');
    expect(html).toContain('1 item');
  });
  it('supplier form shows linked items', () => {
    const html = render('/masters/suppliers/s1', '/masters/suppliers/:id', <SupplierForm />);
    expect(html).toContain('Supplies');
    expect(html).toContain('+ New product');
    expect(html).toContain('returnTo=%2Fmasters%2Fsuppliers%2Fs1');
  });
  it('raw material page shows its suppliers (the reverse link)', () => {
    const html = render('/masters/raw-materials/r1', '/masters/raw-materials/:id', <RawMaterialForm />);
    expect(html).toContain('Suppliers');
    expect(html).toContain('Kerala Fibre Traders');
  });
  it('To buy shows who can supply each item', () => {
    const html = render('/orders?tab=to-buy', '/orders', <OrdersPage />);
    expect(html).toContain('Suppliers: ');
    expect(html).toContain('Kerala Fibre Traders');
  });
});

describe('Phase 4 process steps', () => {
  it('processes tab lists processes; a process shows which products use it', () => {
    expect(render('/masters?tab=processes', '/masters', <MastersPage />)).toContain('Bleaching');
    const html = render('/masters/processes/pr2', '/masters/processes/:id', <ProcessForm />);
    expect(html).toContain('Used by');
    expect(html).toContain('Mat A');
  });
  it('product details have the process route editor', () => {
    const html = render('/masters/products/p1?tab=details', '/masters/products/:id', <ProductForm />);
    expect(html).toContain('Process route');
    expect(html).toContain('<option value="pr1">Weaving</option>'); // saved steps fill in after mount
    expect(html).toContain('Create &amp; add');
    expect(html).toContain('Order of steps confirmed with the company');
  });
  it('a confirmed order opens on Products with each step and the next action', () => {
    const html = render('/orders/j2', '/orders/:id', <JobOrderPage />);
    expect(html).toContain('Now: Bleaching');
    expect(html).toContain('Bleaching done');
    expect(html).toContain('time pending');
    expect(html).toContain('Undo last');
    expect(html).toContain('100 pcs ÷ 50/day'); // 24 sq m of 40×60 cm mats = 100 pcs → 2 working days
    expect(html).toContain('working days');
  });
  it('an order without steps offers to set them up from product routes', () => {
    const html = render('/orders/j1?tab=products', '/orders/:id', <JobOrderPage />);
    expect(html).toContain('Set up steps from product routes');
  });
  it('home shows what each product is doing now, and the company calendar', () => {
    const html = render('/', '/', <HomePage />);
    expect(html).toContain('JO-88');
    expect(html).toContain('Bleaching');
    expect(html).toContain('Calendar');
    expect(html).toContain('Weekly off: Sunday');
  });
  it('an old order (calendar-day deadline) offers to recalculate with working days', () => {
    const html = render('/orders/j1?tab=order', '/orders/:id', <JobOrderPage />);
    expect(html).toContain('Deadline can be recalculated');
    expect(html).toContain('Recalculate deadline');
    expect(html).toContain('6 of 59 calendar days');
  });
});

describe('Data safety', () => {
  it('settings offer restore with a preview and a system health summary', () => {
    const restore = render('/settings', '/settings', <RestoreCard />);
    expect(restore).toContain('Restore from a backup');
    expect(restore).toContain('Choose backup file');
    expect(restore).toContain('Nothing is deleted');
    const health = render('/settings', '/settings', <HealthCard />);
    expect(health).toContain('System health');
    expect(health).toContain('ACTUAL backup: never taken on this phone');
    expect(health).toContain('Sync: 0 waiting');
    expect(health).toContain('Check rules');
  });
  it('home reminds to back up ACTUAL data once real data exists', () => {
    expect(render('/', '/', <HomePage />)).toContain('Backup due');
  });
});

describe('Crash screen', () => {
  it('shows a recovery screen instead of a blank page', async () => {
    const { ErrorBoundary } = await import('../../src/components/ErrorBoundary');
    const b = new ErrorBoundary({ children: <p>ok</p> });
    expect(ErrorBoundary.getDerivedStateFromError(new Error('x'))).toEqual({ error: new Error('x') });
    b.state = { error: new Error('Cannot read properties of undefined'), copied: false };
    const html = renderToString(b.render() as React.ReactElement);
    expect(html).toContain('Something went wrong on this screen');
    expect(html).toContain('Your saved data is safe');
    expect(html).toContain('Copy error details');
    b.state = { error: null, copied: false };
    expect(renderToString(b.render() as React.ReactElement)).toBe('<p>ok</p>');
  });
});

describe('Reports', () => {
  it('the bottom menu has Reports instead of History', () => {
    const html = render('/', '/', <Layout />);
    expect(html).toContain('href="/reports"');
    expect(html).not.toContain('href="/history"');
  });
  it('reports page has the daily summary, performance report, To buy PDF and History', () => {
    const html = render('/reports', '/reports', <ReportsPage />);
    expect(html).toContain('Today');
    expect(html).toContain('Share summary');
    expect(html).toContain('Daily summary (PDF)');
    expect(html).toContain('Job Order performance');
    expect(html).toContain('To buy — all confirmed orders (PDF)');
    expect(html).toContain('href="/history"');
  });
  it('performance report has period choices, summary and processes', () => {
    const html = render('/reports/performance', '/reports/performance', <PerformancePage />);
    expect(html).toContain('Last 90 days');
    expect(html).toContain('On time · internal');
    expect(html).toContain('Still open');
    expect(html).toContain('JO-88');
  });
  it('home shows the Today card for confirmed orders', () => {
    const html = render('/', '/', <HomePage />);
    expect(html).toContain('aria-label="Today"');
    expect(html).toContain('Share summary');
  });
});
