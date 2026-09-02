/** Decompresses the classic .z80-format RLE scheme: a run of 4+ repeats of the same
 * byte is encoded as ED ED <count> <value>; every other byte is literal. A v1 (whole
 * 48K RAM) block is terminated by the sentinel 00 ED ED 00; v2/v3 page blocks have
 * an explicit length instead and never carry the sentinel — pass `sentinel: true`
 * only for the former. */
export function decompressZ80Rle(data: Uint8Array, sentinel: boolean): Uint8Array {
  // Upper bound: at most data.length bytes output (when no RLE runs exist).
  const out = new Uint8Array(data.length);
  let outLen = 0;
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
      for (let n = 0; n < count; n++) out[outLen++] = value;
      i += 4;
    } else {
      out[outLen++] = data[i]!;
      i += 1;
    }
  }
  return outLen === out.length ? out : out.subarray(0, outLen);
}
