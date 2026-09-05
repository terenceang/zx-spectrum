import { describe, expect, it } from "vitest";
import { DskImage } from "./dsk.js";
import { Fdc765, MSR_DIO, MSR_RQM } from "./fdc765.js";

describe("Fdc765 controller", () => {
  it("executes Recalibrate and Sense Interrupt Status", () => {
    const fdc = new Fdc765();
    fdc.writeData(0x0f);
    fdc.writeData(0x00);
    fdc.writeData(10);
    expect(fdc.currentTrack).toBe(10);

    fdc.writeData(0x07);
    fdc.writeData(0x00);
    expect(fdc.currentTrack).toBe(0);

    fdc.writeData(0x08);
    const msr = fdc.readMsr();
    expect(msr & MSR_RQM).not.toBe(0);
    expect(msr & MSR_DIO).not.toBe(0);

    const st0 = fdc.readData();
    const pcn = fdc.readData();
    expect(st0 & 0x20).toBe(0x20);
    expect(pcn).toBe(0);
  });

  it("reads sector data via Read Data command (0x06)", () => {
    const fdc = new Fdc765();
    const disk = new DskImage(true, "TEST", 1, 1);
    const sectorData = new Uint8Array(512);
    sectorData.fill(0x77);
    sectorData[0] = 0x11;
    sectorData[511] = 0x22;

    disk.setTrack(0, 0, {
      trackNumber: 0,
      sideNumber: 0,
      sectorSizeCode: 2,
      gap3Length: 0x4e,
      fillerByte: 0xe5,
      sectors: [{ c: 0, h: 0, r: 0xc1, n: 2, st1: 0, st2: 0, data: sectorData }],
    });

    fdc.insertDisk(disk);
    fdc.setMotor(true);

    const cmd = [0x06, 0x00, 0, 0, 0xc1, 2, 0xc1, 0x2a, 0xff];
    for (const b of cmd) {
      fdc.writeData(b);
    }

    const readOut = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      readOut[i] = fdc.readData();
    }
    expect(readOut[0]).toBe(0x11);
    expect(readOut[511]).toBe(0x22);

    const st0 = fdc.readData();
    const st1 = fdc.readData();
    const st2 = fdc.readData();
    const c = fdc.readData();
    const h = fdc.readData();
    const r = fdc.readData();
    const n = fdc.readData();

    expect(st0 & 0xc0).toBe(0);
    expect(st1).toBe(0);
    expect(st2).toBe(0);
    expect(c).toBe(0);
    expect(h).toBe(0);
    expect(r).toBe(0xc2);
    expect(n).toBe(2);
  });

  it("writes sector data via Write Data command (0x05)", () => {
    const fdc = new Fdc765();
    const disk = new DskImage(true, "TEST", 1, 1);
    const sectorData = new Uint8Array(512);
    disk.setTrack(0, 0, {
      trackNumber: 0,
      sideNumber: 0,
      sectorSizeCode: 2,
      gap3Length: 0x4e,
      fillerByte: 0xe5,
      sectors: [{ c: 0, h: 0, r: 0xc1, n: 2, st1: 0, st2: 0, data: sectorData }],
    });

    fdc.insertDisk(disk);
    fdc.setMotor(true);

    const cmd = [0x05, 0x00, 0, 0, 0xc1, 2, 0xc1, 0x2a, 0xff];
    for (const b of cmd) {
      fdc.writeData(b);
    }

    for (let i = 0; i < 512; i++) {
      fdc.writeData(0x42);
    }

    const st0 = fdc.readData();
    expect(st0 & 0xc0).toBe(0);

    expect(sectorData[0]).toBe(0x42);
    expect(sectorData[511]).toBe(0x42);
  });
});
