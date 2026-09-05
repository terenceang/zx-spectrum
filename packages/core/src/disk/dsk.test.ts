import { describe, expect, it } from "vitest";
import { DskImage, parseDsk } from "./dsk.js";

describe("DskImage parser and serializer", () => {
  it("creates, serializes, and parses an Extended DSK image", () => {
    const image = new DskImage(true, "TEST_CREATOR", 1, 1);
    const sectorData = new Uint8Array(512);
    sectorData.fill(0xaa);
    sectorData[0] = 0x12;
    sectorData[511] = 0x34;

    image.setTrack(0, 0, {
      trackNumber: 0,
      sideNumber: 0,
      sectorSizeCode: 2,
      gap3Length: 0x4e,
      fillerByte: 0xe5,
      sectors: [
        {
          c: 0,
          h: 0,
          r: 1,
          n: 2,
          st1: 0,
          st2: 0,
          data: sectorData,
        },
      ],
    });

    const serialized = image.serialize();
    expect(serialized.length).toBeGreaterThanOrEqual(256 + 256 + 512);

    const parsed = parseDsk(serialized);
    expect(parsed.isExtended).toBe(true);
    expect(parsed.tracksCount).toBe(1);
    expect(parsed.sidesCount).toBe(1);

    const track = parsed.getTrack(0, 0);
    expect(track).toBeDefined();
    expect(track!.sectors.length).toBe(1);

    const sector = parsed.getSector(0, 0, 1);
    expect(sector).toBeDefined();
    expect(sector!.c).toBe(0);
    expect(sector!.r).toBe(1);
    expect(sector!.n).toBe(2);
    expect(sector!.data.length).toBe(512);
    expect(sector!.data[0]).toBe(0x12);
    expect(sector!.data[511]).toBe(0x34);
  });

  it("parses standard MV - CPC format header", () => {
    const buf = new Uint8Array(256 + 256 + 512);
    const magic = "MV - CPCEMU Disk-File\r\n";
    for (let i = 0; i < magic.length; i++) buf[i] = magic.charCodeAt(i);
    buf[0x30] = 1;
    buf[0x31] = 1;
    const trackSize = 256 + 512;
    buf[0x32] = trackSize & 0xff;
    buf[0x33] = (trackSize >> 8) & 0xff;

    const tag = "Track-Info\r\n";
    for (let i = 0; i < tag.length; i++) buf[256 + i] = tag.charCodeAt(i);
    buf[256 + 0x10] = 0;
    buf[256 + 0x11] = 0;
    buf[256 + 0x14] = 2;
    buf[256 + 0x15] = 1;

    buf[256 + 0x18] = 0;
    buf[256 + 0x19] = 0;
    buf[256 + 0x1a] = 0xc1;
    buf[256 + 0x1b] = 2;

    buf[512] = 0x99;

    const parsed = parseDsk(buf);
    expect(parsed.isExtended).toBe(false);
    expect(parsed.tracksCount).toBe(1);
    const sector = parsed.getSector(0, 0, 0xc1);
    expect(sector).toBeDefined();
    expect(sector!.r).toBe(0xc1);
    expect(sector!.data[0]).toBe(0x99);
  });
});
