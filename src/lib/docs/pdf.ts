/** Draws a DocModel as an A4 PDF (jsPDF + autotable, loaded on demand). */
import { pdfSafe, type DocModel } from './model';

const NAVY: [number, number, number] = [31, 58, 95];
const INK: [number, number, number] = [23, 32, 43];
const MUTED: [number, number, number] = [91, 101, 115];
const AMBER_BG: [number, number, number] = [253, 240, 217];
const AMBER_INK: [number, number, number] = [122, 79, 0];
const M = 14; // page margin, mm

export async function renderPdf(model: DocModel): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const s = pdfSafe;
  const headerH = model.provisional ? 34 : 26;

  const drawHeader = () => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(s(model.company || 'ExportFlow'), M, 12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...INK);
    doc.text(s(model.title), M, 19.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(s(model.reference), W - M, 19.5, { align: 'right' });
    doc.setDrawColor(...NAVY);
    doc.setLineWidth(0.6);
    doc.line(M, 22.5, W - M, 22.5);
    if (model.provisional) {
      doc.setFillColor(...AMBER_BG);
      doc.rect(M, 25, W - 2 * M, 6.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...AMBER_INK);
      doc.text('PROVISIONAL - data not fully confirmed. Check before acting on these figures.', M + 2.5, 29.3);
    }
  };

  let y = headerH + 2;
  drawHeader();

  // Key facts
  autoTable(doc, {
    startY: y,
    body: model.meta.map(([k, v]) => [s(k), s(v)]),
    theme: 'plain',
    styles: { fontSize: 9.5, cellPadding: { top: 0.8, bottom: 0.8, left: 0, right: 2 }, textColor: INK },
    columnStyles: { 0: { cellWidth: 38, textColor: MUTED } },
    margin: { left: M, right: M, top: headerH + 2 },
    didDrawPage: drawHeader,
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;

  if (model.provisional && model.provisionalReasons.length) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...AMBER_INK);
    doc.text('Why provisional:', M, y);
    doc.setFont('helvetica', 'normal');
    y += 4.5;
    for (const r of model.provisionalReasons) {
      const lines = doc.splitTextToSize(s(`- ${r}`), W - 2 * M);
      doc.text(lines, M, y);
      y += lines.length * 4.2;
    }
    y += 2;
  }

  for (const ch of model.charts ?? []) {
    const rowH = 4.2;
    const gap = 2.5;
    const groupH = ch.series.length * rowH + gap;
    const needed = 12 + ch.rows.length * groupH;
    if (y + needed > H - 16) {
      doc.addPage();
      drawHeader();
      y = headerH + 4;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(s(ch.title), M, y + 3);
    // legend
    let lx = M;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    for (const se of ch.series) {
      doc.setFillColor(...se.color);
      doc.rect(lx, y + 5.5, 3, 3, 'F');
      doc.setTextColor(...MUTED);
      doc.text(s(se.label), lx + 4, y + 8.2);
      lx += doc.getTextWidth(s(se.label)) + 10;
    }
    y += 12;
    const labelW = 28;
    const max = Math.max(1, ...ch.rows.flatMap((r) => r.values));
    const barW = W - 2 * M - labelW - 14;
    for (const r of ch.rows) {
      if (y + groupH > H - 16) {
        doc.addPage();
        drawHeader();
        y = headerH + 4;
      }
      doc.setFontSize(8.5);
      doc.setTextColor(...INK);
      doc.text(s(r.label), M, y + rowH * 0.8);
      r.values.forEach((v, i) => {
        const se = ch.series[i]!;
        const by = y + i * rowH;
        doc.setFillColor(...se.color);
        doc.rect(M + labelW, by, Math.max(0.3, (v / max) * barW), rowH - 1, 'F');
        doc.setTextColor(...MUTED);
        doc.text(`${v}`, M + labelW + (v / max) * barW + 1.5, by + rowH * 0.7);
      });
      y += groupH;
    }
    y += 4;
  }

  for (const t of model.tables) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    if (y > H - 30) {
      doc.addPage();
      drawHeader();
      y = headerH + 4;
    }
    doc.text(s(t.title), M, y + 3);
    autoTable(doc, {
      startY: y + 5,
      head: [t.columns.map((c) => s(c.label))],
      body: t.rows.length ? t.rows.map((r) => r.map(s)) : [[{ content: s(t.empty), colSpan: t.columns.length, styles: { textColor: MUTED, fontStyle: 'italic' } }]],
      theme: 'grid',
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9.5 },
      styles: { fontSize: 9.5, cellPadding: 2, textColor: INK, lineColor: [220, 216, 207], lineWidth: 0.2, overflow: 'linebreak' },
      alternateRowStyles: { fillColor: [247, 246, 242] },
      columnStyles: Object.fromEntries(t.columns.map((c, i) => [i, { halign: c.align ?? 'left' }])),
      didParseCell: (cell) => {
        if (cell.section === 'head') cell.cell.styles.halign = t.columns[cell.column.index]?.align ?? 'left';
      },
      margin: { left: M, right: M, top: headerH + 2, bottom: 16 },
      didDrawPage: drawHeader,
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  if (model.notes.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    for (const n of model.notes) {
      const lines = doc.splitTextToSize(s(n), W - 2 * M);
      if (y + lines.length * 4 > H - 16) {
        doc.addPage();
        drawHeader();
        y = headerH + 4;
      }
      doc.text(lines, M, y);
      y += lines.length * 4 + 1;
    }
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(s(`ExportFlow · generated ${model.generatedAt}`), M, H - 8);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 8, { align: 'right' });
  }
  return doc.output('blob');
}

/**
 * Hand the PDF to the phone: the share sheet (WhatsApp, email, print apps)
 * where supported, otherwise a normal download.
 */
export async function shareOrDownload(blob: Blob, fileName: string, title: string, mode: 'share' | 'download'): Promise<'shared' | 'downloaded' | 'cancelled'> {
  return saveFile(blob, fileName, 'application/pdf', title, mode);
}

/** Any file: the share sheet where supported, otherwise a normal download. */
export async function saveFile(blob: Blob, fileName: string, mime: string, title: string, mode: 'share' | 'download'): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], fileName, { type: mime });
  if (mode === 'share' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      throw e;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
