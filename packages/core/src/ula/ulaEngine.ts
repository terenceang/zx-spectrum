import { Beeper } from "../audio/beeper.js";
import type { KeyboardState } from "../io/keyboard.js";
import { paletteIndex } from "./palette.js";
import { CONTENTION_PATTERN, type UlaTimingProfile, tStatesPerFrame } from "./timingProfile.js";

export interface ScreenSource {
  readonly screenBytes: Uint8Array;
}

export class UlaEngine {
  readonly beeper = new Beeper();

  private borderColorField = 0;
  private borderChangeTStates = new Int32Array(2048);
  private borderChangeColors = new Uint8Array(2048);
  private borderChangeCount = 0;
  private flashPhase = false;
  private flashFrameCounter = 0;
  private framebuffer: Uint8Array | null = null;
  private readonly contentionTable: Uint8Array;

  constructor(
    readonly profile: UlaTimingProfile,
    private readonly keyboard: KeyboardState,
  ) {
    const totalTStates = profile.tStatesPerLine * profile.linesPerFrame;
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
    this.borderChangeTStates[0] = 0;
    this.borderChangeColors[0] = 0;
    this.borderChangeCount = 1;
    this.flashPhase = false;
    this.flashFrameCounter = 0;
    this.beeper.reset();
  }

  get borderColor(): number {
    return this.borderColorField;
  }

  setBorder(color: number): void {
    this.borderColorField = color & 0x07;
    this.borderChangeTStates[0] = 0;
    this.borderChangeColors[0] = this.borderColorField;
    this.borderChangeCount = 1;
  }

  writePort(tState: number, value: number): void {
    const color = value & 0x07;
    if (color !== this.borderColorField) {
      this.borderColorField = color;
      if (this.borderChangeCount >= this.borderChangeTStates.length) {
        const newCapacity = this.borderChangeTStates.length * 2;
        const newT = new Int32Array(newCapacity);
        const newC = new Uint8Array(newCapacity);
        newT.set(this.borderChangeTStates);
        newC.set(this.borderChangeColors);
        this.borderChangeTStates = newT;
        this.borderChangeColors = newC;
      }
      this.borderChangeTStates[this.borderChangeCount] = tState;
      this.borderChangeColors[this.borderChangeCount] = color;
      this.borderChangeCount++;
    }
    this.beeper.setLevel(tState, (value >> 4) & 1 ? 1 : 0);
  }

  readPort(addressHigh: number, earLevel: 0 | 1 = 0): number {
    const keys = this.keyboard.readPort(addressHigh) & 0x1f;
    const earBit = earLevel ? 0x40 : 0;
    return 0xa0 | earBit | keys;
  }

  contentionDelay(tState: number): number {
    return this.contentionTable[tState] ?? 0;
  }

  beginFrame(): void {
    this.flashFrameCounter++;
    if (this.flashFrameCounter >= 16) {
      this.flashFrameCounter = 0;
      this.flashPhase = !this.flashPhase;
    }
    this.borderChangeTStates[0] = 0;
    this.borderChangeColors[0] = this.borderColorField;
    this.borderChangeCount = 1;
  }

  private lineStartT(line: number): number {
    return (
      this.profile.firstContendedTstate -
      this.profile.borderTopLines * this.profile.tStatesPerLine -
      this.profile.borderSideColumns * 4 +
      line * this.profile.tStatesPerLine
    );
  }

  private fillBorderSpan(
    pixels: Uint8Array,
    xStart: number,
    xEnd: number,
    lineT: number,
    rowBase: number,
    state: { changeIndex: number; currentBorderColor: number },
  ): void {
    let x = xStart;
    while (x < xEnd) {
      const currentPixelT = lineT + (x >> 1);
      while (
        state.changeIndex + 1 < this.borderChangeCount &&
        this.borderChangeTStates[state.changeIndex + 1]! <= currentPixelT
      ) {
        state.changeIndex++;
        state.currentBorderColor = this.borderChangeColors[state.changeIndex]!;
      }

      if (state.changeIndex + 1 < this.borderChangeCount) {
        const nextChangeT = this.borderChangeTStates[state.changeIndex + 1]!;
        const nextChangeColor = this.borderChangeColors[state.changeIndex + 1]!;
        const nextChangeX = (nextChangeT - lineT) * 2;
        if (nextChangeX < xEnd) {
          const fillEnd = Math.max(x, nextChangeX);
          if (fillEnd > x) {
            pixels.fill(
              paletteIndex(state.currentBorderColor, false),
              rowBase + x,
              rowBase + fillEnd,
            );
            x = fillEnd;
          }
          state.changeIndex++;
          state.currentBorderColor = nextChangeColor;
          continue;
        }
      }

      pixels.fill(paletteIndex(state.currentBorderColor, false), rowBase + x, rowBase + xEnd);
      break;
    }
  }

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

    const spanState = {
      changeIndex: 0,
      currentBorderColor:
        this.borderChangeCount > 0 ? this.borderChangeColors[0]! : this.borderColor,
    };

    for (let y = 0; y < height; y++) {
      const lineT = this.lineStartT(y);
      const isDisplayLine =
        y >= this.profile.borderTopLines && y < this.profile.borderTopLines + 192;
      const rowBase = y * width;

      if (!isDisplayLine) {
        this.fillBorderSpan(pixels, 0, width, lineT, rowBase, spanState);
        continue;
      }

      this.fillBorderSpan(pixels, 0, borderCols, lineT, rowBase, spanState);

      const screenY = y - this.profile.borderTopLines;
      const pixelRowOffset = (screenY & 0xc0) * 32 + (screenY & 0x07) * 256 + (screenY & 0x38) * 4;
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
        const invert = flash && this.flashPhase ? 0xff : 0;
        const effectiveByte = pixelByte ^ invert;

        const baseIdx = rowBase + borderCols + xByte * 8;
        pixels[baseIdx] = effectiveByte & 0x80 ? inkIndex : paperIndex;
        pixels[baseIdx + 1] = effectiveByte & 0x40 ? inkIndex : paperIndex;
        pixels[baseIdx + 2] = effectiveByte & 0x20 ? inkIndex : paperIndex;
        pixels[baseIdx + 3] = effectiveByte & 0x10 ? inkIndex : paperIndex;
        pixels[baseIdx + 4] = effectiveByte & 0x08 ? inkIndex : paperIndex;
        pixels[baseIdx + 5] = effectiveByte & 0x04 ? inkIndex : paperIndex;
        pixels[baseIdx + 6] = effectiveByte & 0x02 ? inkIndex : paperIndex;
        pixels[baseIdx + 7] = effectiveByte & 0x01 ? inkIndex : paperIndex;
      }

      this.fillBorderSpan(pixels, borderCols + 256, width, lineT, rowBase, spanState);
    }

    return { pixels, width, height };
  }
}

export function tStatesForProfile(profile: UlaTimingProfile): number {
  return tStatesPerFrame(profile);
}
