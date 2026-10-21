import { useEffect, useRef, useState } from 'react';
import { logError } from '../../lib/errorLog';

/**
 * Shows a PDF inside the app, page by page (Android Chrome cannot show PDFs
 * itself). pdf.js is loaded only the first time a document is viewed.
 */
export function PdfViewer({ blob, title, onClose, onShare, onDownload }: { blob: Blob; title: string; onClose: () => void; onShare: () => void; onDownload: () => void }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; pages: number; error?: string }>({ status: 'loading', pages: 0 });
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    const host = pagesRef.current;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        if (cancelled || !host) return;
        host.replaceChildren();
        const width = Math.max(280, host.clientWidth || 360);
        const ratio = Math.min(3, (window.devicePixelRatio || 1) * 1.5); // sharp enough to zoom in
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = 'pdf-page';
          canvas.setAttribute('aria-label', `Page ${i} of ${doc.numPages}`);
          host.appendChild(canvas);
          await page.render({ canvas, viewport }).promise;
          setState({ status: 'loading', pages: i });
        }
        if (!cancelled) setState({ status: 'ready', pages: doc.numPages });
      } catch (e) {
        logError(e, `PDF view: ${title}`);
        if (!cancelled) setState({ status: 'error', pages: 0, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob, title]);

  // Close with the phone's back gesture as well as the button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="pdf-viewer" role="dialog" aria-modal="true" aria-label={`Preview: ${title}`}>
      <div className="pdf-bar">
        <button type="button" className="secondary small" onClick={onClose}>
          ✕ Close
        </button>
        <span className="pdf-title">{title}</span>
        <span className="row gap">
          <button type="button" className="secondary small icon" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z - 0.5))}>
            −
          </button>
          <button type="button" className="secondary small icon" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, z + 0.5))}>
            +
          </button>
        </span>
      </div>
      <div className="pdf-scroll">
        {state.status === 'loading' && state.pages === 0 && <p className="muted small pdf-msg">Opening… (the first time takes a few seconds)</p>}
        {state.status === 'error' && <p className="error small pdf-msg">Could not show the PDF: {state.error}. You can still share or download it.</p>}
        <div ref={pagesRef} className="pdf-pages" style={{ width: `${zoom * 100}%` }} />
      </div>
      <div className="pdf-bar bottom">
        <span className="muted small">{state.pages ? `${state.pages} page${state.pages === 1 ? '' : 's'}` : ''}</span>
        <span className="row gap">
          <button type="button" className="secondary small" onClick={onDownload}>
            Download
          </button>
          <button type="button" className="primary small" onClick={onShare}>
            Share PDF
          </button>
        </span>
      </div>
    </div>
  );
}
