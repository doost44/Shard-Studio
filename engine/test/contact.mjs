// Tile PNGs into one contact sheet: node engine/test/contact.mjs out.png a.png b.png ...
import { PNG } from 'pngjs';
import fs from 'node:fs';
const [out, ...files] = process.argv.slice(2);
const imgs = files.map((f) => PNG.sync.read(fs.readFileSync(f)));
const cols = Math.min(imgs.length, Number(process.env.COLS || 6));
const cw = Math.max(...imgs.map((i) => i.width)), ch = Math.max(...imgs.map((i) => i.height));
const rows = Math.ceil(imgs.length / cols), g = 6;
const sheet = new PNG({ width: cols * (cw + g), height: rows * (ch + g) });
sheet.data.fill(40);
imgs.forEach((im, k) => {
  const ox = (k % cols) * (cw + g), oy = Math.floor(k / cols) * (ch + g);
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    const s = (y * im.width + x) * 4, d = ((oy + y) * sheet.width + ox + x) * 4, a = im.data[s + 3] / 255;
    for (let c = 0; c < 3; c++) sheet.data[d + c] = im.data[s + c] * a + 60 * (1 - a);
    sheet.data[d + 3] = 255;
  }
});
fs.writeFileSync(out, PNG.sync.write(sheet));
