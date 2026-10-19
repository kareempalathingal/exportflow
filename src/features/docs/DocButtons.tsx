import { useState } from 'react';
import type { DocModel } from '../../lib/docs/model';
import { renderPdf, shareOrDownload } from '../../lib/docs/pdf';

/**
 * "Share PDF" opens the phone's share sheet (WhatsApp, email, print…);
 * "Download" saves the file. Nothing is sent by the app itself.
 */
export function DocButtons({ label, build }: { label: string; build: () => DocModel }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function run(mode: 'share' | 'download') {
    setBusy(true);
    setMsg(null);
    try {
      const model = build();
      const blob = await renderPdf(model);
      const r = await shareOrDownload(blob, model.fileName, model.title, mode);
      if (r === 'shared') setMsg({ kind: 'ok', text: 'Passed to the share menu.' });
      if (r === 'downloaded') setMsg({ kind: 'ok', text: `Saved as ${model.fileName}.` });
    } catch (e) {
      setMsg({ kind: 'error', text: `Could not make the PDF: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 4000);
    }
  }

  return (
    <div className="doc-buttons">
      <span className="doc-label">{label}</span>
      <div className="row gap">
        <button type="button" className="secondary small" disabled={busy} onClick={() => void run('share')}>
          {busy ? 'Preparing…' : 'Share PDF'}
        </button>
        <button type="button" className="secondary small" disabled={busy} onClick={() => void run('download')}>
          Download
        </button>
      </div>
      {msg && <p className={`${msg.kind === 'ok' ? 'ok' : 'error'} small`}>{msg.text}</p>}
    </div>
  );
}
