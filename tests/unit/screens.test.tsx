/**
 * Smoke-render the Phase 2 screens with Firebase replaced by in-memory data,
 * to catch crashes that type checks cannot (the real backend is not reachable in CI unit tests).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Product, RawMaterial, Bom, Customer } from '../../src/lib/masters';

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

const data: Record<string, { id: string }[]> = { products: [product], rawMaterials: [rm], boms: [bom], customers: [customer] };

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

function render(path: string, pattern: string, el: React.ReactElement) {
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={el} />
      </Routes>
    </MemoryRouter>,
  );
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
