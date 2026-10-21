import { describe, expect, it } from 'vitest';
import { departmentsFor, mailHref, orderedPeople, phoneDigits, stepMessage, telHref, whatsappHref } from '../../src/lib/contacts';
import { peopleError } from '../../src/features/masters/DepartmentForm';

const rajan = { name: 'Rajan K', designation: 'Supervisor', phone: '98765 43210', whatsapp: '', email: 'rajan@company.in', primary: false };
const anu = { name: 'Anu', designation: 'Shift in-charge', phone: '', whatsapp: '+91 90000 11111', email: '', primary: true };

describe('department contacts', () => {
  it('turns Indian numbers into international form and never guesses a short one', () => {
    expect(phoneDigits('98765 43210')).toBe('919876543210');
    expect(phoneDigits('09876543210')).toBe('919876543210');
    expect(phoneDigits('+91 98765-43210')).toBe('919876543210');
    expect(phoneDigits('12345')).toBeNull();
    expect(phoneDigits('')).toBeNull();
  });
  it('makes call, WhatsApp (falls back to phone) and email links', () => {
    expect(telHref(rajan)).toBe('tel:+919876543210');
    expect(whatsappHref(rajan, 'Hi')).toBe('https://wa.me/919876543210?text=Hi');
    expect(whatsappHref(anu, 'a b')).toBe('https://wa.me/919000011111?text=a%20b');
    expect(telHref(anu)).toBeNull();
    expect(mailHref(rajan, 'S', 'B')).toBe('mailto:rajan@company.in?subject=S&body=B');
    expect(mailHref(anu, 'S', 'B')).toBeNull();
  });
  it('puts the main contact first and finds the department of a process', () => {
    expect(orderedPeople([rajan, anu]).map((p) => p.name)).toEqual(['Anu', 'Rajan K']);
    const depts = [
      { name: 'Weaving', active: true, processIds: ['weave'] },
      { name: 'Old', active: false, processIds: ['weave'] },
    ];
    expect(departmentsFor('weave', depts).map((d) => d.name)).toEqual(['Weaving']);
    expect(departmentsFor(null, depts)).toEqual([]);
  });
  it('writes a short status request the user can edit before sending', () => {
    const m = stepMessage({ person: 'Rajan K', joNumber: 'JO-101', product: 'Coir mat', step: 'Weaving', quantity: '2,000 pcs', plannedFinish: '24 Oct 2026', late: true });
    expect(m.subject).toBe('JO-101 · Weaving - status');
    expect(m.body).toBe('Hi Rajan,\nJO-101 · Coir mat (2,000 pcs): Weaving - planned to finish 24 Oct 2026.\nIt is running behind plan. Could you tell me the status and when it will be done?\nThank you.');
  });
  it('checks people before saving', () => {
    expect(peopleError([rajan])).toBeNull();
    expect(peopleError([{ ...rajan, name: ' ' }])).toMatch(/name is required/);
    expect(peopleError([{ ...rajan, phone: '123' }])).toMatch(/phone number looks incomplete/);
    expect(peopleError([{ ...rajan, email: 'x@' }])).toMatch(/email address looks wrong/);
  });
});
