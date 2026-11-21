// Гильош — узор защитной печати банкнот. Для каждого месяца свой (seed),
// амплитуда «дышит» вместе с финансовым здоровьем месяца (health: −1…1).
import { s } from './util.js';

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let gid = 0;

/**
 * @param {{w:number,h:number,seed:string,health?:number,rosette?:'right'|'center',waves?:boolean,density?:number}} o
 */
export function guilloche(o) {
  const { w, h, seed, health = 0, rosette = 'right', waves = true, density = 1 } = o;
  const rnd = rng(hash(seed));
  const id = `gq${++gid}`;
  const svg = s('svg', { viewBox: `0 0 ${w} ${h}`, class: 'gq', 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid slice' });
  const defs = s('defs', {},
    s('linearGradient', { id: `${id}a`, x1: '0', y1: '0', x2: '1', y2: '1' },
      s('stop', { offset: '0', class: 'gq-s1' }), s('stop', { offset: '0.55', class: 'gq-s2' }), s('stop', { offset: '1', class: 'gq-s3' })),
    s('radialGradient', { id: `${id}r` },
      s('stop', { offset: '0', class: 'gq-s2' }), s('stop', { offset: '1', class: 'gq-s1' })));
  svg.append(defs);

  const amp = 0.75 + Math.max(-1, Math.min(1, health)) * 0.35; // 0.4 … 1.1

  // --- волновая лента (как бордюр купюры) ---
  if (waves) {
    const g = s('g', { class: 'gq-waves', stroke: `url(#${id}a)` });
    const lines = Math.round(9 * density);
    const lam = w / (2.2 + rnd() * 1.6);
    const lam2 = w / (0.6 + rnd() * 0.5);
    const base = h * (0.74 + rnd() * 0.06);
    for (let j = 0; j < lines; j++) {
      let d = '';
      const ph = j * (0.5 + rnd() * 0.08);
      for (let x = -4; x <= w + 4; x += 4) {
        const y = base + Math.sin((2 * Math.PI * x) / lam + ph) * h * 0.07 * amp * (1 + 0.35 * Math.sin((2 * Math.PI * x) / lam2));
        d += `${x === -4 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      g.append(s('path', { d, 'pathLength': '1', class: 'gq-line' }));
    }
    svg.append(g);
  }

  // --- розетка ---
  const cx = rosette === 'center' ? w / 2 : w * 0.8;
  const cy = rosette === 'center' ? h / 2 : h * 0.42;
  const R = rosette === 'center' ? Math.min(w, h) * 0.46 : Math.min(h * 0.5, w * 0.26);
  const k = 7 + Math.floor(rnd() * 6);  // лепестки
  const m = 2 + Math.floor(rnd() * 3);  // модуляция
  const N = Math.round(26 * density);
  const ro = s('g', { class: 'gq-rosette', stroke: `url(#${id}r)` });
  const ring = (rr, kk, mm, n, a, cls) => {
    for (let j = 0; j < n; j++) {
      const rot = (j * 2 * Math.PI) / (kk * n);
      let d = '';
      const steps = 260;
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI * 2;
        const r = rr * (0.6 + a * 0.28 * Math.sin(kk * t) + 0.1 * Math.sin(mm * t + j * 0.15));
        const x = cx + r * Math.cos(t + rot);
        const y = cy + r * Math.sin(t + rot);
        d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      ro.append(s('path', { d: d + 'Z', 'pathLength': '1', class: cls }));
    }
  };
  ring(R, k, m, N, amp, 'gq-line');
  ring(R * 0.42, k + 3, m + 1, Math.round(N * 0.5), amp * 0.9, 'gq-line fine');
  svg.append(ro);
  return svg;
}
