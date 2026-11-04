/** Grouping and filtering of products / raw materials by category, type and family (confirmed 4 Nov 2026). */
import { baseUnitGuessed, type ItemExtras, type Product, type RouteStep } from './masters';

/** Filter value for "no category / type / family". */
export const NO_GROUP = '__none__';

export interface ItemFilter {
  category: string; // '' = all
  productType: string;
  family: string;
  guessedOnly: boolean;
}

const matches = (v: string | undefined, want: string) => !want || (want === NO_GROUP ? !(v ?? '').trim() : (v ?? '').trim() === want);

export function filterItems<T extends ItemExtras>(items: T[], f: ItemFilter): T[] {
  return items.filter((x) => matches(x.category, f.category) && matches(x.productType, f.productType) && matches(x.family, f.family) && (!f.guessedOnly || baseUnitGuessed(x)));
}

/** Groups by category, A–Z, items without one last. */
export function groupByCategory<T extends ItemExtras>(items: T[]): { name: string; items: T[] }[] {
  const m = new Map<string, T[]>();
  for (const x of items) {
    const k = x.category?.trim() || NO_GROUP;
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return [...m]
    .sort(([a], [b]) => (a === NO_GROUP ? 1 : b === NO_GROUP ? -1 : a.localeCompare(b)))
    .map(([name, items]) => ({ name, items }));
}

/** Members of a family (exact name). */
export function familyMembers<T extends ItemExtras & { active?: boolean }>(items: T[], family: string, includeInactive = false): T[] {
  return items.filter((x) => (x.family ?? '').trim() === family && (includeInactive || x.active !== false));
}

/** Same steps (process, times, flags) — order matters. */
export function sameRoute(a: RouteStep[] | undefined, b: RouteStep[] | undefined): boolean {
  const key = (r: RouteStep[] | undefined) =>
    JSON.stringify((r ?? []).map((s) => [s.processId, s.perDay ?? null, s.perDayUnit ?? '', s.fixedDays ?? null, s.alsoForStock === true, s.status]));
  return key(a) === key(b);
}

/** The route most members already have (the starting point when editing a family); empty when none has steps. */
export function commonRoute<T extends Pick<Product, 'route'>>(members: T[]): RouteStep[] {
  const counts: { route: RouteStep[]; n: number }[] = [];
  for (const m of members) {
    if (!(m.route ?? []).length) continue;
    const hit = counts.find((c) => sameRoute(c.route, m.route));
    if (hit) hit.n++;
    else counts.push({ route: m.route!, n: 1 });
  }
  counts.sort((a, b) => b.n - a.n);
  return counts[0]?.route ?? [];
}

export interface FamilyRoutePlan<T> {
  /** Members that get the new steps. */
  change: T[];
  /** Already exactly these steps (and confirmation flag). */
  same: T[];
  /** Left as they are (they have other steps and "only those without steps" was chosen). */
  kept: T[];
  /** Of `change`: members whose existing (different) steps are replaced. */
  replaced: number;
}

/** Who changes when a family gets these steps (confirmed 4 Nov 2026); nothing is written here. */
export function planFamilyRoute<T extends Pick<Product, 'route' | 'routeConfirmed'>>(members: T[], route: RouteStep[], confirmed: boolean, onlyWithout: boolean): FamilyRoutePlan<T> {
  const out: FamilyRoutePlan<T> = { change: [], same: [], kept: [], replaced: 0 };
  for (const m of members) {
    const has = (m.route ?? []).length > 0;
    if (sameRoute(m.route, route) && (m.routeConfirmed === true) === confirmed) out.same.push(m);
    else if (onlyWithout && has) out.kept.push(m);
    else {
      out.change.push(m);
      if (has && !sameRoute(m.route, route)) out.replaced++;
    }
  }
  return out;
}
