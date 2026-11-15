/**
 * Share plain text (15 Nov 2026: one helper for every "share as text" button). The phone's
 * share sheet opens, or the text is copied; the app never sends anything itself.
 */
export type ShareResult = 'shared' | 'copied' | 'cancelled';

export async function shareText(title: string, text: string): Promise<ShareResult> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    window.prompt('Copy this text:', text);
    return 'copied';
  }
}

/** The same short message after every text share; null when the user cancelled. */
export function shareMessage(r: ShareResult): string | null {
  if (r === 'cancelled') return null;
  return r === 'shared' ? 'Passed to the share menu.' : 'Copied. Paste it into WhatsApp, email or a note.';
}
