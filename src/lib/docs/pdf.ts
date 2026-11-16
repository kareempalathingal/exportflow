/** Draws a DocModel as an A4 PDF (jsPDF + autotable, loaded on demand). */
import { pdfSafe, type DocModel, type DocRoadMap, type DocStepRoads, type DocTone } from './model';
import type { RowInput } from 'jspdf-autotable';

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
const BAND: [number, number, number] = [228, 236, 246]; // sub-heading band
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
    if (model.company) doc.text(s(model.company), M, 12);
    // A WO No. is 13 pt bold (16 Nov 2026); a long title shrinks, never the WO No.
    doc.setFont('helvetica', model.referenceStrong ? 'bold' : 'normal');
    doc.setFontSize(model.referenceStrong ? 13 : 11);
    doc.setTextColor(...INK);
    const refW = doc.getTextWidth(s(model.reference));
    doc.text(s(model.reference), W - M, 19.5, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    let size = 16;
    doc.setFontSize(size);
    while (size > 11 && doc.getTextWidth(s(model.title)) + refW + 8 > W - 2 * M) doc.setFontSize((size -= 0.5));
    doc.text(s(model.title), M, 19.5);
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
  /**
   * Sub-heading (16 Nov 2026): a light band with navy text, kept on the
   * same page as the first `need` mm of what follows it.
   */
  const heading = (title: string, need: number, gapAfter = 7) => {
    if (y + 8 + need > H - 16) newPage();
    doc.setFillColor(...BAND);
    doc.rect(M, y - 1.5, W - 2 * M, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(...NAVY);
    doc.text(s(title), M + 2.5, y + 3.6);
    y += gapAfter + 1.5;
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
    heading(rm.title, 43, 9);
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
    const title = (need: number) => {
      heading(sr.title, need, 0);
      const top = y - 1.5;
      let px = W - M - 1.5;
      for (const c of [...sr.counts].reverse()) {
        doc.setFontSize(7.5);
        const w = doc.getTextWidth(s(c.text)) + 5;
        px -= w;
        pill(c.text, null, px, top - 0.4, c.tone, false);
        px -= 2;
      }
      y = top + 8.5;
    };
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
    rows.forEach((row, ri) => {
      const two = row.length === 2;
      const w = two ? (W - 2 * M - 5) / 2 : W - 2 * M;
      const cols = two ? HALF : FULL;
      const h = Math.max(...row.map((r) => cardH(cols, w, r)));
      if (ri === 0) title(h);
      else if (y + h > H - 16) newPage();
      row.forEach((r, i) => drawCard(r, M + i * (w + 5), y, w, h, cols, ++num));
      y += h + 4;
    });
    if (!rows.length) title(0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const noteLines = doc.splitTextToSize(s(sr.note), W - 2 * M) as string[];
    doc.text(noteLines, M, y + 2);
    y += 5 + noteLines.length * 3.6;
  };

  // Key facts
  autoTable(doc, {
    startY: y,
    body: model.meta.map(([k, v]) => [s(k), s(v)]),
    theme: 'plain',
    rowPageBreak: 'avoid',
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
      if (y + lines.length * 4.2 > H - 16) {
        newPage();
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(...AMBER_INK);
      }
      doc.text(lines, M, y);
      y += lines.length * 4.2;
    }
    y += 2;
  }

  if (model.roadMap) drawRoadMap(model.roadMap);

  if (model.timeline && model.timeline.rows.length) {
    // Timeline (redrawn 16 Nov 2026): legend, month band, a line and label every Monday,
    // days off shaded, each product numbered with a summary bar, every bar with its dates.
    const tl = model.timeline;
    const d0 = dayNum(tl.from);
    const d1 = Math.max(d0 + 1, dayNum(tl.to) + 1);
    const labelW = 50;
    const x0 = M + labelW;
    const span = W - M - x0;
    const dayW = span / (d1 - d0);
    const xOf = (d: string) => x0 + (dayNum(d) - d0) * dayW;
    const dateOf = (dn: number) => new Date(dn * 86_400_000);
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const shortDate = (d: string) => {
      const t = dateOf(dayNum(d));
      return `${t.getUTCDate()} ${MON[t.getUTCMonth()]}`;
    };
    const range = (a: string, b: string) => {
      if (a === b) return shortDate(a);
      const ta = dateOf(dayNum(a));
      const tb = dateOf(dayNum(b));
      return ta.getUTCMonth() === tb.getUTCMonth() ? `${ta.getUTCDate()}-${shortDate(b)}` : `${shortDate(a)} - ${shortDate(b)}`;
    };
    const rowH = 5;
    const groupH = 5 + rowH; // name row + summary row
    const COLORS: Record<string, RGB> = { done: [120, 170, 110], now: NAVY, planned: [150, 180, 215], late: [200, 60, 50] };
    const SUMMARY: RGB = [150, 156, 166];
    const markers = tl.markers.filter((mk) => dayNum(mk.date) >= d0 && dayNum(mk.date) < d1).sort((x, z) => dayNum(x.date) - dayNum(z.date));
    const off = new Set(tl.offDays ?? []);

    // Groups of rows (one per product), kept on one page when they fit.
    const groups: { name: string; rows: typeof tl.rows }[] = [];
    for (const r of tl.rows) {
      if (groups.at(-1)?.name !== r.group) groups.push({ name: r.group, rows: [] });
      groups.at(-1)!.rows.push(r);
    }
    const headH = 11 + 6 + 4; // legend (up to two lines) + month band + week labels

    const drawLegend = () => {
      let lx = M;
      const ly = y;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      let ly2 = ly;
      const item = (label: string, draw: (x: number, yy: number) => void, w = 3.2) => {
        if (lx + w + 1.2 + doc.getTextWidth(s(label)) > W - M) {
          lx = M;
          ly2 += 4.5;
        }
        const yy = ly2;
        draw(lx, yy);
        doc.setTextColor(...MUTED);
        doc.text(s(label), lx + w + 1.2, yy + 2.5);
        lx += w + 1.2 + doc.getTextWidth(s(label)) + 4;
      };
      const box = (c: RGB) => (x: number, yy: number) => {
        doc.setFillColor(...c);
        doc.rect(x, yy, 3.2, 3, 'F');
      };
      item('Done', box(COLORS.done!));
      item('Running now', box(COLORS.now!));
      item('Planned', box(COLORS.planned!));
      item('Approx. date', (x, yy) => {
        doc.setDrawColor(...COLORS.planned!);
        doc.setLineWidth(0.35);
        dashed(true);
        doc.rect(x, yy, 3.2, 3, 'S');
        dashed(false);
      });
      item('Over plan / late', box(COLORS.late!));
      item('All steps of a product', box(SUMMARY));
      for (const mk of markers) {
        item(mk.label, (x, yy) => {
          doc.setDrawColor(...mk.color);
          doc.setLineWidth(0.5);
          doc.line(x + 1.6, yy - 0.5, x + 1.6, yy + 3.5);
        });
      }
      y = ly2 + 7;
    };
    const drawAxis = () => {
      // Month band.
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      let dn = d0;
      while (dn < d1) {
        const t = dateOf(dn);
        const next = Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1) / 86_400_000;
        const end = Math.min(d1, next);
        const xa = x0 + (dn - d0) * dayW;
        const xb = x0 + (end - d0) * dayW;
        doc.setFillColor(...SOFT);
        doc.rect(xa, y, xb - xa - 0.3, 4.5, 'F');
        doc.setTextColor(...INK);
        const label = xb - xa > 30 ? `${MONTH_FULL[t.getUTCMonth()]} ${t.getUTCFullYear()}` : MON[t.getUTCMonth()]!;
        if (xb - xa > 8) doc.text(label, (xa + xb) / 2, y + 3.2, { align: 'center' });
        dn = end;
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...MUTED);
      doc.text('Product · step', M, y + 3.2);
      y += 6;
      // A label at every Monday (every day when there is room).
      const every = dayW >= 9 ? 1 : 7;
      for (let k = d0; k < d1; k++) {
        const t = dateOf(k);
        if (every === 7 && t.getUTCDay() !== 1) continue;
        const x = x0 + (k - d0) * dayW;
        const label = every === 7 ? `Mon ${t.getUTCDate()}` : `${t.getUTCDate()}`;
        if (x + doc.getTextWidth(label) > W - M + 1) continue;
        doc.text(label, x + 0.5, y + 2.5);
      }
      y += 4;
    };
    // Shading for days off and a line at every Monday, from top to bottom of this page's rows.
    const drawGrid = (top: number, bottom: number) => {
      doc.setFillColor(236, 236, 236);
      for (let k = d0; k < d1; k++) {
        const iso = dateOf(k).toISOString().slice(0, 10);
        if (off.has(iso)) doc.rect(x0 + (k - d0) * dayW, top, dayW, bottom - top, 'F');
      }
      doc.setDrawColor(...RULE);
      doc.setLineWidth(0.15);
      for (let k = d0; k <= d1; k++) {
        if (dateOf(k).getUTCDay() !== 1 && k !== d0) continue;
        const x = x0 + (k - d0) * dayW;
        doc.line(x, top, x, bottom);
      }
    };
    const drawMarkers = (top: number, bottom: number) => {
      for (const mk of markers) {
        const x = xOf(mk.date) + dayW / 2;
        doc.setDrawColor(...mk.color);
        doc.setLineWidth(0.45);
        doc.line(x, top, x, bottom);
      }
    };
    const barText = (text: string, xa: number, xb: number, ty: number, color: RGB = MUTED) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...color);
      const w = doc.getTextWidth(s(text));
      if (xb + 1 + w <= W - M) doc.text(s(text), xb + 1, ty);
      else doc.text(s(text), Math.max(x0 + 0.5, xa - 1), ty, { align: xa - 1 - w >= x0 ? 'right' : 'left' });
    };

    // Page by page: work out which groups fit, then grid, rows and markers.
    heading(tl.title, headH + groupH + rowH * Math.min(3, groups[0]!.rows.length), 7);
    let gi = 0;
    while (gi < groups.length) {
      drawLegend();
      drawAxis();
      const top = y;
      const room = H - 24 - top;
      let used = 0;
      const page: typeof groups = [];
      while (gi < groups.length) {
        const g = groups[gi]!;
        const h = groupH + g.rows.length * rowH;
        if (used + h > room) {
          if (page.length === 0) {
            // A product taller than a page: as many of its rows as fit, the rest on the next page.
            const fit = Math.max(1, Math.floor((room - groupH) / rowH));
            page.push({ name: g.name, rows: g.rows.slice(0, fit) });
            groups[gi] = { name: `${g.name} (continued)`, rows: g.rows.slice(fit) };
            used = room;
          }
          break;
        }
        page.push(g);
        used += h;
        gi++;
      }
      const bottom = top + used;
      drawGrid(top, bottom);
      for (const g of page) {
        const dated = g.rows.filter((r) => r.from && r.to);
        // Product name across the whole width (on white, above the grid), then its summary bar.
        doc.setFillColor(...WHITE);
        doc.rect(M, y, W - 2 * M, 5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...INK);
        doc.text((doc.splitTextToSize(s(g.name), W - 2 * M) as string[])[0] ?? '', M, y + 3.8);
        y += 5;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...MUTED);
        doc.text('All steps', M + 2.5, y + 3.4);
        if (dated.length) {
          const from = dated.map((r) => r.from!).sort()[0]!;
          const to = dated.map((r) => r.to!).sort().at(-1)!;
          const xa = xOf(from);
          const xb = Math.min(W - M, xOf(to) + dayW);
          doc.setFillColor(...SUMMARY);
          doc.rect(xa, y + 1, Math.max(0.8, xb - xa), rowH - 2, 'F');
          barText(`${range(from, to)}${dated.length < g.rows.length ? ' (some dates to be confirmed)' : ''}`, xa, xb, y + 3.4, INK);
        }
        y += rowH;
        for (const r of g.rows) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);
          doc.setTextColor(...INK);
          doc.text((doc.splitTextToSize(s(r.label), labelW - 4) as string[])[0] ?? '', M + 2.5, y + 3.4);
          if (r.from && r.to) {
            const xa = xOf(r.from);
            const xb = Math.min(W - M, xOf(r.to) + dayW);
            const c = COLORS[r.kind] ?? COLORS.planned!;
            if (r.approx) {
              doc.setFillColor(232, 240, 250);
              doc.rect(xa, y + 1, Math.max(0.8, xb - xa), rowH - 2, 'F');
              doc.setDrawColor(...c);
              doc.setLineWidth(0.35);
              dashed(true);
              doc.rect(xa, y + 1, Math.max(0.8, xb - xa), rowH - 2, 'S');
              dashed(false);
            } else {
              doc.setFillColor(...c);
              doc.rect(xa, y + 1, Math.max(0.8, xb - xa), rowH - 2, 'F');
            }
            barText(`${range(r.from, r.to)}${r.approx ? ' approx.' : ''}${r.note ? ` · ${r.note}` : ''}`, xa, xb, y + 3.4, r.kind === 'late' ? RED_INK : MUTED);
          } else {
            doc.setFontSize(7);
            doc.setTextColor(...AMBER_INK);
            doc.text('date to be confirmed', x0 + 1, y + 3.4);
          }
          y += rowH;
        }
      }
      drawMarkers(top, bottom);
      if (gi < groups.length) newPage();
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text('Shaded columns = Sundays and company holidays (not worked). Lines mark each Monday.', M, y + 3);
    y += 9;
  }

  for (const ch of model.charts ?? []) {
    const rowH = 4.2;
    const gap = 2.5;
    const groupH = ch.series.length * rowH + gap;
    const needed = 12 + ch.rows.length * groupH;
    heading(ch.title, Math.min(needed, 12 + 2 * groupH), 2);
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
    // The title is the table's first head row (16 Nov 2026): it stays with the column
    // heads and the first row, and comes back as "(continued)" on every next page.
    const titleRow = [{ content: s(t.title), colSpan: t.columns.length, styles: { fillColor: BAND, textColor: NAVY, fontSize: 11.5, fontStyle: 'bold' as const, halign: 'left' as const, lineWidth: 0, cellPadding: { top: 1.6, bottom: 1.6, left: 2.5, right: 2 } } }];
    const body: RowInput[] = t.rows.length ? t.rows.map((r) => r.map((c) => c.split('\n').map(s).join('\n'))) : [[{ content: s(t.empty), colSpan: t.columns.length, styles: { textColor: MUTED, fontStyle: 'italic' as const } }]];
    const options = (rows: RowInput[]): Parameters<typeof autoTable>[1] => ({
      head: t.noHead ? [titleRow] : [titleRow, t.columns.map((c) => s(c.label))],
      rowPageBreak: 'avoid',
      body: rows,
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
        if (cell.section === 'head' && cell.row.index > 0) cell.cell.styles.halign = t.columns[cell.column.index]?.align ?? 'left';
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
      willDrawCell: (cell) => {
        if (cell.section === 'head' && cell.row.index === 0 && cell.pageNumber > 1) {
          // "(continued)" only when it fits in the lines the title already has.
          const width = cell.cell.width - 4.5;
          for (const tail of [' (continued)', ' (cont.)']) {
            const lines = doc.splitTextToSize(`${s(t.title)}${tail}`, width) as string[];
            if (lines.length <= cell.cell.text.length) {
              cell.cell.text = lines;
              break;
            }
          }
        }
      },
      margin: { left: M, right: M, top: headerH + 2, bottom: 16 },
      didDrawPage: drawHeader,
    });
    // Keep the title, column heads and the first row together: measure them on a scratch page.
    const scratch = new jsPDF({ unit: 'mm', format: 'a4' });
    autoTable(scratch, { ...options(body.slice(0, 1)), startY: 0, margin: { left: M, right: M, top: 0, bottom: 0 }, willDrawCell: undefined, didDrawPage: undefined });
    const firstH = Math.min((scratch as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY, H - headerH - 24);
    if (y + firstH > H - 16) newPage();
    autoTable(doc, { ...options(body), startY: y });
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
    doc.text(s(`Generated ${model.generatedAt}`), M, H - 8);
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
