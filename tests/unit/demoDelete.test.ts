import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/firebase', () => ({ db: {}, auth: {} }));

describe('DEMO-only Work Order delete (18 Nov 2026)', () => {
  it('only the DEMO workspace qualifies', async () => {
    const { isDemoWorkspace } = await import('../../src/features/settings/demoDelete');
    expect(isDemoWorkspace('u1_demo')).toBe(true);
    expect(isDemoWorkspace('u1_actual')).toBe(false);
    expect(isDemoWorkspace(null)).toBe(false);
  });
  it('refuses ACTUAL before touching anything', async () => {
    const { deleteDemoJobOrders } = await import('../../src/features/settings/demoDelete');
    await expect(deleteDemoJobOrders('u1_actual', null)).rejects.toThrow('Only in DEMO.');
  });
});
