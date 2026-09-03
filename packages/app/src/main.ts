import {
  MCP_BRIDGE_PORT,
  ROM_PAGE_SIZE,
  SNAPSHOT_EXTENSIONS,
  TAPE_EXTENSIONS,
  type BridgeCommand as McpBridgeCommand,
  type MachineModel,
} from "@zx-spectrum/core";
import { AudioSink } from "./audio/audioSink.js";
import { CAPS_SHIFT, KEY_MAP, SYMBOL_CHAR_MAP, SYMBOL_SHIFT } from "./input/keyMapping.js";
import { Display } from "./ui/display.js";
import { loadSessionMedia, saveSessionMedia } from "./ui/sessionStore.js";
import {
  loadRom as loadRomFromStorage,
  saveRom as saveRomToStorage,
  loadLastModel as loadLastModelFromStorage,
} from "./ui/romStorage.js";
import { EmulatorClient } from "./worker-client.js";
import { base64ToArrayBuffer } from "./utils/base64.js";

const canvas = document.getElementById("screen") as HTMLCanvasElement;
const modelSelect = document.getElementById("model-select") as HTMLSelectElement;
const normalKeyboardToggle = document.getElementById("normal-keyboard-toggle") as HTMLInputElement;
const tapeSoundToggle = document.getElementById("tape-sound-toggle") as HTMLInputElement | null;
const fastTapeToggle = document.getElementById("fast-tape-toggle") as HTMLInputElement | null;
const snapshotInput = document.getElementById("snapshot-input") as HTMLInputElement;
const mediaFileText = document.getElementById("media-file-text") as HTMLSpanElement | null;
const pauseBtn = document.getElementById("pause-btn") as HTMLButtonElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;
const tapeBtn = document.getElementById("tape-btn") as HTMLButtonElement;
const tapeEjectBtn = document.getElementById("tape-eject-btn") as HTMLButtonElement | null;
const muteBtn = document.getElementById("mute-btn") as HTMLButtonElement | null;
const volumeIcon = document.getElementById("volume-icon") as SVGElement | null;
const volumeSlider = document.getElementById("volume-slider") as HTMLInputElement | null;
const volumeValue = document.getElementById("volume-value") as HTMLSpanElement | null;
const status = document.getElementById("status") as HTMLDivElement;

// Setup modal elements
const setupModal = document.getElementById("setup-modal") as HTMLDivElement;
const modalModelSelect = document.getElementById("modal-model-select") as HTMLSelectElement;
const modalRomInput = document.getElementById("modal-rom-input") as HTMLInputElement;
const modalRomText = document.getElementById("modal-rom-text") as HTMLSpanElement;
const modalStartBtn = document.getElementById("modal-start-btn") as HTMLButtonElement;
const modalError = document.getElementById("modal-error") as HTMLDivElement;

let modalRomData: ArrayBuffer | null = null;
let modalRomFilename = "";

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

const savedFastTape = localStorage.getItem("zx_spectrum_fast_tape_load") === "true";
if (fastTapeToggle) fastTapeToggle.checked = savedFastTape;
client.setFastTapeLoad(savedFastTape);

fastTapeToggle?.addEventListener("change", () => {
  const enabled = fastTapeToggle.checked;
  localStorage.setItem("zx_spectrum_fast_tape_load", enabled.toString());
  client.setFastTapeLoad(enabled);
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

function updatePauseUi(): void {
  const pauseIcon = pauseBtn.querySelector(".icon-pause") as SVGElement | null;
  const playIcon = pauseBtn.querySelector(".icon-play") as SVGElement | null;
  if (paused) {
    if (pauseIcon) pauseIcon.style.display = "none";
    if (playIcon) playIcon.style.display = "block";
    pauseBtn.setAttribute("title", "Resume emulation");
    pauseBtn.setAttribute("aria-label", "Resume emulation");
  } else {
    if (pauseIcon) pauseIcon.style.display = "block";
    if (playIcon) playIcon.style.display = "none";
    pauseBtn.setAttribute("title", "Pause emulation");
    pauseBtn.setAttribute("aria-label", "Pause emulation");
  }
}

function updateTapeUi(): void {
  const playIcon = tapeBtn.querySelector(".icon-tape-play") as SVGElement | null;
  const stopIcon = tapeBtn.querySelector(".icon-tape-stop") as SVGElement | null;
  if (tapePlaying) {
    if (playIcon) playIcon.style.display = "none";
    if (stopIcon) stopIcon.style.display = "block";
    tapeBtn.setAttribute("title", "Stop tape");
    tapeBtn.setAttribute("aria-label", "Stop tape");
    tapeBtn.classList.add("playing");
  } else {
    if (playIcon) playIcon.style.display = "block";
    if (stopIcon) stopIcon.style.display = "none";
    tapeBtn.setAttribute("title", "Play tape");
    tapeBtn.setAttribute("aria-label", "Play tape");
    tapeBtn.classList.remove("playing");
  }
}

client.onTapeStatus = (playing) => {
  tapePlaying = playing;
  updateTapeUi();
  status.textContent = playing ? "Tape playing…" : "Tape stopped.";
};

async function ensureAudioStarted(): Promise<void> {
  await audio.start(client);
  await audio.resume();
}

function showSetupModal(): void {
  setupModal.style.display = "flex";
  modalRomData = null;
  modalRomFilename = "";
  modalRomInput.value = "";
  modalRomText.textContent = "Choose ROM file(s)…";
  modalStartBtn.disabled = true;
  modalError.style.display = "none";
  const model = currentModel();
  modalModelSelect.value = model;
}

function hideSetupModal(): void {
  setupModal.style.display = "none";
}

function updateModalStartBtn(): void {
  modalStartBtn.disabled = modalRomData === null;
}

function formatRomFilename(model: string, files: File[]): string {
  return model === "48k"
    ? files[0]!.name
    : [...files]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => f.name)
        .join(", ");
}

function validateRomFiles(
  model: string,
  files: File[],
): { ok: boolean; data?: ArrayBuffer; error?: string } {
  if (model === "48k") {
    if (files.length !== 1) {
      return { ok: false, error: "48K requires exactly one ROM file." };
    }
    if (files[0]!.size !== ROM_PAGE_SIZE) {
      return {
        ok: false,
        error: `Invalid 48K ROM size: ${files[0]!.size} bytes (expected ${ROM_PAGE_SIZE}).`,
      };
    }
    return { ok: true };
  } else {
    if (files.length !== 2) {
      return { ok: false, error: "128K requires exactly two ROM files (128-0.rom, 128-1.rom)." };
    }
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
    if (sorted[0]!.size !== ROM_PAGE_SIZE || sorted[1]!.size !== ROM_PAGE_SIZE) {
      return { ok: false, error: `Invalid 128K ROM size (each must be ${ROM_PAGE_SIZE} bytes).` };
    }
    return { ok: true };
  }
}

async function readRomFiles(model: string, files: File[]): Promise<ArrayBuffer> {
  if (model === "48k") {
    return files[0]!.arrayBuffer();
  } else {
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
    const [rom0, rom1] = await Promise.all(sorted.map((f) => f.arrayBuffer()));
    if (!rom0 || !rom1) throw new Error("Failed to read ROM files");
    const combined = new Uint8Array(rom0.byteLength + rom1.byteLength);
    combined.set(new Uint8Array(rom0), 0);
    combined.set(new Uint8Array(rom1), rom0.byteLength);
    return combined.buffer;
  }
}

async function restoreSession(): Promise<void> {
  const lastModel = loadLastModelFromStorage();
  if (lastModel) {
    modelSelect.value = lastModel;
  }
  const model = currentModel();
  const storedRom = loadRomFromStorage(model);

  if (storedRom) {
    client.loadRom(model, storedRom.data.slice(0));
    client.reset();
    client.resume();
    romLoaded = true;

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
    showSetupModal();
  }
}

async function loadRomFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const model = currentModel();

  if (romLoaded) {
    const ok = window.confirm("A ROM is already loaded. Replace it and reset the emulator?");
    if (!ok) return;
  }

  const validation = validateRomFiles(model, files);
  if (!validation.ok) {
    status.textContent = validation.error!;
    return;
  }

  const data = await readRomFiles(model, files);
  const filename = formatRomFilename(model, files);

  saveRomToStorage({ model, filename, data: data.slice(0) });

  client.loadRom(model, data);
  client.reset();
  client.resume();
  romLoaded = true;
  paused = false;
  updatePauseUi();
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
    if (fastTapeToggle) fastTapeToggle.checked = true;
    localStorage.setItem("zx_spectrum_fast_tape_load", "true");
    client.setFastTapeLoad(true);

    client.loadTape(format, data, true);
    if (mediaFileText) mediaFileText.textContent = file.name;
    await saveSessionMedia({ filename: file.name, format, data: data.slice(0) });
    status.textContent = `Loaded "${file.name}". Instant loading…`;
    paused = false;
    updatePauseUi();
    await ensureAudioStarted();
    return;
  } else {
    status.textContent = `Unrecognized file type: "${file.name}" (expected .sna/.z80/.tap/.tzx)`;
    return;
  }

  status.textContent = `Loaded "${file.name}". Ready.`;
  paused = false;
  updatePauseUi();
  await ensureAudioStarted();
}

let previousModel: MachineModel = currentModel();
let rafHandle = 0;
let frameLoopRunning = false;

modelSelect.addEventListener("change", async () => {
  const model = currentModel();

  if (romLoaded) {
    const ok = window.confirm(`Switch to ${model.toUpperCase()}? This will reset the emulator.`);
    if (!ok) {
      modelSelect.value = previousModel;
      return;
    }
  }

  previousModel = model;
  localStorage.setItem("zx_spectrum_last_model", model);
  const storedRom = loadRomFromStorage(model);
  if (storedRom) {
    client.loadRom(model, storedRom.data.slice(0));
    client.reset();
    client.resume();
    romLoaded = true;
    status.textContent = `${model.toUpperCase()} ROM loaded from cache (${storedRom.filename}).`;
    await ensureAudioStarted();
  } else {
    showSetupModal();
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

// Setup modal event listeners
modalModelSelect.addEventListener("change", () => {
  modalRomData = null;
  modalRomFilename = "";
  modalRomInput.value = "";
  modalRomText.textContent = "Choose ROM file(s)…";
  modalError.style.display = "none";
  updateModalStartBtn();
});

modalRomInput.addEventListener("change", async () => {
  const files = Array.from(modalRomInput.files ?? []);
  if (files.length === 0) {
    modalRomData = null;
    modalRomFilename = "";
    modalRomText.textContent = "Choose ROM file(s)…";
    modalError.style.display = "none";
    updateModalStartBtn();
    return;
  }

  const model = modalModelSelect.value;
  const validation = validateRomFiles(model, files);
  if (!validation.ok) {
    modalRomData = null;
    modalRomFilename = "";
    modalRomText.textContent = "Choose ROM file(s)…";
    modalError.textContent = validation.error!;
    modalError.style.display = "block";
    updateModalStartBtn();
    return;
  }

  modalError.style.display = "none";
  const data = await readRomFiles(model, files);
  modalRomData = data;
  modalRomFilename = formatRomFilename(model, files);
  modalRomText.textContent = modalRomFilename;
  updateModalStartBtn();
});

modalStartBtn.addEventListener("click", async () => {
  if (!modalRomData) return;
  const model = modalModelSelect.value as MachineModel;

  modelSelect.value = model;
  localStorage.setItem("zx_spectrum_last_model", model);
  saveRomToStorage({ model, filename: modalRomFilename, data: modalRomData.slice(0) });

  client.loadRom(model, modalRomData);
  client.reset();
  client.resume();
  romLoaded = true;
  paused = false;
  updatePauseUi();
  status.textContent = `${model.toUpperCase()} ROM loaded and reset. Load a snapshot or tape to play.`;

  hideSetupModal();
  await ensureAudioStarted();
});

pauseBtn.addEventListener("click", () => {
  paused = !paused;
  if (paused) {
    client.pause();
    audio.suspend();
    cancelAnimationFrame(rafHandle);
  } else {
    client.resume();
    audio.resume();
    rafHandle = requestAnimationFrame(frameLoop);
  }
  updatePauseUi();
});

resetBtn.addEventListener("click", () => {
  client.reset();
  status.textContent = "System reset.";
});

tapeBtn.addEventListener("click", () => {
  if (tapePlaying) client.stopTape();
  else client.playTape();
});

tapeEjectBtn?.addEventListener("click", async () => {
  if (tapePlaying) client.stopTape();
  if (mediaFileText) mediaFileText.textContent = "Insert Tape…";
  snapshotInput.value = "";
  await saveSessionMedia(null);
  status.textContent = "Tape ejected.";
});

// Ensure audio starts on the first user gesture (pointerdown or keydown)
const onFirstGesture = (): void => {
  if (audio.getState() !== "running") void ensureAudioStarted();
};
window.addEventListener("pointerdown", onFirstGesture, { passive: true });

// PC keyboard -> Matrix mapping
const activeSymbolKeys = new Map<string, { row: number; bit: number }>();

window.addEventListener("keydown", (e) => {
  onFirstGesture();
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
  if (!paused) rafHandle = requestAnimationFrame(frameLoop);
}

client.onReady = () => {
  if (!frameLoopRunning) {
    frameLoopRunning = true;
    rafHandle = requestAnimationFrame(frameLoop);
  }
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
      if (fastTapeToggle) fastTapeToggle.checked = true;
      localStorage.setItem("zx_spectrum_fast_tape_load", "true");
      client.setFastTapeLoad(true);
      client.loadTape(message.format, base64ToArrayBuffer(message.dataBase64), message.autoStart ?? true);
      return null;
    case "playTape":
      client.playTape();
      return null;
    case "stopTape":
      client.stopTape();
      return null;
    case "setFastTapeLoad":
      client.setFastTapeLoad(message.enabled);
      if (fastTapeToggle) fastTapeToggle.checked = message.enabled;
      return null;
    case "reset":
      client.reset();
      return null;
    case "keyEvent": {
      const row = message.row;
      const bit = message.bit;
      if (row < 0 || row > 7 || bit < 0 || bit > 4) {
        throw new Error(`Invalid keyEvent: row ${row} bit ${bit} (expected row 0-7, bit 0-4)`);
      }
      client.sendKey(row, bit, message.down);
      return null;
    }
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
      ch === "\n"
        ? "Enter"
        : ch === " "
          ? "Space"
          : /[a-zA-Z]/.test(ch)
            ? `Key${ch.toUpperCase()}`
            : /[0-9]/.test(ch)
              ? `Digit${ch}`
              : null;
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

let mcpReconnectDelay = 2000;
const mcpReconnectMaxDelay = 30000;

function connectMcpBridge(): void {
  const ws = new WebSocket(`ws://localhost:${MCP_BRIDGE_PORT}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "hello", instanceId: mcpInstanceId }));
    setMcpConnected(true);
    mcpReconnectDelay = 2000;
  };
  ws.onclose = () => {
    setMcpConnected(false);
    setTimeout(connectMcpBridge, mcpReconnectDelay);
    mcpReconnectDelay = Math.min(mcpReconnectDelay * 2, mcpReconnectMaxDelay);
  };
  // Commands (e.g. typeText's timed key taps, loadRom) mutate shared emulator state,
  // so handle them strictly one-at-a-time — later messages wait on earlier ones.
  let mcpCommandTail: Promise<void> = Promise.resolve();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data as string) as McpBridgeCommand;
    mcpCommandTail = mcpCommandTail.then(() => handleMcpCommand(message)).then(
      (result) => {
        ws.send(JSON.stringify({ reqId: message.reqId, ok: true, result }));
      },
      (err) => {
        ws.send(
          JSON.stringify({
            reqId: message.reqId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      },
    );
  };
}

connectMcpBridge();
