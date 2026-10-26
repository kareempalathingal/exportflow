/**
 * Data consistency checks (Settings → System health). Pure and read-only:
 * they only report; nothing is changed automatically.
 */
import type { JobOrder } from './jobOrders';
import { lineComponent, type Customer, type Department, type MasterData, type Process, type Supplier } from './masters';
import { parseItemKey } from './materials';
import { normalizeJoNumber } from './jobOrders';
import type { Task } from './tasks';

export interface IntegrityIssue {
  severity: 'error' | 'warn';
  text: string;
  link: string; // app route to fix it
}

export function checkIntegrity(args: {
  md: MasterData;
  jobOrders: (JobOrder & { id: string })[];
  customers: (Customer & { id: string })[];
  processes: (Process & { id: string })[];
  suppliers: (Supplier & { id: string })[];
  departments?: (Department & { id: string })[];
  tasks?: (Task & { id: string })[];
}): IntegrityIssue[] {
  const { md } = args;
  const out: IntegrityIssue[] = [];
  const customerIds = new Set(args.customers.map((c) => c.id));
  const processIds = new Set(args.processes.map((p) => p.id));
  const itemExists = (key: string) => {
    const it = parseItemKey(key);
    if (!it) return false;
    return it.type === 'PRODUCT' ? md.products.has(it.id) : md.rawMaterials.has(it.id);
  };

  // BOMs: missing components and loops.
  for (const [pid, bom] of md.boms) {
    const pname = md.products.get(pid)?.name ?? pid;
    if (!md.products.has(pid)) out.push({ severity: 'warn', text: `A BOM exists for a product that is missing (${pid})`, link: '/masters' });
    for (const l of bom.lines) {
      const c = lineComponent(l);
      const ok = c.type === 'PRODUCT' ? md.products.has(c.id) : md.rawMaterials.has(c.id);
      if (!ok) out.push({ severity: 'error', text: `BOM of ${pname}: a line points to a missing ${c.type === 'PRODUCT' ? 'product' : 'raw material'}`, link: `/masters/products/${pid}?tab=bom` });
    }
  }
  const loopFound = new Set<string>();
  const visit = (pid: string, path: string[]) => {
    if (path.includes(pid)) {
      const loop = [...path.slice(path.indexOf(pid)), pid];
      const key = [...loop].sort().join('>');
      if (!loopFound.has(key)) {
        loopFound.add(key);
        out.push({ severity: 'error', text: `Loop in BOMs: ${loop.map((x) => md.products.get(x)?.name ?? x).join(' → ')}`, link: `/masters/products/${pid}?tab=bom` });
      }
      return;
    }
    if (path.length > 20) return;
    for (const l of md.boms.get(pid)?.lines ?? []) {
      const c = lineComponent(l);
      if (c.type === 'PRODUCT') visit(c.id, [...path, pid]);
    }
  };
  for (const pid of md.boms.keys()) visit(pid, []);

  // Product routes: missing processes.
  for (const [pid, p] of md.products) {
    for (const s of p.route ?? []) {
      if (!processIds.has(s.processId)) out.push({ severity: 'warn', text: `${p.name}: a process step points to a missing process`, link: `/masters/products/${pid}?tab=details` });
    }
  }

  // Departments: missing processes; a process in two departments.
  const owner = new Map<string, string>();
  for (const d of args.departments ?? []) {
    if (d.active === false) continue;
    const missing = (d.processIds ?? []).filter((p) => !processIds.has(p)).length;
    if (missing) out.push({ severity: 'warn', text: `${d.name}: ${missing} linked process${missing === 1 ? ' is' : 'es are'} missing`, link: `/masters/departments/${d.id}` });
    for (const p of d.processIds ?? []) {
      const prev = owner.get(p);
      const pname = args.processes.find((x) => x.id === p)?.name ?? p;
      if (prev && prev !== d.name) out.push({ severity: 'warn', text: `${pname} is in two departments (${prev}, ${d.name})`, link: `/masters/departments/${d.id}` });
      owner.set(p, d.name);
    }
  }

  // Suppliers: links to missing items.
  for (const s of args.suppliers) {
    const missing = (s.items ?? []).filter((k) => !itemExists(k)).length;
    if (missing) out.push({ severity: 'warn', text: `${s.name}: ${missing} linked item${missing === 1 ? ' is' : 's are'} missing`, link: `/masters/suppliers/${s.id}` });
  }

  // Job Orders.
  const seen = new Map<string, string>();
  for (const jo of args.jobOrders) {
    const link = `/orders/${jo.id}`;
    if (jo.status !== 'CANCELLED') {
      const n = normalizeJoNumber(jo.joNumber);
      if (seen.has(n)) out.push({ severity: 'warn', text: `JO number ${jo.joNumber} is used by two open orders`, link });
      seen.set(n, jo.id);
    }
    if (!customerIds.has(jo.customerId)) out.push({ severity: 'warn', text: `${jo.joNumber}: customer record is missing (${jo.customerName || 'unknown'})`, link });
    for (const [i, l] of jo.lines.entries()) {
      if (!md.products.has(l.productId)) out.push({ severity: 'error', text: `${jo.joNumber} line ${i + 1}: product is missing (${l.productName || 'unknown'})`, link });
    }
    if (jo.status !== 'DRAFT' && jo.status !== 'CANCELLED' && (!jo.bomSnapshot || typeof jo.bomSnapshot !== 'object')) {
      out.push({ severity: 'error', text: `${jo.joNumber}: confirmed without a saved BOM copy`, link });
    }
    for (const k of Object.keys(jo.stock ?? {})) {
      if (!itemExists(k)) out.push({ severity: 'warn', text: `${jo.joNumber}: stock is set aside for a missing item`, link: `${link}?tab=materials` });
    }
    if (jo.deadline.internalDeadline >= jo.deliveryDate) out.push({ severity: 'error', text: `${jo.joNumber}: internal deadline is not before the delivery date`, link });
  }
  // Tasks: links to a missing department or Job Order.
  const deptIds = new Set((args.departments ?? []).map((d) => d.id));
  const joIds = new Set(args.jobOrders.map((j) => j.id));
  for (const t of args.tasks ?? []) {
    if (t.status === 'DONE' || t.status === 'DROPPED') continue;
    if (t.departmentId && args.departments && !deptIds.has(t.departmentId)) out.push({ severity: 'warn', text: `Task "${t.title}": department is missing`, link: `/work/${t.id}` });
    if (t.joId && !joIds.has(t.joId)) out.push({ severity: 'warn', text: `Task "${t.title}": Job Order ${t.joNumber || ''} is missing`, link: `/work/${t.id}` });
  }
  return out.sort((a, b) => (a.severity === b.severity ? a.text.localeCompare(b.text) : a.severity === 'error' ? -1 : 1));
}
