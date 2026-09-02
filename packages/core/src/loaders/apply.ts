import type { BaseMachine } from "../machines/baseMachine.js";
import type { Machine128k } from "../machines/machine128k.js";
import type { Machine48k } from "../machines/machine48k.js";
import { ROM_PAGE_SIZE } from "../memory/constants.js";
import type { ParsedSnaSnapshot } from "./sna.js";
import type { ParsedZ80Snapshot } from "./z80.js";

function applySnapshotBase(
  machine: BaseMachine,
  snapshot: ParsedSnaSnapshot | ParsedZ80Snapshot,
): void {
  machine.reset();
  machine.cpu.setState(snapshot.cpu);
  machine.ula.setBorder(snapshot.border);
}

/** Pushes a parsed 48K snapshot (from either loader) into a live Machine48k. Kept
 * separate from parsing so both loaders stay pure functions, testable without a
 * live machine. */
export function applySnapshotTo48k(
  machine: Machine48k,
  snapshot: ParsedSnaSnapshot | ParsedZ80Snapshot,
): void {
  applySnapshotBase(machine, snapshot);
  machine.memory.loadRam(snapshot.ram);
}

/** Pushes a parsed 128K-mode snapshot (or a 48K snapshot) into a live Machine128k,
 * writing every RAM bank directly (bypassing paging) so the reconstructed memory is
 * correct regardless of which bank the snapshot's paging register currently selects. */
export function applySnapshotTo128k(
  machine: Machine128k,
  snapshot: ParsedSnaSnapshot | ParsedZ80Snapshot,
): void {
  applySnapshotBase(machine, snapshot);

  const port7ffd = snapshot.port7ffd ?? 0;
  machine.memory.writePagingRegister(port7ffd);

  if ("banks" in snapshot && snapshot.banks) {
    // .z80 v2/v3: every RAM bank comes as an explicit page block (bankNumber = pageNumber - 3).
    for (const { pageNumber, data } of snapshot.banks) {
      const bankNumber = pageNumber - 3;
      if (bankNumber >= 0 && bankNumber <= 7) machine.memory.pokeBank(bankNumber, data);
    }
  } else {
    // Both 128K .sna and 48K snapshots map bank 5 to 0x0000 and bank 2 to 0x4000.
    machine.memory.pokeBank(5, snapshot.ram.subarray(0, ROM_PAGE_SIZE));
    machine.memory.pokeBank(2, snapshot.ram.subarray(ROM_PAGE_SIZE, ROM_PAGE_SIZE * 2));
    const thirdBank = ("pagedBanks" in snapshot && snapshot.pagedBanks) ? (port7ffd & 0x07) : 0;
    machine.memory.pokeBank(thirdBank, snapshot.ram.subarray(ROM_PAGE_SIZE * 2, ROM_PAGE_SIZE * 3));

    if ("pagedBanks" in snapshot && snapshot.pagedBanks) {
      for (const { bank, data } of snapshot.pagedBanks) machine.memory.pokeBank(bank, data);
    }
  }

  if ("ayRegisters" in snapshot && snapshot.ayRegisters) machine.ay.loadRegisters(snapshot.ayRegisters);
}
