#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
// A relative import to core's compiled dist, not the "@zx-spectrum/core" package
// name: that name resolves (via package.json "main") to core's raw .ts source,
// which Vite transforms on the fly for the app/worker but plain Node can't
// execute directly. Composite project references mean `tsc -b` here already
// builds core first, so dist/ is always present. Mirrors the same relative-import
// pattern packages/app/src/worker-client.ts uses for the worker package.
import {
  type BaseMachine,
  Machine128k,
  Machine48k,
  type MachineModel,
  SNAPSHOT_EXTENSIONS,
  SPECTRUM_KEY_MATRIX,
  SPECTRUM_PALETTE_RGB,
  TAPE_EXTENSIONS,
  applySnapshotTo128k,
  applySnapshotTo48k,
  parseSna,
  parseTap,
  parseTzx,
  parseZ80,
  writeSna128k,
  writeSna48k,
} from "../../core/dist/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { callInstance, connectedInstanceIds, resolveInstance } from "./bridge.js";
import { encodeIndexedFramePng } from "./png.js";

const instanceIdSchema = { instanceId: z.string().optional() };

/** One live machine, headless — no worker/SharedArrayBuffer transport needed since
 * an MCP tool call and its response are already a natural request/reply boundary.
 * `load_rom` replaces this outright (rather than keeping both models alive like
 * the app's worker does for live in-browser switching, which doesn't apply here). */
let machine: BaseMachine | null = null;
let model: MachineModel | null = null;

function requireMachine(): BaseMachine {
  if (!machine) throw new Error("No ROM loaded yet — call load_rom first.");
  return machine;
}

const server = new McpServer({ name: "zx-spectrum", version: "0.2.0" });

server.registerTool(
  "load_rom",
  {
    title: "Load ROM",
    description:
      "Loads a ROM image and (re)creates the machine. For 48k, romPath is the single " +
      "16384-byte ROM. For 128k, romPath is ROM0 (128 editor) and rom1Path is ROM1 (48 " +
      "BASIC) — both 16384 bytes each, as separate files (e.g. 128-0.rom/128-1.rom).",
    inputSchema: {
      model: z.enum(["48k", "128k"]),
      romPath: z.string(),
      rom1Path: z.string().optional(),
      ...instanceIdSchema,
    },
  },
  async ({ model: newModel, romPath, rom1Path, instanceId }) => {
    const target = resolveInstance(instanceId);
    if (target) {
      if (newModel === "128k" && !rom1Path) throw new Error("128k requires both romPath (ROM0) and rom1Path (ROM1).");
      const rom0 = readFileSync(romPath);
      const romBytes = newModel === "128k" ? Buffer.concat([rom0, readFileSync(rom1Path!)]) : rom0;
      await callInstance(target, "loadRom", { model: newModel, romBase64: romBytes.toString("base64") });
      return { content: [{ type: "text", text: `Loaded ${newModel} ROM into instance "${target}".` }] };
    }
    if (newModel === "48k") {
      const m = new Machine48k();
      m.loadRom(new Uint8Array(readFileSync(romPath)));
      machine = m;
    } else {
      if (!rom1Path) throw new Error("128k requires both romPath (ROM0) and rom1Path (ROM1).");
      const m = new Machine128k();
      m.loadRoms(new Uint8Array(readFileSync(romPath)), new Uint8Array(readFileSync(rom1Path)));
      machine = m;
    }
    model = newModel;
    machine.reset();
    return { content: [{ type: "text", text: `Loaded ${newModel} ROM and reset the machine.` }] };
  },
);

function detectFormat<T extends Record<string, string>>(path: string, table: T): T[keyof T] {
  const lower = path.toLowerCase();
  const ext = Object.keys(table).find((e) => lower.endsWith(e));
  if (!ext) throw new Error(`Unrecognized file extension for "${path}" (expected ${Object.keys(table).join("/")})`);
  return table[ext as keyof T];
}

server.registerTool(
  "load_snapshot",
  {
    title: "Load snapshot",
    description: "Loads a .sna or .z80 snapshot into the current machine (format inferred from the extension).",
    inputSchema: { path: z.string(), ...instanceIdSchema },
  },
  async ({ path, instanceId }) => {
    const format = detectFormat(path, SNAPSHOT_EXTENSIONS);
    const target = resolveInstance(instanceId);
    if (target) {
      const dataBase64 = readFileSync(path).toString("base64");
      await callInstance(target, "loadSnapshot", { format, dataBase64 });
      return { content: [{ type: "text", text: `Loaded snapshot "${path}" into instance "${target}".` }] };
    }
    const m = requireMachine();
    const bytes = new Uint8Array(readFileSync(path));
    const snapshot = format === "sna" ? parseSna(bytes) : parseZ80(bytes);
    if (model === "48k") applySnapshotTo48k(m as Machine48k, snapshot);
    else applySnapshotTo128k(m as Machine128k, snapshot);
    return { content: [{ type: "text", text: `Loaded snapshot "${path}".` }] };
  },
);

server.registerTool(
  "load_tape",
  {
    title: "Load tape",
    description:
      "Loads a .tap or .tzx tape file into the cassette player in stopped state. " +
      "Use play_tape to start playback.",
    inputSchema: {
      path: z.string(),
      fastLoad: z.boolean().optional(),
      play: z.boolean().optional(),
      ...instanceIdSchema,
    },
  },
  async ({ path, fastLoad, play, instanceId }) => {
    const format = detectFormat(path, TAPE_EXTENSIONS);
    const target = resolveInstance(instanceId);
    if (target) {
      if (fastLoad !== undefined) await callInstance(target, "setFastTapeLoad", { enabled: fastLoad });
      const dataBase64 = readFileSync(path).toString("base64");
      await callInstance(target, "loadTape", { format, dataBase64 });
      if (play) await callInstance(target, "playTape");
      return { content: [{ type: "text", text: `Loaded tape "${path}" on instance "${target}" (${play ? "playing" : "stopped"}).` }] };
    }
    const m = requireMachine();
    if (fastLoad !== undefined) m.fastTapeLoad = fastLoad;
    const bytes = new Uint8Array(readFileSync(path));
    const pulses = format === "tap" ? parseTap(bytes) : parseTzx(bytes);
    m.loadTape(pulses);
    if (play) {
      m.playTape();
    } else {
      m.stopTape();
    }
    return { content: [{ type: "text", text: `Loaded tape "${path}" (${play ? "playing" : "stopped"}).` }] };
  },
);

server.registerTool(
  "play_tape",
  { title: "Play tape", description: "Resumes tape playback from the start.", inputSchema: instanceIdSchema },
  async ({ instanceId }) => {
    const target = resolveInstance(instanceId);
    if (target) await callInstance(target, "playTape");
    else requireMachine().playTape();
    return { content: [{ type: "text", text: "Tape playing." }] };
  },
);

server.registerTool(
  "stop_tape",
  { title: "Stop tape", description: "Stops tape playback.", inputSchema: instanceIdSchema },
  async ({ instanceId }) => {
    const target = resolveInstance(instanceId);
    if (target) await callInstance(target, "stopTape");
    else requireMachine().stopTape();
    return { content: [{ type: "text", text: "Tape stopped." }] };
  },
);

server.registerTool(
  "set_fast_tape_load",
  {
    title: "Set fast tape load",
    description: "Enables or disables fast tape instant loading (intercepts standard ROM loader).",
    inputSchema: { enabled: z.boolean(), ...instanceIdSchema },
  },
  async ({ enabled, instanceId }) => {
    const target = resolveInstance(instanceId);
    if (target) await callInstance(target, "setFastTapeLoad", { enabled });
    else requireMachine().fastTapeLoad = enabled;
    return { content: [{ type: "text", text: `Fast tape load ${enabled ? "enabled" : "disabled"}.` }] };
  },
);

server.registerTool(
  "reset",
  { title: "Reset", description: "Resets the current machine (keeps the loaded ROM).", inputSchema: instanceIdSchema },
  async ({ instanceId }) => {
    const target = resolveInstance(instanceId);
    if (target) await callInstance(target, "reset");
    else requireMachine().reset();
    return { content: [{ type: "text", text: "Machine reset." }] };
  },
);

server.registerTool(
  "run_frames",
  {
    title: "Run frames",
    description:
      "Advances emulation by `count` frames (50 per second of Spectrum time). Against a " +
      "connected browser instance, which already runs in real time, this just waits out " +
      "that much wall-clock time instead of stepping.",
    inputSchema: { count: z.number().int().min(1).max(5000).default(1), ...instanceIdSchema },
  },
  async ({ count, instanceId }) => {
    const target = resolveInstance(instanceId);
    if (target) {
      await new Promise((resolve) => setTimeout(resolve, count * 20));
      return { content: [{ type: "text", text: `Waited ${count} frame(s) of real time on instance "${target}".` }] };
    }
    const m = requireMachine();
    for (let i = 0; i < count; i++) m.runFrame();
    return { content: [{ type: "text", text: `Ran ${count} frame(s).` }] };
  },
);

const KEY_NAMES = Object.keys(SPECTRUM_KEY_MATRIX) as [string, ...string[]];

server.registerTool(
  "press_key",
  {
    title: "Press/release a key",
    description:
      `Sets one Spectrum key up or down. Valid keys: ${KEY_NAMES.join(", ")}. ` +
      "A key must stay held for a few run_frames calls for the ROM's keyboard scan to " +
      "register it — press down, run_frames, then press up.",
    inputSchema: { key: z.enum(KEY_NAMES), down: z.boolean(), ...instanceIdSchema },
  },
  async ({ key, down, instanceId }) => {
    const { row, bit } = SPECTRUM_KEY_MATRIX[key]!;
    const target = resolveInstance(instanceId);
    if (target) await callInstance(target, "keyEvent", { row, bit, down });
    else requireMachine().keyboard.setKey(row, bit, down);
    return { content: [{ type: "text", text: `${key} ${down ? "pressed" : "released"}.` }] };
  },
);

server.registerTool(
  "type_text",
  {
    title: "Type text",
    description:
      "Types a string on a connected browser instance as a fast sequence of key taps, " +
      "timed entirely on the browser side so it's immune to the multi-second real-time " +
      "gaps between separate press_key calls (which otherwise trigger the ROM's own " +
      "key-repeat and spam the input line). Same semantics as physical typing: letters " +
      "produce a keyword or a literal letter depending on the ROM's current cursor mode. " +
      "Supports A-Z/a-z, 0-9, space, \\n (Enter), and the punctuation in SYMBOL_SHIFT_CHARS " +
      "(notably \" for LOAD \"\"). Headless machines don't need this — press_key + " +
      "run_frames already step deterministically with no real time passing between calls.",
    inputSchema: { text: z.string(), ...instanceIdSchema },
  },
  async ({ text, instanceId }) => {
    const target = resolveInstance(instanceId);
    if (!target) {
      throw new Error("type_text requires a connected browser instance — use press_key/run_frames for the headless machine.");
    }
    await callInstance(target, "typeText", { text });
    return { content: [{ type: "text", text: `Typed ${JSON.stringify(text)} on instance "${target}".` }] };
  },
);

server.registerTool(
  "read_screen",
  {
    title: "Read screen",
    description:
      "Renders the current frame as a PNG screenshot. Uses a connected browser instance " +
      "if one is live (see list_instances), otherwise the headless machine. " +
      "Pass savePath to also write the PNG to disk (absolute path, or relative to the " +
      "mcp-server process cwd).",
    inputSchema: { ...instanceIdSchema, savePath: z.string().optional() },
  },
  async ({ instanceId, savePath }) => {
    const target = resolveInstance(instanceId);
    let pngBase64: string;
    if (target) {
      ({ pngBase64 } = (await callInstance(target, "readScreen")) as { pngBase64: string });
    } else {
      const m = requireMachine();
      const { pixels, width, height } = m.getFrameBuffer();
      pngBase64 = encodeIndexedFramePng(pixels, width, height, SPECTRUM_PALETTE_RGB).toString("base64");
    }
    if (savePath) writeFileSync(savePath, Buffer.from(pngBase64, "base64"));
    return {
      content: [
        { type: "image" as const, data: pngBase64, mimeType: "image/png" },
        ...(savePath ? [{ type: "text" as const, text: `Saved to ${savePath}` }] : []),
      ],
    };
  },
);

server.registerTool(
  "save_snapshot",
  {
    title: "Save snapshot",
    description:
      "Captures the current machine state as a .sna file (48K or 128K format, matching " +
      "whichever model is currently active) and writes it to savePath. Uses a connected " +
      "browser instance if one is live (see list_instances), otherwise the headless machine.",
    inputSchema: { ...instanceIdSchema, savePath: z.string() },
  },
  async ({ instanceId, savePath }) => {
    const target = resolveInstance(instanceId);
    let dataBase64: string;
    if (target) {
      ({ dataBase64 } = (await callInstance(target, "saveSnapshot")) as {
        format: "sna";
        dataBase64: string;
      });
    } else {
      const m = requireMachine();
      const border = m.ula.borderColor;
      const bytes = model === "48k" ? writeSna48k(m as Machine48k, border) : writeSna128k(m as Machine128k, border);
      dataBase64 = Buffer.from(bytes).toString("base64");
    }
    writeFileSync(savePath, Buffer.from(dataBase64, "base64"));
    return { content: [{ type: "text", text: `Saved snapshot to ${savePath}` }] };
  },
);

server.registerTool(
  "get_status",
  {
    title: "Get status",
    description:
      "Reports the current machine's model and tape status. Uses a connected browser " +
      "instance if one is live, otherwise the headless machine (which also reports CPU PC/T-states).",
    inputSchema: instanceIdSchema,
  },
  async ({ instanceId }) => {
    const target = resolveInstance(instanceId);
    if (target) {
      const status = (await callInstance(target, "getStatus")) as Record<string, unknown>;
      return { content: [{ type: "text", text: JSON.stringify({ instanceId: target, ...status }, null, 2) }] };
    }
    if (!machine || !model) {
      return { content: [{ type: "text", text: "No ROM loaded yet." }] };
    }
    const status = {
      model,
      pc: `0x${machine.cpu.regs.pc.toString(16)}`,
      tapePlaying: machine.tape.isPlaying(),
      totalTStates: machine.totalTStates,
    };
    return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
  },
);

server.registerTool(
  "list_instances",
  {
    title: "List connected instances",
    description:
      "Lists connected browser instance IDs (each browser tab running the app shows its " +
      "ID next to the MCP connection indicator). Pass one as instanceId to other tools to " +
      "target it explicitly; tools auto-target the sole connected instance, or fall back " +
      "to a private headless machine, when none is given.",
  },
  () => {
    const ids = connectedInstanceIds();
    return {
      content: [{ type: "text", text: ids.length ? ids.join(", ") : "(none connected — tools will use the headless machine)" }],
    };
  },
);

const transport = new StdioServerTransport();
// Wrapped in an async IIFE rather than top-level await so the module would still
// load if ever imported from a CommonJS context (top-level await is ESM-only).
void (async () => {
  try {
    await server.connect(transport);
  } catch (err) {
    console.error(`MCP server failed to start: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
})();
