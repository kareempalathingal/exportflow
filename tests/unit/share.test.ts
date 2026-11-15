import { describe, expect, it } from 'vitest';
import { shareMessage } from '../../src/lib/share';

describe('share text message (15 Nov 2026)', () => {
  it('is the same short sentence everywhere, nothing when cancelled', () => {
    expect(shareMessage('shared')).toBe('Passed to the share menu.');
    expect(shareMessage('copied')).toBe('Copied. Paste it into WhatsApp, email or a note.');
    expect(shareMessage('cancelled')).toBeNull();
  });
});
