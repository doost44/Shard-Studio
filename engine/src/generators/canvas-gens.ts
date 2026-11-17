// Canvas 2D generators: procedural shapes and type. No stock images anywhere:
// porcelain florals, street signage, 1990s-spirited UI chrome (original
// designs), road paint, hazard stripes and dense text columns.
//
// Each draws at the document's size with lengths scaled by `unit`
// (min(w,h)/1080) so previews match full renders. Every random choice comes
// from the seed.

import { P } from '../params';
import type { GeneratorDef, NodeInfo } from '../nodes';
import { REEL_PALETTE as C } from '../palette';
import { rng, toCss } from '../util';

type Ctx = OffscreenCanvasRenderingContext2D;
type R = () => number;

const pick = <T,>(r: R, a: T[]): T => a[Math.floor(r() * a.length) % a.length];

/** A jagged rectangle path (torn paper). */
export function tornRect(ctx: Ctx, x: number, y: number, w: number, h: number, rough: number, r: R, step = 7) {
  ctx.beginPath();
  const pts: [number, number][] = [];
  for (let t = 0; t <= w; t += step) pts.push([x + t, y + (r() - 0.5) * rough]);
  for (let t = 0; t <= h; t += step) pts.push([x + w + (r() - 0.5) * rough, y + t]);
  for (let t = w; t >= 0; t -= step) pts.push([x + t, y + h + (r() - 0.5) * rough]);
  for (let t = h; t >= 0; t -= step) pts.push([x + (r() - 0.5) * rough, y + t]);
  pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
  ctx.closePath();
}

// ---------------------------------------------------------------- porcelain

function petal(ctx: Ctx, r: R, cx: number, cy: number, ang: number, len: number, wid: number, brush: number, fill: string, line: string) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const P2 = (u: number, v: number): [number, number] => [cx + ca * u - sa * v, cy + sa * u + ca * v];
  ctx.beginPath();
  ctx.moveTo(...P2(0, 0));
  ctx.bezierCurveTo(...P2(len * 0.2, -wid * 1.1), ...P2(len * 0.75, -wid * 1.0), ...P2(len * 0.95, -wid * 0.35));
  // scalloped tip
  const sc = 3 + Math.floor(r() * 3);
  for (let k = 0; k < sc; k++) {
    const v0 = -wid * 0.35 + (wid * 0.7 * (k + 0.5)) / sc, v1 = -wid * 0.35 + (wid * 0.7 * (k + 1)) / sc;
    ctx.quadraticCurveTo(...P2(len * (1.05 + r() * 0.08), v0), ...P2(len * 0.95, v1));
  }
  ctx.bezierCurveTo(...P2(len * 0.75, wid * 1.0), ...P2(len * 0.2, wid * 1.1), ...P2(0, 0));
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = line; ctx.lineWidth = brush; ctx.stroke();
  // veins
  ctx.lineWidth = brush * 0.5;
  for (let k = 0; k < 3; k++) {
    const v = (k - 1) * wid * 0.35;
    ctx.beginPath(); ctx.moveTo(...P2(len * 0.15, v * 0.3)); ctx.quadraticCurveTo(...P2(len * 0.5, v * 1.1), ...P2(len * (0.65 + r() * 0.15), v * 0.9)); ctx.stroke();
  }
}

function peony(ctx: Ctx, r: R, cx: number, cy: number, R0: number, brush: number) {
  const rings = 3;
  for (let ring = 0; ring < rings; ring++) {
    const n = 7 - ring, len = R0 * (1 - ring * 0.27), wid = len * 0.42;
    const fill = ring === 0 ? C.wash : ring === 1 ? C.cobalt : C.cobaltDeep;
    const off = r() * Math.PI;
    for (let k = 0; k < n; k++) {
      const a = off + (k / n) * Math.PI * 2 + (r() - 0.5) * 0.3;
      ctx.globalAlpha = 0.85 + r() * 0.15;
      petal(ctx, r, cx, cy, a, len * (0.85 + r() * 0.25), wid, brush, fill, C.cobaltDeep);
    }
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.porcelain; ctx.beginPath(); ctx.arc(cx, cy, R0 * 0.16, 0, 7); ctx.fill();
  ctx.fillStyle = C.cobaltDeep;
  for (let k = 0; k < 9; k++) { const a = r() * 7, d = r() * R0 * 0.14; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, R0 * 0.035, 0, 7); ctx.fill(); }
}

function leaf(ctx: Ctx, r: R, x: number, y: number, ang: number, len: number, brush: number) {
  const ca = Math.cos(ang), sa = Math.sin(ang), w = len * 0.28;
  const P2 = (u: number, v: number): [number, number] => [x + ca * u - sa * v, y + sa * u + ca * v];
  ctx.beginPath(); ctx.moveTo(...P2(0, 0));
  ctx.quadraticCurveTo(...P2(len * 0.45, -w * (1 + r() * 0.4)), ...P2(len, 0));
  ctx.quadraticCurveTo(...P2(len * 0.45, w * (1 + r() * 0.4)), ...P2(0, 0));
  ctx.fillStyle = r() < 0.5 ? C.cobalt : C.cobaltDeep; ctx.fill();
  ctx.strokeStyle = C.porcelain; ctx.lineWidth = brush * 0.6;
  ctx.beginPath(); ctx.moveTo(...P2(len * 0.08, 0)); ctx.lineTo(...P2(len * 0.85, 0)); ctx.stroke();
}

function scroll(ctx: Ctx, r: R, x: number, y: number, size: number, brush: number) {
  // a vine that ends in a curl (a log spiral), with small leaves on the way
  ctx.strokeStyle = C.cobalt; ctx.lineWidth = brush * 1.3; ctx.lineCap = 'round';
  let a = r() * Math.PI * 2, px = x, py = y;
  ctx.beginPath(); ctx.moveTo(px, py);
  const steps = 26;
  for (let i = 0; i < steps; i++) {
    a += 0.18 + (i / steps) * 0.45 * (r() < 0.5 ? 1 : 1.2);
    const s = size * 0.09 * (1 - i / steps * 0.8);
    px += Math.cos(a) * s; py += Math.sin(a) * s;
    ctx.lineTo(px, py);
  }
  ctx.stroke();
  for (let i = 0; i < 3; i++) leaf(ctx, r, x + (r() - 0.5) * size * 0.6, y + (r() - 0.5) * size * 0.6, r() * 7, size * 0.25, brush);
}

function rimBand(ctx: Ctx, r: R, y: number, w: number, h: number, brush: number) {
  ctx.fillStyle = C.porcelain; ctx.fillRect(0, y, w, h);
  ctx.strokeStyle = C.cobaltDeep; ctx.lineWidth = brush * 1.4;
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.moveTo(0, y + h); ctx.lineTo(w, y + h); ctx.stroke();
  const kind = Math.floor(r() * 3);
  const step = h * 1.1;
  ctx.fillStyle = C.cobalt; ctx.lineWidth = brush;
  for (let x = -step; x < w + step; x += step) {
    if (kind === 0) { // scallops (ruyi-like)
      ctx.beginPath(); ctx.arc(x + step / 2, y + h * 0.15, step * 0.42, 0, Math.PI); ctx.fill(); ctx.stroke();
    } else if (kind === 1) { // key fret
      const u = h / 5; ctx.beginPath();
      ctx.moveTo(x, y + h - u); ctx.lineTo(x, y + u); ctx.lineTo(x + step * 0.7, y + u); ctx.lineTo(x + step * 0.7, y + h * 0.6); ctx.lineTo(x + step * 0.3, y + h * 0.6); ctx.lineTo(x + step * 0.3, y + h * 0.4);
      ctx.stroke();
    } else { // waves
      ctx.beginPath(); ctx.moveTo(x, y + h * 0.75); ctx.quadraticCurveTo(x + step * 0.25, y + h * 0.1, x + step * 0.5, y + h * 0.5); ctx.quadraticCurveTo(x + step * 0.6, y + h * 0.8, x + step * 0.45, y + h * 0.65); ctx.stroke();
    }
  }
}

export const porcelain: GeneratorDef = {
  id: 'porcelain',
  name: 'Porcelain',
  description: 'Blue-and-white china: peonies, leaves, scroll vines and rim bands in cobalt brushwork (ref 02).',
  live: false,
  params: [
    P.float('density', 0.5, 0, 1),
    P.px('size', 120, 20, 500, { description: 'Flower radius.' }),
    P.px('brush', 3, 0.5, 14),
    P.int('bands', 2, 0, 8, { description: 'Decorative rim bands.' }),
    P.float('scrolls', 0.6, 0, 1),
    P.bool('ground', true, { description: 'Paint the porcelain ground (off = transparent).' }),
  ],
  draw: (ctx, info, v) => {
    const { w, h, unit } = info, r = rng(info.seed);
    if (v.ground) {
      ctx.fillStyle = C.porcelain; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 6; i++) {
        const g = ctx.createRadialGradient(r() * w, r() * h, 0, r() * w, r() * h, (200 + r() * 500) * unit);
        g.addColorStop(0, 'rgba(216,209,186,0.35)'); g.addColorStop(1, 'rgba(216,209,186,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
    }
    const size = v.size * unit, brush = v.brush * unit;
    const cell = size * (3.2 - v.density * 2.2);
    for (let gy = -cell * 0.5; gy < h + cell; gy += cell) for (let gx = -cell * 0.5; gx < w + cell; gx += cell) {
      const x = gx + (r() - 0.5) * cell * 0.8, y = gy + (r() - 0.5) * cell * 0.8;
      if (r() < v.scrolls) scroll(ctx, r, x + cell * 0.4, y + cell * 0.3, size * 1.6, brush);
      for (let k = 0; k < 3; k++) leaf(ctx, r, x, y, r() * 7, size * (0.6 + r() * 0.5), brush);
      peony(ctx, r, x, y, size * (0.7 + r() * 0.5), brush);
    }
    for (let i = 0; i < v.bands; i++) rimBand(ctx, r, r() * h, w, (30 + r() * 40) * unit, brush);
  },
};

// ---------------------------------------------------------------- signage

const WORDS = ['RAMEN', '24H', 'SALE', 'KARAOKE', 'OPEN', 'BAR', 'CAFE', 'LOANS', '2F', '3F', 'B1', 'MEDS', 'NEW', 'HOTEL', 'GAME', 'CASH', 'NOODLE', 'DRUG', 'EXIT', 'PARKING', '¥980', 'NO.1', 'FOOD', 'LIVE'];
const SIGN_COLS = ['#E8E1C9', '#C8352B', '#F2C230', '#FFFFFF', '#1B2FD6', '#2B2B2B', '#E46A1C', '#3E8E5A', '#F0F0EC', '#0A126E'];

/** A made-up, kanji-like glyph from a few strokes (never a real word). */
function pseudoGlyph(ctx: Ctx, r: R, x: number, y: number, s: number) {
  ctx.lineWidth = Math.max(1, s * 0.11); ctx.lineCap = 'square';
  ctx.beginPath();
  const n = 3 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const t = Math.floor(r() * 5);
    const a = 0.1 + r() * 0.3, b = 0.6 + r() * 0.3, c = 0.15 + r() * 0.7;
    if (t === 0) { ctx.moveTo(x + s * a, y + s * c); ctx.lineTo(x + s * b, y + s * c); }
    else if (t === 1) { ctx.moveTo(x + s * c, y + s * a); ctx.lineTo(x + s * c, y + s * b); }
    else if (t === 2) { ctx.rect(x + s * a, y + s * a, s * (b - a), s * (b - a) * 0.6); }
    else if (t === 3) { ctx.moveTo(x + s * b, y + s * a); ctx.lineTo(x + s * a, y + s * b); }
    else { ctx.moveTo(x + s * a, y + s * a); ctx.lineTo(x + s * c, y + s * b); }
  }
  ctx.stroke();
}

function board(ctx: Ctx, r: R, x: number, y: number, bw: number, bh: number, vertical: boolean, v: Record<string, any>, unit: number) {
  const col = pick(r, SIGN_COLS);
  const light = ['#E8E1C9', '#F2C230', '#FFFFFF', '#F0F0EC'].includes(col);
  const ink = light ? pick(r, ['#C8352B', '#06070C', '#1B2FD6']) : pick(r, ['#FFFFFF', '#F2C230', '#F0F0EC']);
  ctx.fillStyle = col; ctx.fillRect(x, y, bw, bh);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 2 * unit; ctx.strokeRect(x, y, bw, bh);
  if (r() < 0.35) { ctx.strokeStyle = ink; ctx.lineWidth = 2 * unit; ctx.strokeRect(x + 5 * unit, y + 5 * unit, bw - 10 * unit, bh - 10 * unit); }
  ctx.fillStyle = ink; ctx.strokeStyle = ink;
  const glyphs = r() < v.glyphs;
  if (vertical) {
    const s = bw * 0.68, n = Math.floor((bh - bw * 0.3) / (s * 1.08));
    const word = pick(r, WORDS);
    for (let k = 0; k < n; k++) {
      const gx = x + (bw - s) / 2, gy = y + bw * 0.15 + k * s * 1.08;
      if (glyphs) pseudoGlyph(ctx, r, gx, gy, s);
      else { ctx.font = `700 ${Math.round(s)}px "IBM Plex Mono"`; ctx.textBaseline = 'top'; ctx.fillText(word[k % word.length], gx + s * 0.15, gy); }
    }
  } else {
    const s = bh * 0.62;
    if (glyphs) { const n = Math.floor((bw - bh * 0.3) / (s * 1.08)); for (let k = 0; k < n; k++) pseudoGlyph(ctx, r, x + bh * 0.2 + k * s * 1.08, y + (bh - s) / 2, s); }
    else { ctx.font = `700 ${Math.round(s)}px "IBM Plex Mono"`; ctx.textBaseline = 'middle'; ctx.fillText(pick(r, WORDS), x + bh * 0.25, y + bh / 2, bw - bh * 0.4); }
  }
  // bulbs along the edge on some boards
  if (r() < 0.2) { ctx.fillStyle = '#FFF4C2'; const step = 14 * unit; for (let t = step / 2; t < bw; t += step) { ctx.beginPath(); ctx.arc(x + t, y + 3 * unit, 2.2 * unit, 0, 7); ctx.arc(x + t, y + bh - 3 * unit, 2.2 * unit, 0, 7); ctx.fill(); } }
  // wear: scratches, grime, peeled corner
  if (v.wear > 0) {
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, bw, bh); ctx.clip();
    const g = ctx.createLinearGradient(0, y, 0, y + bh); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(20,16,10,${0.35 * v.wear})`);
    ctx.fillStyle = g; ctx.fillRect(x, y, bw, bh);
    ctx.strokeStyle = `rgba(255,255,255,${0.25 * v.wear})`; ctx.lineWidth = unit;
    for (let i = 0; i < 6 * v.wear; i++) { const sx = x + r() * bw, sy = y + r() * bh; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + (r() - 0.5) * 40 * unit, sy + (r() - 0.5) * 12 * unit); ctx.stroke(); }
    if (r() < v.wear * 0.5) { ctx.fillStyle = 'rgba(240,240,236,0.9)'; ctx.beginPath(); ctx.moveTo(x + bw, y); ctx.lineTo(x + bw - 18 * unit * (1 + r()), y); ctx.lineTo(x + bw, y + 22 * unit * (1 + r())); ctx.fill(); }
    ctx.restore();
  }
}

export const signage: GeneratorDef = {
  id: 'signage',
  name: 'Signage',
  description: 'Dense stacked shop signs on building strips, vertical and horizontal, with wear (ref 01 street). Generated, never photographed.',
  live: false,
  params: [
    P.enum('ground', 'street', ['street', 'sky', 'paper', 'transparent']),
    P.px('column', 110, 30, 400, { description: 'Width of a building strip.' }),
    P.float('density', 0.75, 0, 1),
    P.float('vertical', 0.55, 0, 1, { description: 'Share of tall vertical boards.' }),
    P.float('glyphs', 0.45, 0, 1, { description: 'Share of boards with made-up glyphs instead of words.' }),
    P.float('wear', 0.6, 0, 1),
    P.float('top', 0.04, 0, 1),
    P.float('bottom', 0.9, 0, 1),
  ],
  draw: (ctx, info, v) => {
    const { w, h, unit } = info, r = rng(info.seed);
    if (v.ground !== 'transparent') {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      if (v.ground === 'paper') { g.addColorStop(0, C.porcelain); g.addColorStop(1, '#E4E0D6'); }
      else if (v.ground === 'sky') { g.addColorStop(0, '#8FB7E8'); g.addColorStop(0.55, '#C9D6E2'); g.addColorStop(1, '#5B5F66'); }
      else { g.addColorStop(0, '#9AA6B4'); g.addColorStop(0.3, '#4A4F57'); g.addColorStop(1, '#23262B'); }
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    const colW = v.column * unit, y0 = v.top * h, y1 = v.bottom * h;
    for (let x = -colW * 0.3; x < w; x += colW * (0.7 + r() * 0.6)) {
      // the building strip with windows
      if (v.ground === 'street') {
        ctx.fillStyle = pick(r, ['#5A5E66', '#6E727A', '#4B4E55', '#7D7466']); ctx.fillRect(x, y0 - 40 * unit, colW, h);
        ctx.fillStyle = 'rgba(20,24,30,0.55)';
        for (let wy = y0; wy < h; wy += 46 * unit) for (let wx = x + 8 * unit; wx < x + colW - 16 * unit; wx += 26 * unit) ctx.fillRect(wx, wy, 16 * unit, 28 * unit);
      }
      let y = y0 + r() * 60 * unit;
      while (y < y1) {
        if (r() > v.density) { y += 40 * unit; continue; }
        const vert = r() < v.vertical;
        const bw = vert ? colW * (0.3 + r() * 0.35) : colW * (0.8 + r() * 0.9);
        const bh = vert ? (140 + r() * 320) * unit : (36 + r() * 70) * unit;
        const bx = vert ? x + r() * (colW - bw) : x - r() * colW * 0.2;
        board(ctx, r, bx, y, bw, Math.min(bh, y1 - y + 30 * unit), vert, v, unit);
        if (vert && r() < 0.6) { const bw2 = colW * (0.25 + r() * 0.3); board(ctx, r, bx + bw + 4 * unit, y + r() * 40 * unit, bw2, bh * (0.6 + r() * 0.5), true, v, unit); }
        y += (vert ? bh * (0.5 + r() * 0.5) : bh) + r() * 18 * unit;
      }
    }
    // overhead banners across strips
    for (let i = 0; i < 3 * v.density; i++) board(ctx, r, r() * w * 0.7, y0 + r() * (y1 - y0), (200 + r() * 400) * unit, (40 + r() * 50) * unit, false, v, unit);
  },
};

// ---------------------------------------------------------------- UI chrome

const UI_LINES = [
  'subject.exe is not responding', 'inference: appetite 0.82', 'compliance check ... ok', 'restart feed?',
  'loading preferences', 'face_mesh: 478 pts', 'segment MIRROR +0.14', 'watch time 00:02:41', 'like registered',
  'model confidence 91%', 'you stopped scrolling', 'retention: high', 'serving next reel', 'desire 0.67 ↑',
  'calibrating subject', 'ledger updated', 'do not look away', 'profile 63% complete',
];

function bevel(ctx: Ctx, x: number, y: number, w: number, h: number, u: number, inset = false) {
  const lt = inset ? C.ink : C.porcelain, dk = inset ? C.porcelain : C.ink;
  ctx.fillStyle = lt; ctx.fillRect(x, y, w, u); ctx.fillRect(x, y, u, h);
  ctx.fillStyle = dk; ctx.fillRect(x, y + h - u, w, u); ctx.fillRect(x + w - u, y, u, h);
  ctx.fillStyle = C.cable; ctx.fillRect(x + u, y + h - 2 * u, w - 2 * u, u); ctx.fillRect(x + w - 2 * u, y + u, u, h - 2 * u);
}

export function titleBar(ctx: Ctx, x: number, y: number, w: number, h: number, title: string, u: number, fill = C.cobalt) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, C.cobaltDeep); g.addColorStop(1, fill);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  const b = h * 0.7, by = y + (h - b) / 2;
  for (let i = 0; i < 3; i++) {
    const bx = x + w - (i + 1) * (b + 3 * u) - 2 * u;
    ctx.fillStyle = C.bone; ctx.fillRect(bx, by, b, b); bevel(ctx, bx, by, b, b, Math.max(1, u));
    ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1, 1.6 * u); ctx.beginPath();
    if (i === 0) { ctx.moveTo(bx + b * 0.28, by + b * 0.28); ctx.lineTo(bx + b * 0.72, by + b * 0.72); ctx.moveTo(bx + b * 0.72, by + b * 0.28); ctx.lineTo(bx + b * 0.28, by + b * 0.72); }
    else if (i === 1) ctx.strokeRect(bx + b * 0.25, by + b * 0.25, b * 0.5, b * 0.45);
    else { ctx.moveTo(bx + b * 0.25, by + b * 0.7); ctx.lineTo(bx + b * 0.6, by + b * 0.7); }
    ctx.stroke();
  }
  ctx.fillStyle = C.porcelain; ctx.font = `${Math.round(h * 0.86)}px "VT323"`; ctx.textBaseline = 'middle';
  ctx.fillText(title, x + h * 0.35, y + h / 2 + u, w - h * 3.2);
}

function uiWindow(ctx: Ctx, r: R, kind: string, x: number, y: number, w: number, h: number, u: number, lines: string[], v: Record<string, any>) {
  const th = 22 * u * v.scale;
  ctx.save();
  if (v.tear > 0 && r() < 0.7) { tornRect(ctx, x, y, w, h, v.tear * 18 * u, r, 6 * u); ctx.clip(); }
  // shadow
  ctx.fillStyle = 'rgba(6,7,12,0.55)'; ctx.fillRect(x + 6 * u, y + 6 * u, w, h);
  ctx.fillStyle = C.bone; ctx.fillRect(x, y, w, h); bevel(ctx, x, y, w, h, Math.max(1, 1.5 * u));
  const pad = 4 * u;
  const title = kind === 'terminal' ? pick(r, ['subject.exe', 'eye.log', 'C:\\FEED', 'terminal']) : kind === 'error' ? 'error' : kind === 'progress' ? 'profiling' : pick(r, ['notice', 'compliance', 'feed', 'consent']);
  titleBar(ctx, x + pad, y + pad, w - 2 * pad, th, title, u);
  const cx = x + pad, cy = y + pad + th + pad, cw = w - 2 * pad, ch = h - th - 3 * pad;
  const fs = 15 * u * v.scale;
  if (kind === 'terminal' || kind === 'log') {
    const dark = kind === 'terminal';
    ctx.fillStyle = dark ? C.ink : C.porcelain; ctx.fillRect(cx, cy, cw, ch); bevel(ctx, cx, cy, cw, ch, Math.max(1, u), true);
    ctx.fillStyle = dark ? C.porcelain : C.ink; ctx.font = `${Math.round(fs)}px "IBM Plex Mono"`; ctx.textBaseline = 'top';
    let ly = cy + 5 * u, i = Math.floor(r() * lines.length);
    while (ly < cy + ch - fs) { ctx.fillText((dark ? '> ' : '') + lines[i++ % lines.length], cx + 6 * u, ly, cw - 12 * u); ly += fs * 1.3; }
    if (dark) { ctx.fillStyle = C.wash; ctx.fillRect(cx + 6 * u, Math.min(ly, cy + ch - fs - 4 * u), fs * 0.6, fs); }
  } else if (kind === 'progress') {
    ctx.fillStyle = C.ink; ctx.font = `${Math.round(fs)}px "Courier Prime"`; ctx.textBaseline = 'top';
    ctx.fillText(pick(r, lines), cx + 8 * u, cy + 8 * u, cw - 16 * u);
    const by = cy + 14 * u + fs, bh = Math.min(26 * u, ch - (by - cy) - 8 * u);
    ctx.fillStyle = C.porcelain; ctx.fillRect(cx + 8 * u, by, cw - 16 * u, bh); bevel(ctx, cx + 8 * u, by, cw - 16 * u, bh, Math.max(1, u), true);
    const p = 0.2 + r() * 0.75, bs = bh * 0.7;
    ctx.fillStyle = C.cobalt;
    for (let bx = cx + 11 * u; bx < cx + 8 * u + (cw - 16 * u) * p; bx += bs + 2 * u) ctx.fillRect(bx, by + 3 * u, bs, bh - 6 * u);
  } else { // dialog / error
    const ir = Math.min(ch * 0.25, 22 * u * v.scale), ix = cx + 14 * u + ir, iy = cy + 14 * u + ir;
    ctx.fillStyle = kind === 'error' ? C.ink : C.cobalt; ctx.beginPath(); ctx.arc(ix, iy, ir, 0, 7); ctx.fill();
    ctx.fillStyle = C.porcelain; ctx.font = `700 ${Math.round(ir * 1.4)}px "Courier Prime"`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(kind === 'error' ? '×' : '!', ix, iy + u); ctx.textAlign = 'left';
    ctx.fillStyle = C.ink; ctx.font = `${Math.round(fs)}px "Courier Prime"`; ctx.textBaseline = 'top';
    let ly = cy + 10 * u; for (let k = 0; k < 3 && ly < cy + ch - fs * 3; k++) { ctx.fillText(pick(r, lines), ix + ir + 14 * u, ly, cw - ir * 2 - 40 * u); ly += fs * 1.35; }
    const bw = 76 * u * v.scale, bh = 24 * u * v.scale, by = cy + ch - bh - 8 * u;
    ['OK', 'CANCEL'].forEach((t, k) => {
      const bx = cx + cw - (k + 1) * (bw + 8 * u);
      if (bx < cx) return;
      ctx.fillStyle = C.bone; ctx.fillRect(bx, by, bw, bh); bevel(ctx, bx, by, bw, bh, Math.max(1, 1.5 * u));
      ctx.fillStyle = C.ink; ctx.font = `${Math.round(bh * 0.6)}px "Courier Prime"`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText(t, bx + bw / 2, by + bh / 2 + u); ctx.textAlign = 'left';
    });
  }
  ctx.restore();
}

function cursor(ctx: Ctx, x: number, y: number, s: number) {
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + s); ctx.lineTo(x + s * 0.28, y + s * 0.75); ctx.lineTo(x + s * 0.48, y + s * 1.15); ctx.lineTo(x + s * 0.6, y + s * 1.1); ctx.lineTo(x + s * 0.4, y + s * 0.7); ctx.lineTo(x + s * 0.72, y + s * 0.7); ctx.closePath();
  ctx.fillStyle = C.porcelain; ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = s * 0.06; ctx.stroke();
}

export const uiChrome: GeneratorDef = {
  id: 'uiChrome',
  name: 'UI chrome',
  description: 'Original 1990s-spirited windows: terminals, logs, dialogs, errors, progress bars and cursors, torn and cascaded.',
  live: false,
  params: [
    P.int('count', 5, 0, 30),
    P.strings('kinds', ['terminal', 'log', 'dialog', 'progress', 'error']),
    P.float('scale', 1, 0.4, 3),
    P.rect('region', [0.05, 0.05, 0.9, 0.9]),
    P.px('minWidth', 280, 60, 1600),
    P.px('maxWidth', 560, 60, 2000),
    P.float('cascade', 0.3, 0, 1, { description: 'Stack windows in an offset cascade.' }),
    P.float('tear', 0.3, 0, 1),
    P.int('cursors', 1, 0, 10),
    P.strings('lines', UI_LINES),
  ],
  draw: (ctx, info, v) => {
    const { w, h, unit: u } = info, r = rng(info.seed);
    const kinds = (v.kinds as string[]).length ? v.kinds : ['terminal'];
    const lines = (v.lines as string[]).length ? v.lines : UI_LINES;
    const [rx, ry, rw, rh] = v.region as number[];
    let cxp = (rx + r() * rw * 0.5) * w, cyp = (ry + r() * rh * 0.5) * h;
    for (let i = 0; i < v.count; i++) {
      const ww = (v.minWidth + r() * (v.maxWidth - v.minWidth)) * u * v.scale;
      const wh = ww * (0.45 + r() * 0.4);
      let x: number, y: number;
      if (r() < v.cascade) { x = cxp; y = cyp; cxp += 26 * u * v.scale; cyp += 30 * u * v.scale; }
      else { x = (rx + r() * rw) * w - ww * 0.3; y = (ry + r() * rh) * h - wh * 0.3; }
      uiWindow(ctx, r, pick(r, kinds), x, y, ww, wh, u, lines, v);
    }
    for (let i = 0; i < v.cursors; i++) cursor(ctx, (rx + r() * rw) * w, (ry + r() * rh) * h, 26 * u * v.scale);
  },
};

// ---------------------------------------------------------------- road paint, hazard, text column

export const roadPaint: GeneratorDef = {
  id: 'roadPaint',
  name: 'Road paint',
  description: 'Cobalt road with fat, worn white strokes (ref 01 foreground).',
  live: false,
  params: [P.color('road', '#1B2FD6'), P.color('paint', '#F0F0EC'), P.int('strokes', 5, 0, 20), P.px('width', 70, 5, 400), P.float('wear', 0.5, 0, 1)],
  draw: (ctx, info, v) => {
    const { w, h, unit } = info, r = rng(info.seed);
    ctx.fillStyle = toCss(v.road); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = toCss(v.paint);
    for (let i = 0; i < v.strokes; i++) {
      const bx = r() * w, sw = v.width * unit * (0.6 + r() * 0.8), bend = (r() - 0.5) * w * 0.4;
      ctx.beginPath(); ctx.moveTo(bx, h);
      ctx.bezierCurveTo(bx + bend, h * 0.6, bx - bend * 0.6, h * 0.3, bx + bend * 0.3, 0);
      ctx.lineTo(bx + bend * 0.3 + sw, 0);
      ctx.bezierCurveTo(bx - bend * 0.6 + sw, h * 0.3, bx + bend + sw, h * 0.6, bx + sw * 1.6, h);
      ctx.closePath(); ctx.fill();
    }
    for (let i = 0; i < 9000 * v.wear; i++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(10,18,110,0.35)' : 'rgba(255,255,255,0.12)';
      const s = (1 + r() * 4) * unit; ctx.fillRect(r() * w, r() * h, s, s);
    }
  },
};

export const hazard: GeneratorDef = {
  id: 'hazard',
  name: 'Hazard stripes',
  description: 'Barrier stripes, safety orange and white by default.',
  live: false,
  params: [P.color('a', '#FF6A1A'), P.color('b', '#F0F0EC'), P.px('stripe', 40, 4, 400), P.deg('angle', 45), P.float('wear', 0.3, 0, 1)],
  draw: (ctx, info, v) => {
    const { w, h, unit } = info, r = rng(info.seed);
    ctx.fillStyle = toCss(v.a); ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate((v.angle * Math.PI) / 180);
    const D = Math.hypot(w, h), s = v.stripe * unit;
    ctx.fillStyle = toCss(v.b);
    for (let x = -D; x < D; x += s * 2) ctx.fillRect(x, -D, s, D * 2);
    ctx.restore();
    for (let i = 0; i < 3000 * v.wear; i++) { ctx.fillStyle = 'rgba(30,20,10,0.25)'; const s2 = (1 + r() * 5) * unit; ctx.fillRect(r() * w, r() * h, s2, s2 * 0.6); }
  },
};

const LOREM = 'the feed learns what you hold your eyes on and serves it back a little stronger each time you stay a second longer the model counts every pause every replay every like it writes them into a ledger you never see and rebuilds a face from what you could not stop watching';

export const textColumn: GeneratorDef = {
  id: 'textColumn',
  name: 'Text column',
  description: 'Dense justified type bleeding in from an edge (ref 01 margins).',
  live: false,
  params: [
    P.string('text', LOREM),
    P.enum('font', 'IBM Plex Mono', ['IBM Plex Mono', 'Courier Prime', 'VT323']),
    P.px('size', 18, 4, 200),
    P.float('leading', 1.2, 0.8, 3),
    P.color('color', '#06070C'),
    P.rect('area', [0.68, 0.45, 0.4, 0.3]),
    P.deg('rotation', 0),
    P.enum('align', 'justify', ['left', 'right', 'justify']),
    P.bool('bold', false),
  ],
  draw: (ctx, info, v) => {
    const { w, h, unit } = info;
    const [ax, ay, aw, ah] = v.area as number[];
    const x = ax * w, y = ay * h, cw = aw * w, ch = ah * h, size = v.size * unit;
    ctx.save();
    ctx.translate(x, y); ctx.rotate((v.rotation * Math.PI) / 180);
    ctx.font = `${v.bold ? 700 : 400} ${Math.round(size)}px "${v.font}"`; ctx.fillStyle = toCss(v.color); ctx.textBaseline = 'top';
    const words = String(v.text).split(/\s+/).filter(Boolean);
    if (!words.length) { ctx.restore(); return; }
    let wi = 0, yy = 0;
    while (yy < ch) {
      const line: string[] = [];
      while (true) {
        const word = words[wi % words.length];
        if (line.length && ctx.measureText([...line, word].join(' ')).width > cw) break;
        line.push(word); wi++;
        if (line.length > 200) break;
      }
      if (v.align === 'justify' && line.length > 1) {
        const tw = line.reduce((s, wd) => s + ctx.measureText(wd).width, 0), gap = (cw - tw) / (line.length - 1);
        let xx = 0; for (const wd of line) { ctx.fillText(wd, xx, yy); xx += ctx.measureText(wd).width + gap; }
      } else {
        const s = line.join(' '), tw = ctx.measureText(s).width;
        ctx.fillText(s, v.align === 'right' ? cw - tw : 0, yy);
      }
      yy += size * v.leading;
    }
    ctx.restore();
  },
};

export type { NodeInfo };
