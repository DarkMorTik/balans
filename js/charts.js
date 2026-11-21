// Лёгкие SVG-графики без библиотек. Цвета через CSS-классы (поддержка светлой/тёмной темы).
import { s, compact } from './util.js';

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

function grid(svg, W, top, bottom, max, left) {
  for (let i = 0; i <= 2; i++) {
    const val = (max / 2) * i;
    const y = bottom - ((bottom - top) * i) / 2;
    svg.append(s('line', { x1: left, x2: W, y1: y, y2: y, class: i === 0 ? 'ch-axis' : 'ch-grid' }));
    if (i > 0) svg.append(s('text', { x: 0, y: y + 4, class: 'ch-label' }, compact(val)));
  }
}

/**
 * Столбцы доход/расход по корзинам.
 * data: [{label, long, inc, exp}], onSelect(i)
 */
export function bars(width, data, { height = 180, onSelect, selected = -1 } = {}) {
  const W = Math.max(240, width);
  const H = height;
  const left = 34, top = 10, bottom = H - 22;
  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.exp, d.inc))));
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart', role: 'img', 'aria-label': 'Доходы и расходы' });
  grid(svg, W, top, bottom, max, left);
  const n = data.length;
  const slot = (W - left) / n;
  const bw = Math.max(2, Math.min(14, slot * 0.36));
  const every = n > 20 ? 7 : n > 12 ? 2 : 1;
  const rects = [];
  data.forEach((d, i) => {
    const cx = left + slot * i + slot / 2;
    const g = s('g', { class: ['ch-col', i === selected && 'sel'] });
    const hE = ((bottom - top) * d.exp) / max;
    const hI = ((bottom - top) * d.inc) / max;
    const r = Math.min(3, bw / 2);
    if (d.exp > 0) g.append(s('rect', { x: cx - bw - 1, y: bottom - hE, width: bw, height: Math.max(1, hE), rx: r, class: 'ch-exp' }));
    if (d.inc > 0) g.append(s('rect', { x: cx + 1, y: bottom - hI, width: bw, height: Math.max(1, hI), rx: r, class: 'ch-inc' }));
    g.append(s('rect', { x: left + slot * i, y: top, width: slot, height: bottom - top + 22, class: 'ch-hit' }));
    if (i % every === 0 || n <= 12) g.append(s('text', { x: cx, y: H - 6, class: 'ch-label', 'text-anchor': 'middle' }, d.label));
    if (onSelect) g.addEventListener('click', () => {
      rects.forEach((x) => x.classList.remove('sel'));
      g.classList.add('sel');
      onSelect(i);
    });
    rects.push(g);
    svg.append(g);
  });
  return svg;
}

/**
 * Нарастающий итог расходов + прошлый период + прогноз.
 */
export function cumulativeLine(width, cum, { height = 170 } = {}) {
  const W = Math.max(240, width), H = height;
  const left = 34, top = 14, bottom = H - 20;
  const n = cum.totalDays;
  const vals = [...cum.pts.map((p) => p.value), ...cum.prev, cum.forecast?.value || 0];
  const max = niceMax(Math.max(1, ...vals));
  const x = (i) => left + ((W - left - 8) * i) / Math.max(1, n - 1);
  const y = (v) => bottom - ((bottom - top) * v) / max;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart', role: 'img', 'aria-label': 'Накопленные расходы' });
  grid(svg, W, top, bottom, max, left);
  if (cum.prev.length) {
    svg.append(s('polyline', { points: cum.prev.map((v, i) => `${x(i)},${y(v)}`).join(' '), class: 'ch-prev' }));
  }
  if (cum.pts.length) {
    const line = cum.pts.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
    const last = cum.pts.length - 1;
    svg.append(s('polygon', { points: `${x(0)},${bottom} ${line} ${x(last)},${bottom}`, class: 'ch-area' }));
    svg.append(s('polyline', { points: line, class: 'ch-line' }));
    if (cum.forecast) {
      const fx = x(n - 1), fy = y(cum.forecast.value);
      svg.append(s('line', { x1: x(last), y1: y(cum.pts[last].value), x2: fx, y2: fy, class: 'ch-forecast' }));
      svg.append(s('circle', { cx: fx, cy: fy, r: 3.5, class: 'ch-dot-f' }));
      svg.append(s('text', { x: fx - 4, y: fy - 8, class: 'ch-label strong', 'text-anchor': 'end' }, `≈ ${compact(cum.forecast.value)}`));
    }
    svg.append(s('circle', { cx: x(last), cy: y(cum.pts[last].value), r: 4, class: 'ch-dot' }));
  }
  return svg;
}

/** Кольцевая диаграмма. items: [{total, cat:{color}}] */
export function donut(items, { size = 168, thickness = 22, center = '', sub = '' } = {}) {
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  const total = items.reduce((a, b) => a + b.total, 0) || 1;
  const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'donut', role: 'img', 'aria-label': 'Доли по ярлыкам' });
  svg.append(s('circle', { cx: size / 2, cy: size / 2, r, class: 'donut-bg', 'stroke-width': thickness, fill: 'none' }));
  let off = 0;
  const gap = items.length > 1 ? 2 : 0;
  items.forEach((it) => {
    const len = (it.total / total) * C;
    svg.append(s('circle', {
      cx: size / 2, cy: size / 2, r, fill: 'none', stroke: it.cat.color, 'stroke-width': thickness,
      'stroke-dasharray': `${Math.max(0, len - gap)} ${C}`, 'stroke-dashoffset': -off,
      transform: `rotate(-90 ${size / 2} ${size / 2})`,
    }));
    off += len;
  });
  svg.append(s('text', { x: size / 2, y: size / 2 + 2, class: 'donut-center', 'text-anchor': 'middle' }, center));
  svg.append(s('text', { x: size / 2, y: size / 2 + 20, class: 'ch-label', 'text-anchor': 'middle' }, sub));
  return svg;
}

/** Расходы по месяцам + линия тренда. */
export function trendBars(width, tr, { height = 150 } = {}) {
  const W = Math.max(240, width), H = height;
  const left = 34, top = 12, bottom = H - 22;
  const rows = tr.rows;
  const max = niceMax(Math.max(1, ...rows.map((r) => r.exp)));
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart', role: 'img', 'aria-label': 'Тенденция расходов' });
  grid(svg, W, top, bottom, max, left);
  const slot = (W - left) / rows.length;
  const bw = Math.min(28, slot * 0.5);
  const cx = (i) => left + slot * i + slot / 2;
  const y = (v) => bottom - ((bottom - top) * v) / max;
  rows.forEach((r, i) => {
    const hh = bottom - y(r.exp);
    svg.append(s('rect', { x: cx(i) - bw / 2, y: bottom - hh, width: bw, height: Math.max(1, hh), rx: 4, class: r.partial ? 'ch-exp partial' : 'ch-exp' }));
    svg.append(s('text', { x: cx(i), y: H - 6, class: 'ch-label', 'text-anchor': 'middle' }, r.label));
  });
  if (tr.line) {
    const { a, b, offset } = tr.line;
    const i0 = offset, i1 = rows.length - 1;
    const v0 = Math.max(0, b), v1 = Math.max(0, a * (i1 - offset) + b);
    svg.append(s('line', { x1: cx(i0), y1: y(v0), x2: cx(i1), y2: y(Math.min(v1, max)), class: 'ch-trend' }));
  }
  return svg;
}
