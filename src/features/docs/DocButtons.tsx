import { lazy, Suspense, useState } from 'react';
import type { DocModel } from '../../lib/docs/model';
import { renderPdf, saveFile, shareOrDownload } from '../../lib/docs/pdf';
import { renderXlsx, XLSX_MIME, xlsxFileName } from '../../lib/docs/xlsx';
import { logError } from '../../lib/errorLog';

const PdfViewer = lazy(() => import('./PdfViewer').then((m) => ({ default: m.PdfViewer })));

/**
 * "View" shows the PDF inside the app; "Share PDF" opens the phone's share
 * sheet (WhatsApp, email, print…); "Download" saves the file. Nothing is
 * sent by the app itself. "Excel" (5 Nov 2026) makes the same document as an
 * .xlsx file: shared where the phone allows it, otherwise saved to Downloads
 * (Android Chrome only shares PDF, images and text files from a web app).
 */
export function DocButtons({ label, build }: { label: string; build: () => DocModel }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [ready, setReady] = useState<{ blob: Blob; name: string; title: string } | null>(null);
  const [viewing, setViewing] = useState<{ blob: Blob; name: string; title: string } | null>(null);

  async function view() {
    setBusy(true);
    setMsg(null);
    try {
      const model = build();
      setViewing({ blob: await renderPdf(model), name: model.fileName, title: model.title });
    } catch (e) {
      logError(e, `PDF: ${label}`);
      setMsg({ kind: 'error', text: `Could not make the PDF: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  }

  // From the viewer: the file is already made, so the share menu opens straight away.
  async function fromViewer(mode: 'share' | 'download') {
    if (!viewing) return;
    let r = await shareOrDownload(viewing.blob, viewing.name, viewing.title, mode);
    if (r === 'needs-tap') r = await shareOrDownload(viewing.blob, viewing.name, viewing.title, 'download');
    if (r === 'shared' || r === 'downloaded') {
      setViewing(null);
      setMsg({ kind: 'ok', text: r === 'shared' ? 'Passed to the share menu.' : `Saved as ${viewing.name}.` });
      setTimeout(() => setMsg(null), 4000);
    }
  }

  async function excel() {
    setBusy(true);
    setMsg(null);
    try {
      const model = build();
      const blob = await renderXlsx(model);
      const name = xlsxFileName(model.fileName);
      const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([blob], name, { type: XLSX_MIME })] });
      let r = await saveFile(blob, name, XLSX_MIME, model.title, canShare ? 'share' : 'download');
      if (r === 'needs-tap') r = await saveFile(blob, name, XLSX_MIME, model.title, 'download');
      if (r === 'shared') setMsg({ kind: 'ok', text: 'Passed to the share menu.' });
      if (r === 'downloaded') setMsg({ kind: 'ok', text: canShare ? `Saved as ${name}.` : `Saved as ${name} in Downloads. To send it, open it from the download notification or Files → Downloads and share from there (the phone does not let apps like this share Excel files directly).` });
    } catch (e) {
      logError(e, `Excel: ${label}`);
      setMsg({ kind: 'error', text: `Could not make the Excel file: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 9000);
    }
  }

  async function shareReady() {
    if (!ready) return;
    let r = await shareOrDownload(ready.blob, ready.name, ready.title, 'share');
    if (r === 'needs-tap') r = await shareOrDownload(ready.blob, ready.name, ready.title, 'download'); // still refused: download instead
    setReady(null);
    if (r === 'shared') setMsg({ kind: 'ok', text: 'Passed to the share menu.' });
    if (r === 'downloaded') setMsg({ kind: 'ok', text: `Saved as ${ready.name}.` });
  }

  async function run(mode: 'share' | 'download') {
    setBusy(true);
    setMsg(null);
    try {
      const model = build();
      const blob = await renderPdf(model);
      const r = await shareOrDownload(blob, model.fileName, model.title, mode);
      if (r === 'needs-tap') setReady({ blob, name: model.fileName, title: model.title });
      if (r === 'shared') setMsg({ kind: 'ok', text: 'Passed to the share menu.' });
      if (r === 'downloaded') setMsg({ kind: 'ok', text: `Saved as ${model.fileName}.` });
    } catch (e) {
      logError(e, `PDF: ${label}`);
      setMsg({ kind: 'error', text: `Could not make the PDF: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 4000);
    }
  }

  return (
    <div className="doc-buttons">
      <span className="doc-label">{label}</span>
      <div className="row gap wrap">
        <button type="button" className="secondary small" disabled={busy} onClick={() => void view()}>
          View
        </button>
        <button type="button" className="secondary small" disabled={busy} onClick={() => void run('share')}>
          {busy ? 'Preparing…' : 'Share PDF'}
        </button>
        <button type="button" className="secondary small" disabled={busy} onClick={() => void run('download')}>
          Download
        </button>
        <button type="button" className="secondary small" disabled={busy} onClick={() => void excel()} aria-label={`${label}: Excel file`}>
          Excel
        </button>
      </div>
      {ready && (
        <p className="small">
          PDF ready.{' '}
          <button type="button" className="primary small" onClick={() => void shareReady()}>
            Share now
          </button>
        </p>
      )}
      {msg && <p className={`${msg.kind === 'ok' ? 'ok' : 'error'} small`}>{msg.text}</p>}
      {viewing && (
        <Suspense fallback={<div className="pdf-viewer"><p className="muted small pdf-msg">Opening…</p></div>}>
          <PdfViewer blob={viewing.blob} title={viewing.title} onClose={() => setViewing(null)} onShare={() => void fromViewer('share')} onDownload={() => void fromViewer('download')} />
        </Suspense>
      )}
    </div>
  );
}
