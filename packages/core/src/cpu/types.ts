import type { Z80 } from "./z80.js";

/** One decoded instruction's behavior. Receives the CPU with `pc` already advanced
 * past the opcode byte(s) that selected this handler; the handler is responsible for
 * consuming any operand bytes (immediate 8/16-bit values, index displacement) itself
 * via `cpu.bus`, and for any extra internal T-states via `cpu.bus.contend()`. */
export type OpcodeFn = (cpu: Z80) => void;

export type OpcodeTable = readonly OpcodeFn[];

/** Which index register a DD/FD-prefixed instruction table instance operates on. */
export type IndexRegister = "ix" | "iy";
