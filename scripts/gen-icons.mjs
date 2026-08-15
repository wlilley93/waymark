// Generates the PWA icons without any dependency: a minimal PNG encoder
// (zlib + CRC) drawing a rounded-square background with a waymark ring+dot.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, bg, fg) {
  const rows = [];
  const r = size * 0.22; // corner radius
  const cx = size / 2;
  const cy = size * 0.42;
  const ringR = size * 0.2;
  const ringW = size * 0.055;
  const dotR = size * 0.055;
  const tailTop = cy + ringR * 0.55;
  const tailBottom = size * 0.82;
  const tailHalfW = ringR * 0.8;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      let color = bg;
      // rounded-rect mask
      const inRect =
        x >= r && x < size - r ? true : y >= r && y < size - r ? true :
          (() => {
            const nx = x < r ? r : size - 1 - r;
            const ny = y < r ? r : size - 1 - r;
            return Math.hypot(x - nx, y - ny) <= r;
          })();
      if (!inRect) {
        row[1 + x * 4 + 3] = 0;
        continue;
      }
      // pin: ring
      const dRing = Math.abs(Math.hypot(x - cx, y - cy) - ringR);
      // pin: dot
      const dDot = Math.hypot(x - cx, y - cy);
      // pin: tail triangle
      const inTail =
        y > tailTop && y < tailBottom
          ? Math.abs(x - cx) < (tailHalfW * (tailBottom - y)) / (tailBottom - tailTop)
          : false;
      if (dRing <= ringW || dDot <= dotR || inTail) color = fg;
      row[1 + x * 4] = color[0];
      row[1 + x * 4 + 1] = color[1];
      row[1 + x * 4 + 2] = color[2];
      row[1 + x * 4 + 3] = 255;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

const outDir = path.resolve(process.argv[2] ?? "apps/web/public/icons");
mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(path.join(outDir, `${size}.png`), png(size, [27, 30, 39], [79, 109, 245]));
  console.log(`wrote ${size}.png`);
}
