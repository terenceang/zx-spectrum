import type { Z80 } from "./z80.js";

export type OpcodeFn = (cpu: Z80) => void;

export type OpcodeTable = readonly OpcodeFn[];

export type IndexRegister = "ix" | "iy";
