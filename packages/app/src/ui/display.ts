import { SPECTRUM_PALETTE_RGB } from "@zx-spectrum/core";
import type { Frame } from "../worker-client.js";

/** Blits a palette-indexed Frame from the worker into a canvas. The RGBA expansion
 * LUT lives here (app layer), not in core, per the plan — keeps the worker->main
 * frame payload 4x smaller than shipping pre-expanded RGBA. */
export class Display {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly lut: Uint32Array;
  private imageData: ImageData | null = null;
  private lastWidth = 0;
  private lastHeight = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;

    this.lut = new Uint32Array(16);
    const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
    for (let i = 0; i < SPECTRUM_PALETTE_RGB.length; i++) {
      const [r, g, b] = SPECTRUM_PALETTE_RGB[i]!;
      this.lut[i] = littleEndian
        ? (0xff << 24) | (b << 16) | (g << 8) | r
        : (r << 24) | (g << 16) | (b << 8) | 0xff;
    }
  }

  render(frame: Frame): void {
    if (frame.width !== this.lastWidth || frame.height !== this.lastHeight) {
      this.canvas.width = frame.width;
      this.canvas.height = frame.height;
      this.imageData = this.ctx.createImageData(frame.width, frame.height);
      this.lastWidth = frame.width;
      this.lastHeight = frame.height;
    }
    const imageData = this.imageData!;
    const dest = new Uint32Array(imageData.data.buffer);
    for (let i = 0; i < frame.pixels.length; i++) {
      dest[i] = this.lut[frame.pixels[i]!]!;
    }
    this.ctx.putImageData(imageData, 0, 0);
  }
}
