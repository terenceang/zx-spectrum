import type { MachineModel } from "../machines/types.js";

export const MCP_BRIDGE_PORT = 8790;

export const SNAPSHOT_EXTENSIONS = { ".sna": "sna", ".z80": "z80" } as const;
export type SnapshotFormat = (typeof SNAPSHOT_EXTENSIONS)[keyof typeof SNAPSHOT_EXTENSIONS];

export const TAPE_EXTENSIONS = { ".tap": "tap", ".tzx": "tzx" } as const;
export type TapeFormat = (typeof TAPE_EXTENSIONS)[keyof typeof TAPE_EXTENSIONS];

export type MediaFormat = SnapshotFormat | TapeFormat;

export type BridgeCommand =
  | { reqId: string; cmd: "getStatus" }
  | { reqId: string; cmd: "readScreen" }
  | { reqId: string; cmd: "loadRom"; model: MachineModel; romBase64: string }
  | { reqId: string; cmd: "loadSnapshot"; format: SnapshotFormat; dataBase64: string }
  | { reqId: string; cmd: "loadTape"; format: TapeFormat; dataBase64: string }
  | { reqId: string; cmd: "playTape" }
  | { reqId: string; cmd: "stopTape" }
  | { reqId: string; cmd: "setFastTapeLoad"; enabled: boolean }
  | { reqId: string; cmd: "reset" }
  | { reqId: string; cmd: "keyEvent"; row: number; bit: number; down: boolean }
  | { reqId: string; cmd: "typeText"; text: string };
