export type MachineModel = "48k" | "128k";

export interface FrameBuffer {
  pixels: Uint8Array;
  width: number;
  height: number;
}
