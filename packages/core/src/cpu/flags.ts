// Z80 F register bit layout: S Z 5 H 3 P/V N C
export const enum Flag {
  C = 0x01,
  N = 0x02,
  PV = 0x04,
  F3 = 0x08,
  H = 0x10,
  F5 = 0x20,
  Z = 0x40,
  S = 0x80,
}

// Precomputed S/Z/5/3/P bits for every possible 8-bit ALU result, the standard
// technique for fast flag computation on logical ops (AND/OR/XOR) and INC/DEC-style
// results where only S,Z,5,3,P depend purely on the result byte (H and N and C are
// set separately per-instruction since they depend on the operation, not just the
// result value).
export const SZ53_TABLE = new Uint8Array(256);
export const SZ53P_TABLE = new Uint8Array(256);

for (let value = 0; value < 256; value++) {
  let sz53 = value & (Flag.F3 | Flag.F5);
  if (value === 0) sz53 |= Flag.Z;
  if (value & 0x80) sz53 |= Flag.S;
  SZ53_TABLE[value] = sz53;

  let parity = 0;
  let v = value;
  for (let bit = 0; bit < 8; bit++) {
    parity ^= v & 1;
    v >>= 1;
  }
  SZ53P_TABLE[value] = sz53 | (parity === 0 ? Flag.PV : 0);
}

export function parityOf(value: number): boolean {
  return (SZ53P_TABLE[value & 0xff]! & Flag.PV) !== 0;
}
