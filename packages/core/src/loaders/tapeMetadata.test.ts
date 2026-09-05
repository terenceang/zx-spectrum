import { describe, expect, it } from "vitest";
import { detectTapeMachine, is128kOrAboveTape } from "./tapeMetadata.js";

describe("tapeMetadata", () => {
  it("identifies 128k tapes by filename patterns", () => {
    expect(is128kOrAboveTape("Fairlight 128K", "Fairlight - A Prelude (1985)[128K].tap")).toBe(
      true,
    );
    expect(is128kOrAboveTape("Fairlight", "Fairlight - 128k.tzx")).toBe(true);
    expect(is128kOrAboveTape("128DEMO", "128DEMO.TAP")).toBe(true);
    expect(is128kOrAboveTape("128KMUSI", "128KMUSI.Z80")).toBe(true);
    expect(is128kOrAboveTape("Game", "Game +2.tap")).toBe(true);
    expect(is128kOrAboveTape("Game", "Game +3.tap")).toBe(true);
    expect(is128kOrAboveTape("Game", "Game (Plus 3).tap")).toBe(true);
    expect(detectTapeMachine("Game", "Game[128K].tap")).toBe("128k");
  });

  it("identifies 48k tapes by filename patterns", () => {
    expect(
      is128kOrAboveTape("Fairlight", "Fairlight - A Prelude (1985)(The Edge Software).tap"),
    ).toBe(false);
    expect(
      is128kOrAboveTape("The Hobbit v1.2", "Hobbit, The v1.2 (1982)(Melbourne House).tap"),
    ).toBe(false);
    expect(is128kOrAboveTape("Manic Miner", "Manic Miner (1983)(Bug-Byte Software).tap")).toBe(
      false,
    );
    expect(is128kOrAboveTape("Attribute2You", "Attribute2You.tap")).toBe(false);
    expect(detectTapeMachine("Skool Daze", "Skool Daze.tap")).toBe("48k");
  });

  it("honors explicit machine metadata", () => {
    expect(is128kOrAboveTape("SomeGame", "game.tap", undefined, "128k")).toBe(true);
    expect(is128kOrAboveTape("SomeGame", "game.tap", undefined, "plus3")).toBe(true);
    expect(is128kOrAboveTape("Game 128K", "game128.tap", undefined, "48k")).toBe(false);
  });

  it("identifies 128k from TAP header block content", () => {
    const nameStr = "loader128 ";
    const block = new Uint8Array(21);
    block[0] = 19;
    block[1] = 0;
    block[2] = 0x00;
    block[3] = 0;
    for (let i = 0; i < 10; i++) block[4 + i] = nameStr.charCodeAt(i);

    expect(is128kOrAboveTape("Game", "game.tap", block.buffer)).toBe(true);
  });
});
