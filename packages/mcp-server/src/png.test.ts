import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodeIndexedFramePng } from "./png.js";

describe("encodeIndexedFramePng", () => {
  it("produces a well-formed PNG whose IDAT inflates back to the exact pixel data", () => {
    const width = 3;
    const height = 2;
    const pixels = Uint8Array.from([0, 1, 2, 1, 2, 0]);
    const palette: [number, number, number][] = [
      [0, 0, 0],
      [255, 0, 0],
      [0, 255, 0],
    ];

    const png = encodeIndexedFramePng(pixels, width, height, palette);

    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    // Walk the chunk list, find IHDR and IDAT by type, independent of encoder internals.
    let offset = 8;
    const chunks: { type: string; data: Buffer }[] = [];
    while (offset < png.length) {
      const length = png.readUInt32BE(offset);
      const type = png.subarray(offset + 4, offset + 8).toString("ascii");
      const data = png.subarray(offset + 8, offset + 8 + length);
      chunks.push({ type, data });
      offset += 8 + length + 4; // length + type + data + crc
    }

    const ihdr = chunks.find((c) => c.type === "IHDR")!;
    expect(ihdr.data.readUInt32BE(0)).toBe(width);
    expect(ihdr.data.readUInt32BE(4)).toBe(height);
    expect(ihdr.data[8]).toBe(8); // bit depth
    expect(ihdr.data[9]).toBe(2); // color type: truecolor RGB

    const idat = chunks.find((c) => c.type === "IDAT")!;
    const raw = inflateSync(idat.data);

    const stride = 1 + width * 3;
    expect(raw.length).toBe(stride * height);
    for (let y = 0; y < height; y++) {
      expect(raw[y * stride]).toBe(0); // filter: None
      for (let x = 0; x < width; x++) {
        const [r, g, b] = palette[pixels[y * width + x]!]!;
        const o = y * stride + 1 + x * 3;
        expect([raw[o], raw[o + 1], raw[o + 2]]).toEqual([r, g, b]);
      }
    }

    expect(chunks.at(-1)!.type).toBe("IEND");
  });
});
