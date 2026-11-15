/**
 * Company terms (confirmed 15 Nov 2026): the app shows the names the company uses.
 * "Job Order" is kept free for the company's own Job Order form (a check form inside a WO),
 * so no old term may appear in anything the user sees. Comments are left out of the check.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../../src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

/** Source without comments (block comments, JSX comments and line comments), same line numbers. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')) // keep line numbers
    .split('\n')
    .map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
}

const OLD_TERMS: { term: RegExp; now: string }[] = [
  { term: /\bJob Orders?\b/i, now: 'Work Order' },
  { term: /\bJOs?\b/, now: 'WO' },
  { term: /Buyer PO/, now: 'Customer PO No.' },
  { term: /[Cc]ustomer delivery/, now: 'Cargo ready date' },
  { term: /JO received|WO received/, now: 'WO date' },
  { term: /Received back/, now: 'Landed' },
  { term: /Bought items|Bought product|Buy from outside|Bought from outside/, now: 'Outright purchase' },
  { term: /Make or [Bb]uy|Make ?\/ ?Buy/, now: 'Make or outright purchase' },
  { term: /On-time delivery/, now: 'On time for cargo ready' },
];

describe('company terminology', () => {
  it('no old term is shown anywhere in the app', () => {
    const found: string[] = [];
    for (const f of files(SRC)) {
      const lines = code(readFileSync(f, 'utf8')).split('\n');
      lines.forEach((l, i) => {
        for (const { term, now } of OLD_TERMS) if (term.test(l)) found.push(`${f.slice(SRC.length + 1)}:${i + 1} "${l.trim().slice(0, 80)}" → use "${now}"`);
      });
    }
    expect(found).toEqual([]);
  });
});
