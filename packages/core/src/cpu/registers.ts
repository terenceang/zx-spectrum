export const enum RegIndex {
  B = 0,
  C = 1,
  D = 2,
  E = 3,
  H = 4,
  L = 5,
  A = 6,
  F = 7,
  B_ = 8,
  C_ = 9,
  D_ = 10,
  E_ = 11,
  H_ = 12,
  L_ = 13,
  A_ = 14,
  F_ = 15,
  IXH = 16,
  IXL = 17,
  IYH = 18,
  IYL = 19,
  I = 20,
  R = 21,
}

export const REGISTERS_BYTE_LENGTH = 22;

export const enum WordIndex {
  PC = 0,
  SP = 1,
  IX = 2,
  IY = 3,
  MEMPTR = 4,
}

export const WORDS_LENGTH = 5;

export class Registers {
  readonly bytes = new Uint8Array(REGISTERS_BYTE_LENGTH);
  readonly words = new Uint16Array(WORDS_LENGTH);

  get pc(): number {
    return this.words[WordIndex.PC]!;
  }
  set pc(v: number) {
    this.words[WordIndex.PC] = v;
  }

  get sp(): number {
    return this.words[WordIndex.SP]!;
  }
  set sp(v: number) {
    this.words[WordIndex.SP] = v;
  }

  get ix(): number {
    return this.words[WordIndex.IX]!;
  }
  set ix(v: number) {
    this.words[WordIndex.IX] = v;
    this.bytes[RegIndex.IXH] = v >> 8;
    this.bytes[RegIndex.IXL] = v & 0xff;
  }

  get iy(): number {
    return this.words[WordIndex.IY]!;
  }
  set iy(v: number) {
    this.words[WordIndex.IY] = v;
    this.bytes[RegIndex.IYH] = v >> 8;
    this.bytes[RegIndex.IYL] = v & 0xff;
  }

  get memptr(): number {
    return this.words[WordIndex.MEMPTR]!;
  }
  set memptr(v: number) {
    this.words[WordIndex.MEMPTR] = v & 0xffff;
  }

  syncIx(): void {
    this.words[WordIndex.IX] = (this.bytes[RegIndex.IXH]! << 8) | this.bytes[RegIndex.IXL]!;
  }
  syncIy(): void {
    this.words[WordIndex.IY] = (this.bytes[RegIndex.IYH]! << 8) | this.bytes[RegIndex.IYL]!;
  }

  get bc(): number {
    return (this.bytes[RegIndex.B]! << 8) | this.bytes[RegIndex.C]!;
  }
  set bc(v: number) {
    this.bytes[RegIndex.B] = v >> 8;
    this.bytes[RegIndex.C] = v & 0xff;
  }

  get de(): number {
    return (this.bytes[RegIndex.D]! << 8) | this.bytes[RegIndex.E]!;
  }
  set de(v: number) {
    this.bytes[RegIndex.D] = v >> 8;
    this.bytes[RegIndex.E] = v & 0xff;
  }

  get hl(): number {
    return (this.bytes[RegIndex.H]! << 8) | this.bytes[RegIndex.L]!;
  }
  set hl(v: number) {
    this.bytes[RegIndex.H] = v >> 8;
    this.bytes[RegIndex.L] = v & 0xff;
  }

  get af(): number {
    return (this.bytes[RegIndex.A]! << 8) | this.bytes[RegIndex.F]!;
  }
  set af(v: number) {
    this.bytes[RegIndex.A] = v >> 8;
    this.bytes[RegIndex.F] = v & 0xff;
  }

  reset(): void {
    this.bytes.fill(0);
    this.words.fill(0);
    this.bytes[RegIndex.A] = 0xff;
    this.bytes[RegIndex.F] = 0xff;
    this.bytes[RegIndex.A_] = 0xff;
    this.bytes[RegIndex.F_] = 0xff;
    this.words[WordIndex.SP] = 0xffff;
    this.words[WordIndex.IX] = 0xffff;
    this.words[WordIndex.IY] = 0xffff;
    this.bytes[RegIndex.IXH] = 0xff;
    this.bytes[RegIndex.IXL] = 0xff;
    this.bytes[RegIndex.IYH] = 0xff;
    this.bytes[RegIndex.IYL] = 0xff;
  }
}
