/** Draws a DocModel as an A4 PDF (jsPDF + autotable, loaded on demand). */
import { pdfSafe, type DocModel, type DocRoadMap, type DocStepRoads, type DocTone } from './model';

const NAVY: [number, number, number] = [31, 58, 95];
const INK: [number, number, number] = [23, 32, 43];
const MUTED: [number, number, number] = [91, 101, 115];
const AMBER_BG: [number, number, number] = [253, 240, 217];
const AMBER_INK: [number, number, number] = [122, 79, 0];
const AMBER_LINE: [number, number, number] = [199, 119, 0];
const RED: [number, number, number] = [163, 38, 30];
const RED_INK: [number, number, number] = [126, 29, 23];
const GREY: [number, number, number] = [107, 114, 128];
const SOFT: [number, number, number] = [244, 246, 249];
const RULE: [number, number, number] = [195, 205, 217];
const WHITE: [number, number, number] = [255, 255, 255];
type RGB = [number, number, number];
/** Badge (light) and pill (strong) colours per tone. */
const TONE: Record<DocTone, { bg: RGB; ink: RGB; pill: RGB; pillInk: RGB }> = {
  ok: { bg: [221, 239, 227], ink: [44, 107, 66], pill: [63, 143, 90], pillInk: WHITE },
  tight: { bg: [251, 239, 208], ink: [122, 74, 0], pill: [224, 161, 0], pillInk: INK },
  late: { bg: [250, 222, 219], ink: RED_INK, pill: RED, pillInk: WHITE },
  unknown: { bg: [236, 239, 243], ink: [74, 82, 96], pill: WHITE, pillInk: [74, 82, 96] },
  done: { bg: [232, 238, 246], ink: NAVY, pill: NAVY, pillInk: WHITE },
};
/** Heat levels (light → dark navy) for load tables. */
const HEAT: RGB[] = [
  [220, 230, 242],
  [169, 187, 211],
  [74, 106, 150],
];
const ROW_TONE: Partial<Record<DocTone, RGB>> = { tight: [255, 246, 224], late: [252, 232, 230], unknown: SOFT };
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
  const newPage = () => {
    doc.addPage();
    drawHeader();
    y = headerH + 4;
  };
  const dashed = (on: boolean) => doc.setLineDashPattern(on ? [1.2, 0.9] : [], 0);
  const pill = (text: string, cx: number | null, x: number, top: number, tone: DocTone, strong: boolean, size = 7.5) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(size);
    const t = TONE[tone];
    const w = doc.getTextWidth(s(text)) + 5;
    const h = 4.8;
    const left = cx !== null ? cx - w / 2 : x;
    doc.setFillColor(...(strong ? t.pill : t.bg));
    if (strong && tone === 'unknown') {
      doc.setDrawColor(...GREY);
      doc.setLineWidth(0.35);
      dashed(true);
      doc.roundedRect(left, top, w, h, h / 2, h / 2, 'FD');
      dashed(false);
    } else doc.roundedRect(left, top, w, h, h / 2, h / 2, 'F');
    doc.setTextColor(...(strong ? t.pillInk : t.ink));
    doc.text(s(text), left + w / 2, top + h / 2 + size * 0.13, { align: 'center' });
    return w;
  };

  /** The order's journey: received → plan → production → internal deadline → delivery. */
  const drawRoadMap = (rm: DocRoadMap) => {
    if (y + 52 > H - 16) newPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(s(rm.title), M, y + 3);
    y += 9;
    const n = rm.stops.length;
    const colW = (W - 2 * M) / n;
    const cx = (i: number) => M + colW * (i + 0.5);
    const ly = y + 2.5;
    doc.setLineWidth(1);
    doc.setDrawColor(...RULE);
    doc.line(cx(0), ly, cx(n - 1), ly);
    if (rm.reached > 0) {
      doc.setDrawColor(...NAVY);
      doc.line(cx(0), ly, cx(rm.reached), ly);
    }
    let bottom = ly;
    rm.stops.forEach((st, i) => {
      const color: RGB = st.kind === 'deadline' ? AMBER_LINE : st.kind === 'delivery' ? RED : st.kind === 'next' ? GREY : NAVY;
      doc.setDrawColor(...color);
      doc.setLineWidth(st.kind === 'now' ? 1.1 : 0.8);
      if (st.kind === 'done') {
        doc.setFillColor(...NAVY);
        doc.circle(cx(i), ly, 2.4, 'F');
      } else {
        doc.setFillColor(...WHITE);
        doc.circle(cx(i), ly, 2.4, 'FD');
      }
      let ty = ly + 7.5;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...(st.kind === 'deadline' ? AMBER_INK : st.kind === 'delivery' ? RED_INK : INK));
      doc.text(s(st.label), cx(i), ty, { align: 'center' });
      ty += 4.5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...INK);
      doc.text(s(st.date), cx(i), ty, { align: 'center' });
      if (st.here) {
        ty += 2;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        const w = doc.getTextWidth('we are here') + 5;
        doc.setFillColor(...NAVY);
        doc.roundedRect(cx(i) - w / 2, ty, w, 4.4, 2.2, 2.2, 'F');
        doc.setTextColor(...WHITE);
        doc.text('we are here', cx(i), ty + 3.1, { align: 'center' });
        ty += 4.4;
      }
      if (st.note) {
        ty += 4;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...(st.kind === 'deadline' ? AMBER_INK : MUTED));
        const lines = doc.splitTextToSize(s(st.note), colW - 2) as string[];
        doc.text(lines, cx(i), ty, { align: 'center' });
        ty += (lines.length - 1) * 3.2;
      }
      bottom = Math.max(bottom, ty);
    });
    y = bottom + 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const lines = doc.splitTextToSize(s(`In short: ${rm.summary}`), W - 2 * M - 8) as string[];
    const h = lines.length * 4.3 + 4.5;
    doc.setFillColor(...SOFT);
    doc.rect(M, y, W - 2 * M, h, 'F');
    doc.setTextColor(...INK);
    doc.text(lines, M + 4, y + 5.3);
    y += h + 7;
  };

  /** Each product's steps as landmarks ending in "Ready" (cards; small ones in pairs). */
  const drawStepRoads = (sr: DocStepRoads) => {
    if (y + 45 > H - 16) newPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(s(sr.title), M, y + 3);
    let px = W - M;
    for (const c of [...sr.counts].reverse()) {
      doc.setFontSize(7.5);
      const w = doc.getTextWidth(s(c.text)) + 5;
      px -= w;
      pill(c.text, null, px, y - 0.6, c.tone, false);
      px -= 2;
    }
    y += 8;
    const FULL = 7;
    const HALF = 3;
    const nodeCount = (r: DocStepRoads['items'][number]) => (r.empty ? 0 : r.nodes.length + 1);
    // Rows of one full-width card, or two half cards for products with up to 2 steps.
    const rows: DocStepRoads['items'][] = [];
    for (let i = 0; i < sr.items.length; i++) {
      const a = sr.items[i]!;
      const b = sr.items[i + 1];
      if (b && !a.empty && !b.empty && nodeCount(a) <= HALF && nodeCount(b) <= HALF) {
        rows.push([a, b]);
        i++;
      } else rows.push([a]);
    }
    let num = 0;
    const textH = (cols: number, w: number, r: DocStepRoads['items'][number]) => {
      const colW = (w - 4) / cols;
      doc.setFontSize(7.5);
      let max = 0;
      for (const n of r.nodes) {
        const l = (doc.splitTextToSize(s(n.label), colW - 1.5) as string[]).length;
        const sub = n.sub ? (doc.splitTextToSize(s(n.sub), colW - 1.5) as string[]).length : 0;
        const d = (doc.splitTextToSize(s(n.dates), colW - 1.5) as string[]).length;
        max = Math.max(max, l * 3.2 + sub * 2.9 + d * 3);
      }
      return max;
    };
    const cardH = (cols: number, w: number, r: DocStepRoads['items'][number]) => {
      if (r.empty) return 11 + 9;
      const chunks = Math.ceil(nodeCount(r) / cols);
      return 11 + chunks * (9.5 + textH(cols, w, r)) + 3;
    };
    const drawCard = (r: DocStepRoads['items'][number], x: number, top: number, w: number, h: number, cols: number, n: number) => {
      // header band, then the outline on top
      doc.setFillColor(...SOFT);
      doc.roundedRect(x, top, w, 11, 2, 2, 'F');
      doc.rect(x, top + 6, w, 5, 'F');
      doc.setDrawColor(...(r.dashed ? GREY : [220, 226, 234] as RGB));
      doc.setLineWidth(0.3);
      dashed(r.dashed);
      doc.roundedRect(x, top, w, h, 2, 2, 'S');
      dashed(false);
      doc.setFillColor(...NAVY);
      doc.circle(x + 6, top + 5.5, 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...WHITE);
      doc.text(String(n), x + 6, top + 6.6, { align: 'center' });
      doc.setFontSize(7.5);
      const bw = doc.getTextWidth(s(r.badge.text)) + 5;
      pill(r.badge.text, null, x + w - 3 - bw, top + 3.1, r.badge.tone, false);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      doc.text((doc.splitTextToSize(s(r.name), w - 16 - bw) as string[])[0] ?? '', x + 11, top + 5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text((doc.splitTextToSize(s(r.sub), w - 16 - bw) as string[])[0] ?? '', x + 11, top + 8.8);
      if (r.empty) {
        doc.setFontSize(8.5);
        doc.text(s(r.empty), x + 4, top + 16.5);
        return;
      }
      const colW = (w - 4) / cols;
      const all = [...r.nodes.map((nd, i) => ({ nd, i })), null];
      const th = textH(cols, w, r);
      for (let c = 0; c * cols < all.length; c++) {
        const chunk = all.slice(c * cols, (c + 1) * cols);
        const ly = top + 11 + c * (9.5 + th) + 5.5;
        const cx = (i: number) => x + 2 + colW * (i + 0.5);
        doc.setDrawColor(...RULE);
        doc.setLineWidth(0.8);
        dashed(r.dashed);
        if (chunk.length > 1) doc.line(cx(0), ly, cx(chunk.length - 1), ly);
        dashed(false);
        // Progress (confirmed 27 Oct 2026): dark line up to the step reached; the part leading
        // into a step that took longer than its benchmark is red.
        const upto = Math.min(r.reached, c * cols + chunk.length - 1) - c * cols;
        doc.setLineWidth(1);
        for (let j = 1; j <= upto; j++) {
          const into = r.nodes[c * cols + j];
          doc.setDrawColor(...(into && into.overDays > 0 ? RED : NAVY));
          doc.line(cx(j - 1), ly, cx(j), ly);
        }
        chunk.forEach((item, i) => {
          if (!item) {
            pill(r.ready.text, cx(i), 0, ly - 2.4, r.ready.tone, true);
            return;
          }
          const { nd } = item;
          const ring: RGB = nd.state === 'late' || nd.overDays > 0 ? RED : nd.state === 'unknown' ? GREY : NAVY;
          doc.setDrawColor(...ring);
          doc.setLineWidth(nd.state === 'now' ? 0.9 : 0.5);
          dashed(nd.state === 'unknown' || nd.state === 'approx');
          doc.setFillColor(...(nd.state === 'done' ? ring : WHITE));
          doc.circle(cx(i), ly, 2.4, nd.state === 'done' ? 'F' : 'FD');
          dashed(false);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6.5);
          doc.setTextColor(...(nd.state === 'done' ? WHITE : ring));
          doc.text(String(item.i + 1), cx(i), ly + 0.85, { align: 'center' });
          let ty = ly + 6.2;
          doc.setFontSize(7.5);
          doc.setTextColor(...INK);
          const label = doc.splitTextToSize(s(nd.label), colW - 1.5) as string[];
          doc.text(label, cx(i), ty, { align: 'center' });
          ty += label.length * 3.2;
          doc.setFont('helvetica', 'normal');
          if (nd.sub) {
            doc.setFontSize(6.5);
            doc.setTextColor(...MUTED);
            const sub = doc.splitTextToSize(s(nd.sub), colW - 1.5) as string[];
            doc.text(sub, cx(i), ty - 0.3, { align: 'center' });
            ty += sub.length * 2.9;
          }
          doc.setFont('helvetica', nd.state === 'now' ? 'bold' : 'normal');
          doc.setFontSize(7);
          doc.setTextColor(...(nd.state === 'late' || nd.overDays > 0 ? RED_INK : nd.state === 'now' ? NAVY : MUTED));
          doc.text(doc.splitTextToSize(s(nd.dates), colW - 1.5) as string[], cx(i), ty, { align: 'center' });
        });
      }
    };
    for (const row of rows) {
      const two = row.length === 2;
      const w = two ? (W - 2 * M - 5) / 2 : W - 2 * M;
      const cols = two ? HALF : FULL;
      const h = Math.max(...row.map((r) => cardH(cols, w, r)));
      if (y + h > H - 16) newPage();
      row.forEach((r, i) => drawCard(r, M + i * (w + 5), y, w, h, cols, ++num));
      y += h + 4;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(s(sr.note), M, y + 2);
    y += 9;
  };

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

  if (model.roadMap) drawRoadMap(model.roadMap);

  if (model.timeline && model.timeline.rows.length) {
    const tl = model.timeline;
    const d0 = dayNum(tl.from);
    const d1 = Math.max(d0 + 1, dayNum(tl.to));
    const labelW = 52;
    const x0 = M + labelW;
    const span = W - M - x0;
    const xOf = (d: string) => x0 + ((dayNum(d) - d0) / (d1 - d0)) * span;
    const rowH = 5;
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
    let top = y;
    // Today / deadline / delivery lines on every page of the chart, labels under them (staggered when close).
    const drawMarkers = () => {
      let lastX = -99;
      let level = 0;
      const shown = tl.markers.filter((mk) => dayNum(mk.date) >= d0 && dayNum(mk.date) <= d1).sort((a, b) => dayNum(a.date) - dayNum(b.date));
      for (const mk of shown) {
        const x = xOf(mk.date) + (span / (d1 - d0)) * 0.5;
        doc.setDrawColor(...mk.color);
        doc.setLineWidth(0.4);
        doc.line(x, top - 1, x, y);
        level = x - lastX < 24 ? level + 1 : 0;
        lastX = x;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...mk.color);
        const align = x > W - M - 12 ? 'right' : x < x0 + 12 ? 'left' : 'center';
        doc.text(s(mk.label), x, y + 3 + level * 3, { align });
      }
      return shown.length ? 3 + level * 3 : 0;
    };
    let group = '';
    for (const r of tl.rows) {
      if (y + rowH > H - 22) {
        drawMarkers();
        newPage();
        drawAxis();
        top = y;
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
      doc.text((doc.splitTextToSize(s(r.label), labelW - 3) as string[])[0] ?? '', M + 2, y + 3.4);
      if (r.from && r.to) {
        const color: [number, number, number] = r.kind === 'done' ? [120, 170, 140] : r.kind === 'now' ? NAVY : r.kind === 'late' ? [190, 60, 50] : [150, 175, 210];
        doc.setFillColor(...color);
        const xa = xOf(r.from);
        const xb = Math.max(xa + 0.8, xOf(r.to) + (span / (d1 - d0)) * 0.9);
        doc.rect(xa, y + 0.8, Math.min(xb, W - M) - xa, rowH - 1.8, 'F');
      } else {
        doc.setTextColor(...AMBER_INK);
        doc.text('to be confirmed', x0 + 1, y + 3.4);
      }
      y += rowH;
    }
    y += drawMarkers() + 6;
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

  const roads = model.stepRoads;
  for (const [ti, t] of model.tables.entries()) {
    if (roads && ti === roads.afterTables) drawStepRoads(roads);
    if (y > H - 40) {
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
      head: t.noHead ? [] : [t.columns.map((c) => s(c.label))],
      body: t.rows.length ? t.rows.map((r) => r.map((c) => c.split('\n').map(s).join('\n'))) : [[{ content: s(t.empty), colSpan: t.columns.length, styles: { textColor: MUTED, fontStyle: 'italic' } }]],
      theme: 'grid',
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9.5 },
      styles: { fontSize: 9.5, cellPadding: 2, textColor: INK, lineColor: [220, 216, 207], lineWidth: 0.2, overflow: 'linebreak' },
      alternateRowStyles: { fillColor: [247, 246, 242] },
      // Numbers never wrap ("7,859 kg"); text columns take the rest of the width.
      columnStyles: Object.fromEntries(
        t.columns.map((c, i) => [
          i,
          c.align === 'right'
            ? { halign: 'right' as const, cellWidth: 'wrap' as const }
            : { halign: 'left' as const, ...(t.columns.filter((x) => x.align !== 'right').length * 30 <= 120 ? { minCellWidth: 30 } : {}) },
        ]),
      ),
      didParseCell: (cell) => {
        if (cell.section === 'head') cell.cell.styles.halign = t.columns[cell.column.index]?.align ?? 'left';
        const level = cell.section === 'body' ? (t.cellLevels?.[cell.row.index]?.[cell.column.index] ?? 0) : 0;
        if (level > 0) {
          cell.cell.styles.fillColor = HEAT[Math.min(3, level) - 1]!;
          if (level >= 3) cell.cell.styles.textColor = WHITE;
          cell.cell.styles.halign = 'center';
        }
        const tone = cell.section === 'body' ? t.rowTones?.[cell.row.index] : null;
        if (tone && ROW_TONE[tone]) {
          cell.cell.styles.fillColor = ROW_TONE[tone]!;
          if (cell.column.index === t.columns.length - 1) {
            cell.cell.styles.textColor = TONE[tone].ink;
            cell.cell.styles.fontStyle = 'bold';
          }
        }
      },
      margin: { left: M, right: M, top: headerH + 2, bottom: 16 },
      didDrawPage: drawHeader,
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  if (roads && roads.afterTables >= model.tables.length) drawStepRoads(roads);

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
export async function shareOrDownload(blob: Blob, fileName: string, title: string, mode: 'share' | 'download'): Promise<SaveResult> {
  return saveFile(blob, fileName, 'application/pdf', title, mode);
}

/** Any file: the share sheet where supported, otherwise a normal download. */
/**
 * 'needs-tap': the phone refused to open the share menu because preparing the
 * file took too long after the tap (browsers allow ~5 s). The file is ready;
 * the caller shows a "Share now" button that calls saveFile again.
 */
export type SaveResult = 'shared' | 'downloaded' | 'cancelled' | 'needs-tap';

export async function saveFile(blob: Blob, fileName: string, mime: string, title: string, mode: 'share' | 'download'): Promise<SaveResult> {
  const file = new File([blob], fileName, { type: mime });
  if (mode === 'share' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      if (e instanceof DOMException && e.name === 'NotAllowedError') return 'needs-tap';
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
