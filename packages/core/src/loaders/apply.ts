import type { Machine128k } from "../machines/machine128k.js";
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

/** Pushes a parsed 128K-mode snapshot into a live Machine128k, writing every RAM
 * bank directly (bypassing paging) so the reconstructed memory is correct
 * regardless of which bank the snapshot's paging register currently selects. */
export function applySnapshotTo128k(
  machine: Machine128k,
  snapshot: ParsedSnaSnapshot | ParsedZ80Snapshot,
): void {
  machine.reset();
  machine.cpu.setState(snapshot.cpu);
  machine.ula.setBorder(snapshot.border);

  const port7ffd = snapshot.port7ffd ?? 0;
  machine.memory.writePagingRegister(port7ffd);

  if ("banks" in snapshot && snapshot.banks) {
    // .z80: every RAM bank comes as an explicit page block (bankNumber = pageNumber - 3).
    for (const { pageNumber, data } of snapshot.banks) {
      const bankNumber = pageNumber - 3;
      if (bankNumber >= 0 && bankNumber <= 7) machine.memory.pokeBank(bankNumber, data);
    }
  } else if ("pagedBanks" in snapshot && snapshot.pagedBanks) {
    // .sna: banks 5/2/[paged] are folded into `ram`; the rest are explicit.
    const activeBank = port7ffd & 0x07;
    machine.memory.pokeBank(5, snapshot.ram.subarray(0x0000, 0x4000));
    machine.memory.pokeBank(2, snapshot.ram.subarray(0x4000, 0x8000));
    machine.memory.pokeBank(activeBank, snapshot.ram.subarray(0x8000, 0xc000));
    for (const { bank, data } of snapshot.pagedBanks) machine.memory.pokeBank(bank, data);
  }

  if ("ayRegisters" in snapshot && snapshot.ayRegisters) machine.ay.loadRegisters(snapshot.ayRegisters);
}
