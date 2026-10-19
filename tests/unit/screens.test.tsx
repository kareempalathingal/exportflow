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

const data: Record<string, { id: string }[]> = { products: [product], rawMaterials: [rm], boms: [bom], customers: [customer], jobOrders: [jobOrder] };

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
const { OrdersPage } = await import('../../src/features/orders/OrdersPage');
const { JobOrderPage } = await import('../../src/features/orders/JobOrderPage');

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
    expect(html).toContain('6 days of 59');
    expect(html).toContain('BOM changed after confirmation'); // snapshot rev 1, current BOM rev 2
    expect(html).toContain('Mark completed');
    expect(html).toContain('= 100 pcs');
  });
  it('the new Job Order form renders', () => {
    const html = render('/orders/new', '/orders/:id', <JobOrderPage />);
    expect(html).toContain('New Job Order');
    expect(html).toContain('Save as draft');
  });
  it('home counts open orders', () => {
    expect(render('/', '/', <HomePage />)).toContain('1 open Job Order');
  });
});
