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

  private borderColorField = 0;
  // NOTE: borderChanges is cleared per frame (beginFrame), so it doesn't leak across
  // frames. However, programs that rapidly toggle the border (raster effects) can push
  // thousands of {tState, color} objects per frame, causing GC pressure. A flat array
  // would reduce this, but the current approach is correct and the impact is minor.
  private borderChanges: { tState: number; color: number }[] = [];
  private flashPhase = false;
  private flashFrameCounter = 0;
  private framebuffer: Uint8Array | null = null;
  private readonly contentionTable: Uint8Array;

  constructor(
    readonly profile: UlaTimingProfile,
    private readonly keyboard: KeyboardState,
  ) {
    const totalTStates = profile.tStatesPerLine * profile.linesPerFrame;
    // Over-allocate slightly so we don't need a bounds check if tState overshoots at the very end of a frame
    this.contentionTable = new Uint8Array(totalTStates + 100);
    for (let i = profile.firstContendedTstate; i < totalTStates + 100; i++) {
      const rel = i - profile.firstContendedTstate;
      const line = Math.floor(rel / profile.tStatesPerLine);
      if (line >= profile.contendedLines) continue;
      const offsetInLine = rel % profile.tStatesPerLine;
      if (offsetInLine >= 128) continue;
      this.contentionTable[i] = CONTENTION_PATTERN[offsetInLine % 8]!;
    }
  }

  reset(): void {
    this.borderColorField = 0;
    this.borderChanges = [{ tState: 0, color: 0 }];
    this.flashPhase = false;
    this.flashFrameCounter = 0;
    this.beeper.reset();
  }

  /** Current border color (0-7) — snapshot saving reads this back. */
  get borderColor(): number {
    return this.borderColorField;
  }

  /** Sets the border color directly (snapshot loading), bypassing the port-write
   * path so it doesn't also touch the beeper level. */
  setBorder(color: number): void {
    this.borderColorField = color & 0x07;
    this.borderChanges = [{ tState: 0, color: this.borderColorField }];
  }

  /** Port 0xFE write: border (bits 0-2), MIC (bit 3, not modeled for playback),
   * beeper (bit 4). */
  writePort(tState: number, value: number): void {
    const color = value & 0x07;
    if (color !== this.borderColorField) {
      this.borderColorField = color;
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
    return this.contentionTable[tState] ?? 0;
  }

  /** Call at the start of a frame before CPU execution begins. */
  beginFrame(): void {
    this.flashFrameCounter++;
    if (this.flashFrameCounter >= 16) {
      this.flashFrameCounter = 0;
      this.flashPhase = !this.flashPhase;
    }
    this.borderChanges = [{ tState: 0, color: this.borderColorField }];
  }

  /** Call once per frame after the CPU has run to the frame's T-state budget. */
  endFrame(): void {
    this.beginFrame();
  }

  /** Renders the full frame (border + 256x192 display) into a palette-indexed
   * (0-15) buffer, `width`x`height` where width/height come from the profile's
   * border geometry. Border stripes are rasterized with per-pixel T-state accuracy. */
  renderFrame(memory: ScreenSource): { pixels: Uint8Array; width: number; height: number } {
    const borderCols = this.profile.borderSideColumns * 8;
    const width = 256 + borderCols * 2;
    const height = 192 + this.profile.borderTopLines + this.profile.borderBottomLines;
    const size = width * height;
    if (!this.framebuffer || this.framebuffer.length !== size) {
      this.framebuffer = new Uint8Array(size);
    }
    const pixels = this.framebuffer;
    const screen = memory.screenBytes;

    let changeIndex = 0;
    let currentBorderColor = this.borderChanges[0]?.color ?? this.borderColor;

    const lineStartT = (line: number): number =>
      this.profile.firstContendedTstate -
      this.profile.borderTopLines * this.profile.tStatesPerLine -
      this.profile.borderSideColumns * 4 +
      line * this.profile.tStatesPerLine;

    const fillBorderSpan = (xStart: number, xEnd: number, lineT: number, rowBase: number): void => {
      let x = xStart;
      while (x < xEnd) {
        const currentPixelT = lineT + (x >> 1);
        while (
          changeIndex + 1 < this.borderChanges.length &&
          this.borderChanges[changeIndex + 1]!.tState <= currentPixelT
        ) {
          changeIndex++;
          currentBorderColor = this.borderChanges[changeIndex]!.color;
        }

        if (changeIndex + 1 < this.borderChanges.length) {
          const nextChange = this.borderChanges[changeIndex + 1]!;
          const nextChangeX = (nextChange.tState - lineT) * 2;
          if (nextChangeX < xEnd) {
            const fillEnd = Math.max(x, nextChangeX);
            if (fillEnd > x) {
              pixels.fill(paletteIndex(currentBorderColor, false), rowBase + x, rowBase + fillEnd);
              x = fillEnd;
            }
            changeIndex++;
            currentBorderColor = nextChange.color;
            continue;
          }
        }

        pixels.fill(paletteIndex(currentBorderColor, false), rowBase + x, rowBase + xEnd);
        break;
      }
    };

    for (let y = 0; y < height; y++) {
      const lineT = lineStartT(y);
      const isDisplayLine = y >= this.profile.borderTopLines && y < this.profile.borderTopLines + 192;
      const rowBase = y * width;

      if (!isDisplayLine) {
        fillBorderSpan(0, width, lineT, rowBase);
        continue;
      }

      fillBorderSpan(0, borderCols, lineT, rowBase);

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

      fillBorderSpan(borderCols + 256, width, lineT, rowBase);
    }

    return { pixels, width, height };
  }
}

export function tStatesForProfile(profile: UlaTimingProfile): number {
  return tStatesPerFrame(profile);
}
