import { RAM_48K_SIZE, ROM_PAGE_SIZE } from "../memory/constants.js";

export function decompressZ80Rle(data: Uint8Array, sentinel: boolean): Uint8Array {
  let out = new Uint8Array(sentinel ? RAM_48K_SIZE : Math.max(ROM_PAGE_SIZE, data.length));
  let outLen = 0;

  function ensureCapacity(needed: number): void {
    if (outLen + needed > out.length) {
      const next = new Uint8Array(Math.max(out.length * 2, outLen + needed));
      next.set(out);
      out = next;
    }
  }

  let i = 0;
  while (i < data.length) {
    if (
      sentinel &&
      data[i] === 0x00 &&
      i + 3 < data.length &&
      data[i + 1] === 0xed &&
      data[i + 2] === 0xed &&
      data[i + 3] === 0x00
    ) {
      break;
    }
    if (data[i] === 0xed && i + 3 < data.length && data[i + 1] === 0xed) {
      const count = data[i + 2]!;
      const value = data[i + 3]!;
      ensureCapacity(count);
      out.fill(value, outLen, outLen + count);
      outLen += count;
      i += 4;
    } else {
      ensureCapacity(1);
      out[outLen++] = data[i]!;
      i += 1;
    }
  }
  return outLen === out.length ? out : out.subarray(0, outLen);
}

export function compressZ80Rle(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const b = data[i]!;
    let run = 1;
    while (i + run < data.length && data[i + run] === b && run < 255) {
      run++;
    }

    if (b === 0xed) {
      if (run >= 2) {
        out.push(0xed, 0xed, run, 0xed);
        i += run;
      } else {
        out.push(0xed);
        i += 1;
      }
    } else if (run >= 5) {
      out.push(0xed, 0xed, run, b);
      i += run;
    } else {
      for (let k = 0; k < run; k++) {
        out.push(b);
      }
      i += run;
    }
  }
  return new Uint8Array(out);
}
