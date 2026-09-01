import type { Machine48k } from "../machines/machine48k.js";
import type { ParsedSnaSnapshot } from "./sna.js";
import type { ParsedZ80Snapshot } from "./z80.js";

/** Pushes a parsed 48K snapshot (from either loader) into a live Machine48k. Kept
 * separate from parsing so both loaders stay pure functions, testable without a
 * live machine. */
export function applySnapshotTo48k(
  machine: Machine48k,
  snapshot: ParsedSnaSnapshot | ParsedZ80Snapshot,
): void {
  machine.reset();
  machine.cpu.setState(snapshot.cpu);
  machine.ula.setBorder(snapshot.border);
  for (let i = 0; i < snapshot.ram.length; i++) {
    machine.memory.poke8(0x4000 + i, snapshot.ram[i]!);
  }
}
