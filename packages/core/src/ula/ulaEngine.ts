import { Beeper } from "../audio/beeper.js";
import type { KeyboardState } from "../io/keyboard.js";
import { paletteIndex } from "./palette.js";
import { CONTENTION_PATTERN, type UlaTimingProfile, tStatesPerFrame } from "./timingProfile.js";

/** What renderFrame needs from memory: a view whose index 0 corresponds to address
 * 0x4000 (the display file's base). Memory48k.screenBytes is the full 48K RAM;
 * Memory128k.screenBytes is whichever bank (5 or 7) the ULA is currently reading. */
export interface ScreenSource {
  readonly screenBytes: Uint8Array;
}

/** Data-driven ULA engine shared across 48K/128K/+3 — see timingProfile.ts. Owns
 * border, beeper, contention, and (for now, Phase 1) end-of-frame bulk framebuffer
 * rendering with per-scanline border color from a logged change list, which is
 * enough to reproduce the border-stripe effects loaders commonly use even without
 * true per-scanline racing-the-beam rendering. */
export class UlaEngine {
  readonly beeper = new Beeper();

  private borderColor = 0;
  private borderChanges: { tState: number; color: number }[] = [];
  private flashPhase = false;
  private flashFrameCounter = 0;

  constructor(
    readonly profile: UlaTimingProfile,
    private readonly keyboard: KeyboardState,
  ) {}

  reset(): void {
    this.borderColor = 0;
    this.borderChanges = [];
    this.flashPhase = false;
    this.flashFrameCounter = 0;
    this.beeper.reset();
  }

  /** Sets the border color directly (snapshot loading), bypassing the port-write
   * path so it doesn't also touch the beeper level. */
  setBorder(color: number): void {
    this.borderColor = color & 0x07;
    this.borderChanges = [{ tState: 0, color: this.borderColor }];
  }

  /** Port 0xFE write: border (bits 0-2), MIC (bit 3, not modeled for playback),
   * beeper (bit 4). */
  writePort(tState: number, value: number): void {
    const color = value & 0x07;
    if (color !== this.borderColor) {
      this.borderColor = color;
      this.borderChanges.push({ tState, color });
    }
    this.beeper.setLevel(tState, (value >> 4) & 1 ? 1 : 0);
  }

  /** Port 0xFE read: EAR (bit 6, tape input) and keyboard (bits 0-4), OR-combined
   * across every row selected by a 0 bit in `addressHigh`. `earLevel` is supplied
   * by the machine (from its TapeEdgePlayer) each call — the ULA doesn't own tape
   * playback, it just reflects whatever level it's told. */
  readPort(addressHigh: number, earLevel: 0 | 1 = 0): number {
    const keys = this.keyboard.readPort(addressHigh) & 0x1f;
    const earBit = earLevel ? 0x40 : 0;
    return 0xa0 | earBit | keys; // bits 5,7 float high
  }

  /** Contention delay in T-states for a memory/port access landing on `tState`. */
  contentionDelay(tState: number): number {
    if (tState < this.profile.firstContendedTstate) return 0;
    const rel = tState - this.profile.firstContendedTstate;
    const line = Math.floor(rel / this.profile.tStatesPerLine);
    if (line >= this.profile.contendedLines) return 0;
    const offsetInLine = rel % this.profile.tStatesPerLine;
    if (offsetInLine >= 128) return 0;
    return CONTENTION_PATTERN[offsetInLine % 8]!;
  }

  /** Call once per frame after the CPU has run to the frame's T-state budget. */
  endFrame(): void {
    this.flashFrameCounter++;
    if (this.flashFrameCounter >= 16) {
      this.flashFrameCounter = 0;
      this.flashPhase = !this.flashPhase;
    }
    this.borderChanges = [{ tState: 0, color: this.borderColor }];
  }

  /** Renders the full frame (border + 256x192 display) into a palette-indexed
   * (0-15) buffer, `width`x`height` where width/height come from the profile's
   * border geometry. */
  renderFrame(memory: ScreenSource): { pixels: Uint8Array; width: number; height: number } {
    const borderCols = this.profile.borderSideColumns * 8;
    const width = 256 + borderCols * 2;
    const height = 192 + this.profile.borderTopLines + this.profile.borderBottomLines;
    const pixels = new Uint8Array(width * height);
    const screen = memory.screenBytes;

    let changeIndex = 0;
    let currentBorderColor = this.borderChanges[0]?.color ?? this.borderColor;
    const lineT0 = (line: number): number =>
      this.profile.firstContendedTstate -
      this.profile.borderTopLines * this.profile.tStatesPerLine +
      line * this.profile.tStatesPerLine;

    for (let y = 0; y < height; y++) {
      const lineStartT = lineT0(y);
      while (
        changeIndex < this.borderChanges.length &&
        this.borderChanges[changeIndex]!.tState <= lineStartT
      ) {
        currentBorderColor = this.borderChanges[changeIndex]!.color;
        changeIndex++;
      }

      const isDisplayLine = y >= this.profile.borderTopLines && y < this.profile.borderTopLines + 192;
      const rowBase = y * width;

      if (!isDisplayLine) {
        pixels.fill(paletteIndex(currentBorderColor, false), rowBase, rowBase + width);
        continue;
      }

      pixels.fill(paletteIndex(currentBorderColor, false), rowBase, rowBase + borderCols);
      pixels.fill(
        paletteIndex(currentBorderColor, false),
        rowBase + borderCols + 256,
        rowBase + width,
      );

      const screenY = y - this.profile.borderTopLines;
      const pixelRowOffset =
        (screenY & 0xc0) * 32 + (screenY & 0x07) * 256 + (screenY & 0x38) * 4;
      const attrRowOffset = 6144 + (screenY >> 3) * 32;

      for (let xByte = 0; xByte < 32; xByte++) {
        const pixelByte = screen[pixelRowOffset + xByte]!;
        const attr = screen[attrRowOffset + xByte]!;
        const ink = attr & 0x07;
        const paper = (attr >> 3) & 0x07;
        const bright = (attr & 0x40) !== 0;
        const flash = (attr & 0x80) !== 0;
        const inkIndex = paletteIndex(ink, bright);
        const paperIndex = paletteIndex(paper, bright);

        for (let bit = 0; bit < 8; bit++) {
          const set = (pixelByte & (0x80 >> bit)) !== 0;
          const useInk = flash && this.flashPhase ? !set : set;
          pixels[rowBase + borderCols + xByte * 8 + bit] = useInk ? inkIndex : paperIndex;
        }
      }
    }

    return { pixels, width, height };
  }
}

export function tStatesForProfile(profile: UlaTimingProfile): number {
  return tStatesPerFrame(profile);
}
