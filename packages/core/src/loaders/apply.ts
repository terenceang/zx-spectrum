import type { BaseMachine } from "../machines/baseMachine.js";
import type { Machine128k } from "../machines/machine128k.js";
import type { Machine48k } from "../machines/machine48k.js";
import type { MachinePlus3 } from "../machines/machinePlus3.js";
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

interface BankedMemoryDevice {
  writePort7ffd(value: number): void;
  pokeBank(bankIndex: number, data: Uint8Array): void;
}

function applyBankedRamAndAy(
  memory: BankedMemoryDevice,
  ay: { loadRegisters(values: Uint8Array): void },
  snapshot: ParsedSnaSnapshot | ParsedZ80Snapshot,
): void {
  const port7ffd = snapshot.port7ffd ?? 0;
  memory.writePort7ffd(port7ffd);

  if ("banks" in snapshot && snapshot.banks) {
    for (const { pageNumber, data } of snapshot.banks) {
      const bankNumber = pageNumber - 3;
      if (bankNumber >= 0 && bankNumber <= 7) memory.pokeBank(bankNumber, data);
    }
  } else {
    memory.pokeBank(5, snapshot.ram.subarray(0, ROM_PAGE_SIZE));
    memory.pokeBank(2, snapshot.ram.subarray(ROM_PAGE_SIZE, ROM_PAGE_SIZE * 2));
    const thirdBank = "pagedBanks" in snapshot && snapshot.pagedBanks ? port7ffd & 0x07 : 0;
    memory.pokeBank(thirdBank, snapshot.ram.subarray(ROM_PAGE_SIZE * 2, ROM_PAGE_SIZE * 3));

    if ("pagedBanks" in snapshot && snapshot.pagedBanks) {
      for (const { bank, data } of snapshot.pagedBanks) memory.pokeBank(bank, data);
    }
  }

  if ("ayRegisters" in snapshot && snapshot.ayRegisters) {
    ay.loadRegisters(snapshot.ayRegisters);
  }
}

export function applySnapshotTo48k(
  machine: Machine48k,
  snapshot: ParsedSnaSnapshot | ParsedZ80Snapshot,
): void {
  applySnapshotBase(machine, snapshot);
  machine.memory.loadRam(snapshot.ram);
}

export function applySnapshotTo128k(
  machine: Machine128k,
  snapshot: ParsedSnaSnapshot | ParsedZ80Snapshot,
): void {
  applySnapshotBase(machine, snapshot);
  applyBankedRamAndAy(machine.memory, machine.ay, snapshot);
}

export function applySnapshotToPlus3(
  machine: MachinePlus3,
  snapshot: ParsedSnaSnapshot | ParsedZ80Snapshot,
): void {
  applySnapshotBase(machine, snapshot);
  const port1ffd = "port1ffd" in snapshot && snapshot.port1ffd ? snapshot.port1ffd : 0;
  machine.memory.writePort1ffd(port1ffd);
  machine.fdc.setMotor(machine.memory.diskMotorOn);
  applyBankedRamAndAy(machine.memory, machine.ay, snapshot);
}

export function applySnapshot(
  machine: BaseMachine,
  snapshot: ParsedSnaSnapshot | ParsedZ80Snapshot,
): void {
  if ("fdc" in machine) {
    applySnapshotToPlus3(machine as MachinePlus3, snapshot);
  } else if ("ay" in machine) {
    applySnapshotTo128k(machine as Machine128k, snapshot);
  } else {
    applySnapshotTo48k(machine as Machine48k, snapshot);
  }
}
