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
import {
  loadLastModel,
  loadSessionMedia,
  loadSessionRom,
  saveLastModel,
  saveSessionMedia,
  saveSessionRom,
} from "./ui/sessionStore.js";
import { EmulatorClient } from "./worker-client.js";

const canvas = document.getElementById("screen") as HTMLCanvasElement;
const modelSelect = document.getElementById("model-select") as HTMLSelectElement;
const normalKeyboardToggle = document.getElementById("normal-keyboard-toggle") as HTMLInputElement;
const tapeSoundToggle = document.getElementById("tape-sound-toggle") as HTMLInputElement | null;
const romInput = document.getElementById("rom-input") as HTMLInputElement;
const romFileText = document.getElementById("rom-file-text") as HTMLSpanElement | null;
const snapshotInput = document.getElementById("snapshot-input") as HTMLInputElement;
const mediaFileText = document.getElementById("media-file-text") as HTMLSpanElement | null;
const pauseBtn = document.getElementById("pause-btn") as HTMLButtonElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;
const tapeBtn = document.getElementById("tape-btn") as HTMLButtonElement;
const muteBtn = document.getElementById("mute-btn") as HTMLButtonElement | null;
const volumeIcon = document.getElementById("volume-icon") as SVGElement | null;
const volumeSlider = document.getElementById("volume-slider") as HTMLInputElement | null;
const volumeValue = document.getElementById("volume-value") as HTMLSpanElement | null;
const status = document.getElementById("status") as HTMLDivElement;

const savedVolume = parseFloat(localStorage.getItem("zx_spectrum_volume") ?? "0.5");
const savedMuted = localStorage.getItem("zx_spectrum_muted") === "true";
const initialVolume = isNaN(savedVolume) ? 0.5 : Math.max(0, Math.min(1, savedVolume));

const display = new Display(canvas);
const client = new EmulatorClient();
const audio = new AudioSink(initialVolume, savedMuted);

function updateVolumeUi(): void {
  const isMuted = audio.isMuted();
  const vol = audio.getVolume();
  const percent = Math.round(vol * 100);

  if (volumeSlider) volumeSlider.value = isMuted ? "0" : percent.toString();
  if (volumeValue) volumeValue.textContent = isMuted ? "Muted" : `${percent}%`;

  if (volumeIcon) {
    if (isMuted || vol === 0) {
      volumeIcon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <line x1="23" y1="9" x2="17" y2="15"></line>
        <line x1="17" y1="9" x2="23" y2="15"></line>
      `;
      muteBtn?.setAttribute("title", "Unmute audio");
    } else if (vol < 0.5) {
      volumeIcon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      `;
      muteBtn?.setAttribute("title", "Mute audio");
    } else {
      volumeIcon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
      `;
      muteBtn?.setAttribute("title", "Mute audio");
    }
  }
}

updateVolumeUi();

volumeSlider?.addEventListener("input", async () => {
  const val = parseInt(volumeSlider.value, 10);
  const vol = Math.max(0, Math.min(1, val / 100));
  audio.setVolume(vol);
  if (audio.isMuted() && vol > 0) {
    audio.setMuted(false);
  }
  localStorage.setItem("zx_spectrum_volume", vol.toString());
  localStorage.setItem("zx_spectrum_muted", audio.isMuted().toString());
  updateVolumeUi();
  await ensureAudioStarted();
});

muteBtn?.addEventListener("click", async () => {
  audio.toggleMute();
  localStorage.setItem("zx_spectrum_muted", audio.isMuted().toString());
  updateVolumeUi();
  await ensureAudioStarted();
});

const savedTapeSound = localStorage.getItem("zx_spectrum_tape_sound") !== "false";
if (tapeSoundToggle) tapeSoundToggle.checked = savedTapeSound;
client.setTapeSound(savedTapeSound);

tapeSoundToggle?.addEventListener("change", () => {
  const enabled = tapeSoundToggle.checked;
  localStorage.setItem("zx_spectrum_tape_sound", enabled.toString());
  client.setTapeSound(enabled);
});

let paused = false;
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
  await audio.start(client);
  await audio.resume();
}

function updateModelPrompt(): void {
  romLoaded = false;
  romInput.value = "";
  const model = currentModel();
  if (romFileText) romFileText.textContent = "Choose ROM…";
  if (mediaFileText) mediaFileText.textContent = "Tape/Snapshot…";
  const hint = model === "48k" ? "a 48K ROM file" : "both 128K ROM files (128-0.rom, 128-1.rom)";
  status.textContent = `Load ${hint} to begin.`;
}

async function restoreSession(): Promise<void> {
  const lastModel = await loadLastModel();
  if (lastModel && (lastModel === "48k" || lastModel === "128k")) {
    modelSelect.value = lastModel;
  }
  const model = currentModel();
  const storedRom = await loadSessionRom(model);

  if (storedRom) {
    client.loadRom(model, storedRom.data.slice(0));
    client.reset();
    client.resume();
    romLoaded = true;
    if (romFileText) romFileText.textContent = storedRom.filename;

    const storedMedia = await loadSessionMedia();
    if (storedMedia) {
      if (storedMedia.format === "sna" || storedMedia.format === "z80") {
        client.loadSnapshot(storedMedia.format, storedMedia.data.slice(0));
      } else {
        client.loadTape(storedMedia.format, storedMedia.data.slice(0));
      }
      if (mediaFileText) mediaFileText.textContent = storedMedia.filename;
      status.textContent = `${model.toUpperCase()} ROM restored (${storedRom.filename}). Loaded "${storedMedia.filename}". Ready.`;
    } else {
      status.textContent = `${model.toUpperCase()} ROM restored (${storedRom.filename}). Load a snapshot or tape to play.`;
    }
    await ensureAudioStarted();
  } else {
    updateModelPrompt();
  }
}

async function loadRomFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const model = currentModel();

  if (romLoaded) {
    const ok = window.confirm("A ROM is already loaded. Replace it and reset the emulator?");
    if (!ok) {
      romInput.value = "";
      return;
    }
  }

  let data: ArrayBuffer;
  let filename = "";

  if (model === "48k") {
    if (files.length !== 1) {
      status.textContent = "48K needs exactly one ROM file.";
      romInput.value = "";
      return;
    }
    data = await files[0]!.arrayBuffer();
    filename = files[0]!.name;
    if (romFileText) romFileText.textContent = filename;
  } else {
    if (files.length !== 2) {
      status.textContent = "128K needs exactly two ROM files (128-0.rom, 128-1.rom).";
      romInput.value = "";
      return;
    }
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
    const [rom0, rom1] = await Promise.all(sorted.map((f) => f.arrayBuffer()));
    const combined = new Uint8Array(rom0!.byteLength + rom1!.byteLength);
    combined.set(new Uint8Array(rom0!), 0);
    combined.set(new Uint8Array(rom1!), rom0!.byteLength);
    data = combined.buffer;
    filename = sorted.map((f) => f.name).join(", ");
    if (romFileText) romFileText.textContent = filename;
  }

  await saveSessionRom({ model, filename, data: data.slice(0) });
  await saveLastModel(model);

  client.loadRom(model, data);
  client.reset();
  client.resume();
  romLoaded = true;
  paused = false;
  pauseBtn.textContent = "Pause";
  status.textContent = `${model.toUpperCase()} ROM loaded and reset. Load a snapshot or tape to play.`;
  await ensureAudioStarted();
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
    const format = SNAPSHOT_EXTENSIONS[snapshotExt as keyof typeof SNAPSHOT_EXTENSIONS];
    client.loadSnapshot(format, data);
    if (mediaFileText) mediaFileText.textContent = file.name;
    await saveSessionMedia({ filename: file.name, format, data: data.slice(0) });
  } else if (tapeExt) {
    const format = TAPE_EXTENSIONS[tapeExt as keyof typeof TAPE_EXTENSIONS];
    client.loadTape(format, data);
    if (mediaFileText) mediaFileText.textContent = file.name;
    await saveSessionMedia({ filename: file.name, format, data: data.slice(0) });
  } else {
    status.textContent = `Unrecognized file type: "${file.name}" (expected .sna/.z80/.tap/.tzx)`;
    return;
  }

  status.textContent = `Loaded "${file.name}". Ready.`;
  paused = false;
  pauseBtn.textContent = "Pause";
  await ensureAudioStarted();
}

romInput.addEventListener("change", async () => {
  const files = Array.from(romInput.files ?? []);
  await loadRomFiles(files);
});

modelSelect.addEventListener("change", async () => {
  const model = currentModel();
  await saveLastModel(model);
  const storedRom = await loadSessionRom(model);
  if (storedRom) {
    client.loadRom(model, storedRom.data.slice(0));
    client.reset();
    client.resume();
    romLoaded = true;
    if (romFileText) romFileText.textContent = storedRom.filename;
    status.textContent = `${model.toUpperCase()} ROM loaded from cache (${storedRom.filename}).`;
    await ensureAudioStarted();
  } else {
    updateModelPrompt();
  }
});

snapshotInput.addEventListener("change", async () => {
  const file = snapshotInput.files?.[0];
  if (file) await loadMediaFile(file);
});

document.body.addEventListener("dragover", (e) => e.preventDefault());
document.body.addEventListener("drop", async (e) => {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;

  const first = files[0]!;
  const name = first.name.toLowerCase();

  if (name.endsWith(".rom") || name.endsWith(".bin")) {
    await loadRomFiles(Array.from(files));
  } else {
    await loadMediaFile(first);
  }
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
  status.textContent = "System reset.";
});

tapeBtn.addEventListener("click", () => {
  if (tapePlaying) client.stopTape();
  else client.playTape();
});

// Ensure audio starts on the first user gesture (click/pointer or keydown)
window.addEventListener("pointerdown", () => {
  void ensureAudioStarted();
});

// PC keyboard -> Matrix mapping
const activeSymbolKeys = new Map<string, { row: number; bit: number }>();

window.addEventListener("keydown", (e) => {
  void ensureAudioStarted();
  if (normalKeyboardToggle.checked) {
    const target = SYMBOL_CHAR_MAP[e.key];
    if (target) {
      e.preventDefault();
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

void restoreSession();

// MCP bridge
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
      client.reset();
      client.resume();
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
