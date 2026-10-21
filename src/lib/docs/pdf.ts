/** Draws a DocModel as an A4 PDF (jsPDF + autotable, loaded on demand). */
import { pdfSafe, type DocModel } from './model';

const NAVY: [number, number, number] = [31, 58, 95];
const INK: [number, number, number] = [23, 32, 43];
const MUTED: [number, number, number] = [91, 101, 115];
const AMBER_BG: [number, number, number] = [253, 240, 217];
const AMBER_INK: [number, number, number] = [122, 79, 0];
const M = 14; // page margin, mm
const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

export async function renderPdf(model: DocModel): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const s = pdfSafe;
  const headerH = 26 + (model.banner ? 8 : 0) + (model.provisional ? 8 : 0);

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
    let by = 25;
    if (model.banner) {
      doc.setFillColor(232, 238, 246);
      doc.rect(M, by, W - 2 * M, 6.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...NAVY);
      doc.text(s(model.banner), M + 2.5, by + 4.3);
      by += 8;
    }
    if (model.provisional) {
      doc.setFillColor(...AMBER_BG);
      doc.rect(M, by, W - 2 * M, 6.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...AMBER_INK);
      doc.text('PROVISIONAL - data not fully confirmed. Check before acting on these figures.', M + 2.5, by + 4.3);
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

  if (model.timeline && model.timeline.rows.length) {
    const tl = model.timeline;
    const d0 = dayNum(tl.from);
    const d1 = Math.max(d0 + 1, dayNum(tl.to));
    const labelW = 52;
    const x0 = M + labelW;
    const span = W - M - x0;
    const xOf = (d: string) => x0 + ((dayNum(d) - d0) / (d1 - d0)) * span;
    const rowH = 5;
    const newPage = () => {
      doc.addPage();
      drawHeader();
      y = headerH + 4;
    };
    if (y + 30 > H - 16) newPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(s(tl.title), M, y + 3);
    y += 7;
    // date ticks (about 6)
    const drawAxis = () => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...MUTED);
      const ticks = 6;
      for (let i = 0; i <= ticks; i++) {
        const dn = Math.round(d0 + ((d1 - d0) * i) / ticks);
        const x = x0 + ((dn - d0) / (d1 - d0)) * span;
        const label = new Date(dn * 86_400_000).toISOString().slice(5, 10).split('-').reverse().join('/');
        doc.text(label, x, y + 2.5, { align: i === 0 ? 'left' : i === ticks ? 'right' : 'center' });
      }
      y += 4.5;
    };
    drawAxis();
    const top = y;
    let group = '';
    for (const r of tl.rows) {
      if (y + rowH > H - 22) {
        newPage();
        drawAxis();
      }
      if (r.group !== group) {
        group = r.group;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...INK);
        doc.text(s(group), M, y + 3.4);
        y += rowH;
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...INK);
      doc.text(s(r.label).slice(0, 34), M + 2, y + 3.4);
      if (r.from && r.to) {
        const color: [number, number, number] = r.kind === 'done' ? [120, 170, 140] : r.kind === 'now' ? NAVY : r.kind === 'late' ? [190, 60, 50] : [150, 175, 210];
        doc.setFillColor(...color);
        const xa = xOf(r.from);
        const xb = Math.max(xa + 0.8, xOf(r.to) + (span / (d1 - d0)) * 0.9);
        doc.rect(xa, y + 0.8, Math.min(xb, W - M) - xa, rowH - 1.8, 'F');
      } else {
        doc.setTextColor(...AMBER_INK);
        doc.text('time pending', x0 + 1, y + 3.4);
      }
      y += rowH;
    }
    for (const mk of tl.markers) {
      if (dayNum(mk.date) < d0 || dayNum(mk.date) > d1) continue;
      const x = xOf(mk.date) + (span / (d1 - d0)) * 0.5;
      doc.setDrawColor(...mk.color);
      doc.setLineWidth(0.4);
      doc.line(x, top - 1, x, y);
      doc.setFontSize(7);
      doc.setTextColor(...mk.color);
      doc.text(s(mk.label), x, y + 3, { align: 'center' });
    }
    y += 8;
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
    if (y > H - 30) {
      doc.addPage();
      drawHeader();
      y = headerH + 4;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
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

  if (model.signature) {
    const sig = model.signature;
    if (y + 34 > H - 16) {
      doc.addPage();
      drawHeader();
      y = headerH + 4;
    }
    y += 4;
    const colW = (W - 2 * M - 10) / 2;
    const block = (x: string | number, title: string, lines: [string, string][]) => {
      const bx = Number(x);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      doc.text(s(title), bx, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      lines.forEach(([k, v], i) => {
        const ly = y + 6 + i * 7;
        doc.setTextColor(...MUTED);
        doc.text(s(k), bx, ly);
        doc.setTextColor(...INK);
        if (v) doc.text(s(v), bx + 24, ly);
        doc.setDrawColor(200, 196, 188);
        doc.setLineWidth(0.2);
        doc.line(bx + 23, ly + 1, bx + colW, ly + 1);
      });
    };
    block(M, 'Prepared by', [
      ['Name', sig.preparedBy],
      ['Designation', sig.designation],
      ['Signature', ''],
      ['Date', sig.date],
    ]);
    block(M + colW + 10, 'Reviewed / approved by', [
      ['Name', ''],
      ['Designation', ''],
      ['Signature', ''],
      ['Date', ''],
    ]);
    y += 36;
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
