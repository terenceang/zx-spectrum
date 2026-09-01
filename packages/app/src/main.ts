import {
  MCP_BRIDGE_PORT,
  SNAPSHOT_EXTENSIONS,
  TAPE_EXTENSIONS,
  type BridgeCommand as McpBridgeCommand,
} from "@zx-spectrum/core";
import type { MachineModel } from "../../worker/src/protocol.js";
import { AudioSink } from "./audio/audioSink.js";
import { CAPS_SHIFT, KEY_MAP, SYMBOL_CHAR_MAP, SYMBOL_SHIFT } from "./input/keyMapping.js";
import { Display } from "./ui/display.js";
import { loadRom as loadCachedRom, saveRom } from "./ui/romStore.js";
import { EmulatorClient } from "./worker-client.js";

const canvas = document.getElementById("screen") as HTMLCanvasElement;
const modelSelect = document.getElementById("model-select") as HTMLSelectElement;
const normalKeyboardToggle = document.getElementById("normal-keyboard-toggle") as HTMLInputElement;
const romInput = document.getElementById("rom-input") as HTMLInputElement;
const snapshotInput = document.getElementById("snapshot-input") as HTMLInputElement;
const pauseBtn = document.getElementById("pause-btn") as HTMLButtonElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;
const tapeBtn = document.getElementById("tape-btn") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLDivElement;

const display = new Display(canvas);
const client = new EmulatorClient();
const audio = new AudioSink();

let paused = false;
let audioStarted = false;
let romLoaded = false;
let tapePlaying = false;

function currentModel(): MachineModel {
  return modelSelect.value as MachineModel;
}

client.onError = (message) => {
  status.textContent = `Error: ${message}`;
};
client.onTapeStatus = (playing) => {
  tapePlaying = playing;
  tapeBtn.textContent = playing ? "Stop Tape" : "Play Tape";
  status.textContent = playing ? "Tape playing…" : "Tape stopped.";
};

async function ensureAudioStarted(): Promise<void> {
  if (audioStarted) return;
  audioStarted = true;
  await audio.start(client);
}

async function tryLoadCachedRom(): Promise<void> {
  const model = currentModel();
  const cached = await loadCachedRom(model);
  if (cached) {
    client.loadRom(model, cached.slice(0)); // slice: loadRom transfers its argument
    romLoaded = true;
    status.textContent = "ROM loaded from cache. Load a .sna/.z80/.tap/.tzx file to play.";
  } else {
    romLoaded = false;
    const hint = model === "48k" ? "a 48K ROM file" : "both 128K ROM files (128-0.rom, 128-1.rom)";
    status.textContent = `Load ${hint} to begin (never bundled — see README).`;
  }
}

async function loadMediaFile(file: File): Promise<void> {
  if (!romLoaded) {
    status.textContent = "Load a ROM first.";
    return;
  }
  const name = file.name.toLowerCase();
  const data = await file.arrayBuffer();

  const snapshotExt = Object.keys(SNAPSHOT_EXTENSIONS).find((ext) => name.endsWith(ext));
  const tapeExt = Object.keys(TAPE_EXTENSIONS).find((ext) => name.endsWith(ext));

  if (snapshotExt) {
    client.loadSnapshot(SNAPSHOT_EXTENSIONS[snapshotExt as keyof typeof SNAPSHOT_EXTENSIONS], data);
  } else if (tapeExt) {
    client.loadTape(TAPE_EXTENSIONS[tapeExt as keyof typeof TAPE_EXTENSIONS], data);
  } else {
    status.textContent = `Unrecognized file type: "${file.name}" (expected .sna/.z80/.tap/.tzx)`;
    return;
  }

  status.textContent = `Loaded "${file.name}".`;
  paused = false;
  pauseBtn.textContent = "Pause";
  await ensureAudioStarted();
}

romInput.addEventListener("change", async () => {
  const files = Array.from(romInput.files ?? []);
  if (files.length === 0) return;
  const model = currentModel();

  let data: ArrayBuffer;
  if (model === "48k") {
    if (files.length !== 1) {
      status.textContent = "48K needs exactly one ROM file.";
      return;
    }
    data = await files[0]!.arrayBuffer();
  } else {
    if (files.length !== 2) {
      status.textContent = "128K needs exactly two ROM files (128-0.rom, 128-1.rom).";
      return;
    }
    // Sorted by filename so "128-0.rom"/"128-1.rom" land in the right order regardless
    // of selection order — ROM 0 (128 editor) must come before ROM 1 (48 BASIC).
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
    const [rom0, rom1] = await Promise.all(sorted.map((f) => f.arrayBuffer()));
    const combined = new Uint8Array(rom0!.byteLength + rom1!.byteLength);
    combined.set(new Uint8Array(rom0!), 0);
    combined.set(new Uint8Array(rom1!), rom0!.byteLength);
    data = combined.buffer;
  }

  await saveRom(model, data.slice(0));
  client.loadRom(model, data);
  romLoaded = true;
  status.textContent = `${model.toUpperCase()} ROM loaded.`;
  await ensureAudioStarted();
});

modelSelect.addEventListener("change", () => {
  romLoaded = false;
  void tryLoadCachedRom();
});

snapshotInput.addEventListener("change", async () => {
  const file = snapshotInput.files?.[0];
  if (file) await loadMediaFile(file);
});

document.body.addEventListener("dragover", (e) => e.preventDefault());
document.body.addEventListener("drop", async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) await loadMediaFile(file);
});

pauseBtn.addEventListener("click", () => {
  paused = !paused;
  if (paused) {
    client.pause();
    audio.suspend();
    pauseBtn.textContent = "Resume";
  } else {
    client.resume();
    audio.resume();
    pauseBtn.textContent = "Pause";
  }
});

resetBtn.addEventListener("click", () => {
  client.reset();
});

// Play restarts from the beginning of the loaded tape (TapeEdgePlayer.start()
// always rewinds) — stop just pauses playback at the current pulse.
tapeBtn.addEventListener("click", () => {
  if (tapePlaying) client.stopTape();
  else client.playTape();
});

// "Normal keyboard" mode: which PC key (by e.code) is currently driving a
// SYMBOL SHIFT combo, so keyup can release the same matrix key regardless of
// what e.key reports by then (irrelevant here, but keeps the two handlers
// symmetric and avoids relying on key-repeat quirks).
const activeSymbolKeys = new Map<string, { row: number; bit: number }>();

window.addEventListener("keydown", (e) => {
  if (normalKeyboardToggle.checked) {
    const target = SYMBOL_CHAR_MAP[e.key];
    if (target) {
      e.preventDefault();
      // The PC Shift that produced this character (e.g. Shift+2 -> "@") already
      // sent CAPS SHIFT down via its own keydown event — cancel it so the
      // Spectrum sees plain SYMBOL SHIFT+key, not CAPS+SYMBOL SHIFT+key (which
      // means something else entirely, extended-mode keyword entry).
      client.sendKey(CAPS_SHIFT.row, CAPS_SHIFT.bit, false);
      client.sendKey(SYMBOL_SHIFT.row, SYMBOL_SHIFT.bit, true);
      client.sendKey(target.row, target.bit, true);
      activeSymbolKeys.set(e.code, target);
      return;
    }
  }
  const matrixKeys = KEY_MAP[e.code];
  if (!matrixKeys) return;
  e.preventDefault();
  for (const { row, bit } of matrixKeys) client.sendKey(row, bit, true);
});
window.addEventListener("keyup", (e) => {
  const activeSymbol = activeSymbolKeys.get(e.code);
  if (activeSymbol) {
    e.preventDefault();
    client.sendKey(activeSymbol.row, activeSymbol.bit, false);
    client.sendKey(SYMBOL_SHIFT.row, SYMBOL_SHIFT.bit, false);
    activeSymbolKeys.delete(e.code);
    return;
  }
  const matrixKeys = KEY_MAP[e.code];
  if (!matrixKeys) return;
  e.preventDefault();
  for (const { row, bit } of matrixKeys) client.sendKey(row, bit, false);
});

function frameLoop(): void {
  const frame = client.pollFrame();
  if (frame) display.render(frame);
  audio.pumpFallbackAudio(client);
  requestAnimationFrame(frameLoop);
}

client.onReady = () => {
  requestAnimationFrame(frameLoop);
};

void tryLoadCachedRom();

// MCP bridge: lets the zx-spectrum MCP server (packages/mcp-server) drive this
// tab directly instead of its own private headless machine.
const mcpInstanceId = Math.random().toString(36).slice(2, 8);

const mcpIndicator = document.getElementById("mcp-indicator") as HTMLDivElement;
const mcpIndicatorText = document.getElementById("mcp-indicator-text") as HTMLSpanElement;

function setMcpConnected(connected: boolean): void {
  mcpIndicator.classList.toggle("connected", connected);
  mcpIndicatorText.textContent = `MCP: ${connected ? "connected" : "offline"} (${mcpInstanceId})`;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function handleMcpCommand(message: McpBridgeCommand): Promise<unknown> {
  switch (message.cmd) {
    case "getStatus":
      return { model: currentModel(), romLoaded, paused, tapePlaying };
    case "readScreen":
      return { pngBase64: canvas.toDataURL("image/png").split(",")[1] };
    case "loadRom":
      client.loadRom(message.model, base64ToArrayBuffer(message.romBase64));
      romLoaded = true;
      return null;
    case "loadSnapshot":
      client.loadSnapshot(message.format, base64ToArrayBuffer(message.dataBase64));
      return null;
    case "loadTape":
      client.loadTape(message.format, base64ToArrayBuffer(message.dataBase64));
      return null;
    case "playTape":
      client.playTape();
      return null;
    case "stopTape":
      client.stopTape();
      return null;
    case "reset":
      client.reset();
      return null;
    case "keyEvent":
      client.sendKey(message.row, message.bit, message.down);
      return null;
    case "typeText":
      await typeText(message.text);
      return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Types a string via short, precisely-timed key taps, same matrix keys a physical
 * keyboard would send (see KEY_MAP/SYMBOL_CHAR_MAP above) — letters trigger a keyword
 * or a literal letter depending on the ROM's current cursor mode, exactly as on real
 * hardware. Driven entirely by this function's own setTimeout calls rather than
 * separate MCP round-trips, so the ROM's key-repeat never gets a multi-second-real-time
 * window to fire (the bug this replaces: press_key down/up from an LLM caller are
 * separate tool calls with unpredictable real-time gaps between them). */
async function typeText(text: string): Promise<void> {
  for (const ch of text) {
    const code =
      ch === "\n" ? "Enter" : ch === " " ? "Space" : /[a-zA-Z]/.test(ch) ? `Key${ch.toUpperCase()}` : /[0-9]/.test(ch) ? `Digit${ch}` : null;
    const plainKeys = code ? KEY_MAP[code] : undefined;
    if (plainKeys) {
      for (const { row, bit } of plainKeys) client.sendKey(row, bit, true);
      await sleep(60);
      for (const { row, bit } of plainKeys) client.sendKey(row, bit, false);
      await sleep(40);
      continue;
    }
    const symbol = SYMBOL_CHAR_MAP[ch];
    if (!symbol) throw new Error(`type_text: unsupported character ${JSON.stringify(ch)}`);
    client.sendKey(CAPS_SHIFT.row, CAPS_SHIFT.bit, false);
    client.sendKey(SYMBOL_SHIFT.row, SYMBOL_SHIFT.bit, true);
    client.sendKey(symbol.row, symbol.bit, true);
    await sleep(60);
    client.sendKey(symbol.row, symbol.bit, false);
    client.sendKey(SYMBOL_SHIFT.row, SYMBOL_SHIFT.bit, false);
    await sleep(40);
  }
}

function connectMcpBridge(): void {
  const ws = new WebSocket(`ws://localhost:${MCP_BRIDGE_PORT}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "hello", instanceId: mcpInstanceId }));
    setMcpConnected(true);
  };
  ws.onclose = () => {
    setMcpConnected(false);
    setTimeout(connectMcpBridge, 2000);
  };
  ws.onmessage = async (event) => {
    const message = JSON.parse(event.data as string) as McpBridgeCommand;
    try {
      const result = await handleMcpCommand(message);
      ws.send(JSON.stringify({ reqId: message.reqId, ok: true, result }));
    } catch (err) {
      ws.send(JSON.stringify({ reqId: message.reqId, ok: false, error: err instanceof Error ? err.message : String(err) }));
    }
  };
}

connectMcpBridge();
