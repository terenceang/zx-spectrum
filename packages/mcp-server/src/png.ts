import { deflateSync } from "node:zlib";

/** Minimal PNG encoder for the emulator's palette-indexed frame buffer, encoded as
 * 8-bit truecolor RGB (no palette/PLTE chunk — simpler, and the frame is tiny
 * enough that the size difference doesn't matter). Node's `zlib` provides the
 * DEFLATE compression PNG requires; CRC32 isn't in `zlib`'s API, so it's the one
 * piece hand-rolled here (the standard table-driven algorithm, ~20 lines). */

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type, (c) => c.charCodeAt(0));
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);

  const out = new Uint8Array(4 + crcInput.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(crcInput, 4);
  view.setUint32(4 + crcInput.length, crc32(crcInput), false);
  return out;
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Encodes a palette-indexed frame buffer (0-15 per pixel, as produced by
 * `UlaEngine.renderFrame`) to a PNG, expanding through `paletteRgb` (index ->
 * [r,g,b]) at encode time. */
export function encodeIndexedFramePng(
  pixels: Uint8Array,
  width: number,
  height: number,
  paletteRgb: readonly (readonly [number, number, number])[],
): Buffer {
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = truecolor RGB
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  // Raw scanlines: one filter-type byte (0 = None) + width*3 RGB bytes, per row.
  const stride = 1 + width * 3;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paletteRgb[pixels[y * width + x]!]!;
      const o = rowStart + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }

  const idat = deflateSync(raw);

  const parts = [PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}
