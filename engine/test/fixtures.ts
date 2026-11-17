// Standard test inputs, all drawn in code: blank, flat grey, gradient and a
// synthetic face. (A licensed photo / Charlie's own test face can be added
// to this list once chosen.)

export type FixtureName = 'blank' | 'grey' | 'gradient' | 'face';
export const FIXTURES: FixtureName[] = ['blank', 'grey', 'gradient', 'face'];

export function fixture(name: FixtureName, w: number, h: number): OffscreenCanvas | null {
  if (name === 'blank') return null;
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d')!;
  if (name === 'grey') { x.fillStyle = '#808080'; x.fillRect(0, 0, w, h); return c; }
  if (name === 'gradient') {
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#202326'); g.addColorStop(1, '#D9D6CC');
    x.fillStyle = g; x.fillRect(0, 0, w, h); return c;
  }
  return syntheticFace(c, w, h);
}

/** A plain, procedurally drawn head-and-shoulders portrait, used as a stand-in face. */
export function syntheticFace(c: OffscreenCanvas, w: number, h: number) {
  const x = c.getContext('2d')!, u = Math.min(w, h) / 1080;
  const cx = w / 2, cy = h * 0.4, fw = 260 * u, fh = 340 * u;
  const wall = x.createLinearGradient(0, 0, 0, h); wall.addColorStop(0, '#8C8F8A'); wall.addColorStop(1, '#5E615D');
  x.fillStyle = wall; x.fillRect(0, 0, w, h);
  // shoulders and shirt
  x.fillStyle = '#C9CDD2';
  x.beginPath(); x.moveTo(cx - 520 * u, h); x.bezierCurveTo(cx - 500 * u, cy + 420 * u, cx - 260 * u, cy + 330 * u, cx, cy + 330 * u);
  x.bezierCurveTo(cx + 260 * u, cy + 330 * u, cx + 500 * u, cy + 420 * u, cx + 520 * u, h); x.fill();
  x.strokeStyle = '#9EA3A9'; x.lineWidth = 6 * u;
  for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(cx - 300 * u + i * 110 * u, cy + 420 * u); x.quadraticCurveTo(cx - 280 * u + i * 110 * u, cy + 700 * u, cx - 330 * u + i * 120 * u, h); x.stroke(); }
  // neck
  const skin = x.createLinearGradient(cx - fw, 0, cx + fw, 0); skin.addColorStop(0, '#9C6F55'); skin.addColorStop(0.45, '#D9A88A'); skin.addColorStop(1, '#8A5E47');
  x.fillStyle = skin; x.fillRect(cx - 95 * u, cy + 200 * u, 190 * u, 170 * u);
  x.fillStyle = 'rgba(60,30,20,0.35)'; x.fillRect(cx - 95 * u, cy + 220 * u, 190 * u, 40 * u);
  // head
  x.fillStyle = skin; x.beginPath(); x.ellipse(cx, cy, fw, fh, 0, 0, Math.PI * 2); x.fill();
  const shade = x.createRadialGradient(cx - 70 * u, cy - 90 * u, 40 * u, cx, cy, fh * 1.1); shade.addColorStop(0, 'rgba(255,230,210,0.35)'); shade.addColorStop(1, 'rgba(40,20,10,0.45)');
  x.fillStyle = shade; x.beginPath(); x.ellipse(cx, cy, fw, fh, 0, 0, Math.PI * 2); x.fill();
  // ears
  x.fillStyle = '#B98066'; for (const s of [-1, 1]) { x.beginPath(); x.ellipse(cx + s * fw * 0.98, cy + 10 * u, 34 * u, 62 * u, 0, 0, 7); x.fill(); }
  // hair
  x.fillStyle = '#1E1814'; x.beginPath(); x.ellipse(cx, cy - fh * 0.55, fw * 1.07, fh * 0.6, 0, Math.PI, Math.PI * 2); x.fill();
  x.beginPath(); x.moveTo(cx - fw * 1.05, cy - fh * 0.5); x.quadraticCurveTo(cx - fw * 0.4, cy - fh * 0.75, cx + fw * 0.2, cy - fh * 0.48); x.quadraticCurveTo(cx + fw * 0.8, cy - fh * 0.7, cx + fw * 1.05, cy - fh * 0.4); x.lineTo(cx + fw, cy - fh * 0.9); x.lineTo(cx - fw, cy - fh * 0.9); x.fill();
  // brows, eyes
  for (const s of [-1, 1]) {
    const ex = cx + s * 100 * u, ey = cy - 30 * u;
    x.strokeStyle = '#2A1E17'; x.lineWidth = 14 * u; x.lineCap = 'round';
    x.beginPath(); x.moveTo(ex - 55 * u, ey - 52 * u + (s > 0 ? 6 : 0) * u); x.quadraticCurveTo(ex, ey - 72 * u, ex + 55 * u, ey - 50 * u); x.stroke();
    x.fillStyle = '#EDE6DF'; x.beginPath(); x.ellipse(ex, ey, 46 * u, 21 * u, 0, 0, 7); x.fill();
    x.fillStyle = '#4A3526'; x.beginPath(); x.arc(ex + 4 * u, ey, 17 * u, 0, 7); x.fill();
    x.fillStyle = '#0B0807'; x.beginPath(); x.arc(ex + 4 * u, ey, 8 * u, 0, 7); x.fill();
    x.fillStyle = '#fff'; x.beginPath(); x.arc(ex + 9 * u, ey - 6 * u, 4 * u, 0, 7); x.fill();
    x.strokeStyle = 'rgba(60,30,20,0.6)'; x.lineWidth = 4 * u; x.beginPath(); x.ellipse(ex, ey, 48 * u, 23 * u, 0, Math.PI, Math.PI * 2); x.stroke();
  }
  // nose
  x.strokeStyle = 'rgba(90,50,35,0.7)'; x.lineWidth = 7 * u;
  x.beginPath(); x.moveTo(cx - 8 * u, cy - 10 * u); x.quadraticCurveTo(cx - 30 * u, cy + 80 * u, cx - 35 * u, cy + 95 * u); x.quadraticCurveTo(cx, cy + 115 * u, cx + 35 * u, cy + 95 * u); x.stroke();
  // mouth
  x.fillStyle = '#9A4A45'; x.beginPath(); x.moveTo(cx - 70 * u, cy + 175 * u); x.quadraticCurveTo(cx, cy + 150 * u, cx + 70 * u, cy + 175 * u); x.quadraticCurveTo(cx, cy + 215 * u, cx - 70 * u, cy + 175 * u); x.fill();
  x.strokeStyle = '#5A2522'; x.lineWidth = 4 * u; x.beginPath(); x.moveTo(cx - 70 * u, cy + 175 * u); x.quadraticCurveTo(cx, cy + 182 * u, cx + 70 * u, cy + 175 * u); x.stroke();
  return c;
}
