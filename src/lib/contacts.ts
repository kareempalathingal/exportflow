/**
 * Department contacts: who to call about a process step, and ready-made
 * messages the user can edit and send (the app never sends anything itself).
 * Pure helpers; links open the phone's dialer, WhatsApp or mail app.
 */
import type { Department, Person } from './masters';

/** Digits for international use: 10-digit Indian numbers get 91; a leading 0 is dropped. Null if unusable. */
export function phoneDigits(raw: string): string | null {
  const d = (raw ?? '').replace(/[^\d]/g, '');
  if (!d) return null;
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

export function telHref(p: Pick<Person, 'phone'>): string | null {
  const d = phoneDigits(p.phone);
  return d ? `tel:+${d}` : null;
}

export function whatsappHref(p: Pick<Person, 'phone' | 'whatsapp'>, text: string): string | null {
  const d = phoneDigits(p.whatsapp || p.phone);
  return d ? `https://wa.me/${d}?text=${encodeURIComponent(text)}` : null;
}

export function mailHref(p: Pick<Person, 'email'>, subject: string, body: string): string | null {
  const e = (p.email ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return `mailto:${e}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Primary contacts first, then by name. */
export function orderedPeople(people: Person[] | undefined): Person[] {
  return [...(people ?? [])].filter((p) => p.name.trim()).sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
}

/** Active departments that handle a process (normally one). */
export function departmentsFor<T extends Pick<Department, 'processIds' | 'active'>>(processId: string | null, departments: T[]): T[] {
  if (!processId) return [];
  return departments.filter((d) => d.active !== false && (d.processIds ?? []).includes(processId));
}

export interface StepMessage {
  subject: string;
  body: string;
}

/** A short status request about one step, written for the person to receive. */
export function stepMessage(args: { person?: string; joNumber: string; product: string; step: string; quantity?: string | null; plannedFinish?: string | null; late?: boolean }): StepMessage {
  const hi = args.person ? `Hi ${args.person.split(' ')[0]},` : 'Hi,';
  const what = `${args.joNumber} · ${args.product}${args.quantity ? ` (${args.quantity})` : ''}: ${args.step}`;
  const when = args.plannedFinish ? ` - planned to finish ${args.plannedFinish}` : '';
  const ask = args.late ? 'It is running behind plan. Could you tell me the status and when it will be done?' : 'Could you update me on the status?';
  return { subject: `${args.joNumber} · ${args.step} - status`, body: `${hi}\n${what}${when}.\n${ask}\nThank you.` };
}
