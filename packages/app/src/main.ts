import {
  DISK_EXTENSIONS,
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
import { arrayBufferToBase64, base64ToArrayBuffer } from "./utils/base64.js";
import {
  addTape,
  removeTape,
  removeTapes,
  getAllTapes,
  getTape,
  renameTape,
  type TapeEntry,
  type TapeFormat,
} from "./ui/tapeLibrary.js";
import {
  saveStateToStorage,
  loadStateFromStorage,
  deleteStateFromStorage,
  getAllSaveStates,
} from "./ui/saveStates.js";

const canvas = document.getElementById("screen") as HTMLCanvasElement;
const modelSelect = document.getElementById("model-select") as HTMLSelectElement;
const romFileBtn = document.getElementById("rom-file-btn") as HTMLLabelElement | null;
const romInput = document.getElementById("rom-input") as HTMLInputElement | null;
const romFileText = document.getElementById("rom-file-text") as HTMLSpanElement | null;
const romSetupBtn = document.getElementById("rom-setup-btn") as HTMLButtonElement | null;
const normalKeyboardToggle = document.getElementById("normal-keyboard-toggle") as HTMLInputElement;
const tapeSoundToggle = document.getElementById("tape-sound-toggle") as HTMLInputElement | null;
const fastTapeToggle = document.getElementById("fast-tape-toggle") as HTMLInputElement | null;
const snapshotInput = document.getElementById("snapshot-input") as HTMLInputElement;
const mediaFileText = document.getElementById("media-file-text") as HTMLSpanElement | null;
const pauseBtn = document.getElementById("pause-btn") as HTMLButtonElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;
const saveSnapshotBtn = document.getElementById("save-snapshot-btn") as HTMLButtonElement;
const snapshotFormatSelect = document.getElementById(
  "snapshot-format-select",
) as HTMLSelectElement | null;
const tapeBtn = document.getElementById("tape-btn") as HTMLButtonElement;
const tapeEjectBtn = document.getElementById("tape-eject-btn") as HTMLButtonElement | null;
const muteBtn = document.getElementById("mute-btn") as HTMLButtonElement | null;
const volumeIcon = document.getElementById("volume-icon") as SVGElement | null;
const volumeSlider = document.getElementById("volume-slider") as HTMLInputElement | null;
const volumeValue = document.getElementById("volume-value") as HTMLSpanElement | null;
const audioModeSelect = document.getElementById("audio-mode-select") as HTMLSelectElement | null;
const ayStereoGroup = document.getElementById("ay-stereo-group") as HTMLDivElement | null;
const status = document.getElementById("status") as HTMLDivElement;

// Floppy drive elements
const floppyDriveSection = document.getElementById("floppy-drive-section") as HTMLDivElement | null;
const floppyLed = document.getElementById("floppy-led") as HTMLSpanElement | null;
const floppyStatusText = document.getElementById("floppy-status-text") as HTMLSpanElement | null;
const diskFileInput = document.getElementById("disk-file-input") as HTMLInputElement | null;
const diskFileText = document.getElementById("disk-file-text") as HTMLSpanElement | null;
const diskEjectBtn = document.getElementById("disk-eject-btn") as HTMLButtonElement | null;

// Save states elements
const saveStateSlots = document.getElementById("save-state-slots") as HTMLDivElement | null;
const stateThumbnail = document.getElementById("state-thumbnail") as HTMLDivElement | null;
const stateTimestamp = document.getElementById("state-timestamp") as HTMLSpanElement | null;
const quickSaveBtn = document.getElementById("quick-save-btn") as HTMLButtonElement | null;
const quickLoadBtn = document.getElementById("quick-load-btn") as HTMLButtonElement | null;
const deleteStateBtn = document.getElementById("delete-state-btn") as HTMLButtonElement | null;

// Left panel tabs & Snapshots elements
const panelTapesTab = document.getElementById("panel-tapes-tab") as HTMLDivElement | null;
const panelSnapshotsTab = document.getElementById("panel-snapshots-tab") as HTMLDivElement | null;
const leftTabTapesBtn = document.getElementById("left-tab-tapes-btn") as HTMLButtonElement | null;
const leftTabSnapshotsBtn = document.getElementById(
  "left-tab-snapshots-btn",
) as HTMLButtonElement | null;
const snapshotsPanelToggle = document.getElementById(
  "snapshots-panel-toggle",
) as HTMLButtonElement | null;
const snapshotFileInput = document.getElementById("snapshot-file-input") as HTMLInputElement | null;
const snapshotFileText = document.getElementById("snapshot-file-text") as HTMLSpanElement | null;

// Tape library elements
const tapeLibraryPanel = document.getElementById("tape-library-panel") as HTMLDivElement;
const tapeLibraryToggle = document.getElementById("tape-library-toggle") as HTMLButtonElement;
const tapeLibraryAddBtn = document.getElementById("tape-library-add-btn") as HTMLButtonElement;
const tapeLibraryList = document.getElementById("tape-library-list") as HTMLDivElement;
const tapeLibraryInput = document.getElementById("tape-library-input") as HTMLInputElement;
const tapeLibrarySearch = document.getElementById("tape-library-search") as HTMLInputElement;
const tapeLibraryFormatFilter = document.getElementById(
  "tape-library-format-filter",
) as HTMLSelectElement;
const tapeLibraryBulkBar = document.getElementById("tape-library-bulk-bar") as HTMLDivElement;
const tapeLibraryBulkCount = document.getElementById("tape-library-bulk-count") as HTMLSpanElement;
const tapeLibraryBulkExportBtn = document.getElementById(
  "tape-library-bulk-export",
) as HTMLButtonElement;
const tapeLibraryBulkDeleteBtn = document.getElementById(
  "tape-library-bulk-delete",
) as HTMLButtonElement;
const tapeLibraryBulkClearBtn = document.getElementById(
  "tape-library-bulk-clear",
) as HTMLButtonElement;

// Controls panel elements
const controlsPanel = document.getElementById("controls-panel") as HTMLDivElement;
const controlsPanelToggle = document.getElementById("controls-panel-toggle") as HTMLButtonElement;
const fpsVal = document.getElementById("fps-val") as HTMLSpanElement | null;
const logContainer = document.getElementById("log-container") as HTMLDivElement | null;
const logEntriesEl = document.getElementById("log-entries") as HTMLDivElement | null;
const saveLogBtn = document.getElementById("save-log-btn") as HTMLButtonElement | null;
const clearLogBtn = document.getElementById("clear-log-btn") as HTMLButtonElement | null;

// Confirm load dialog elements
const confirmLoadModal = document.getElementById("confirm-load-modal") as HTMLDivElement;
const confirmLoadName = document.getElementById("confirm-load-name") as HTMLParagraphElement;
const confirmLoadCancel = document.getElementById("confirm-load-cancel") as HTMLButtonElement;
const confirmLoadPlay = document.getElementById("confirm-load-play") as HTMLButtonElement;

// Setup modal elements
const setupModal = document.getElementById("setup-modal") as HTMLDivElement;
const modalModelSelect = document.getElementById("modal-model-select") as HTMLSelectElement;
const modalRomInput = document.getElementById("modal-rom-input") as HTMLInputElement;
const modalRomText = document.getElementById("modal-rom-text") as HTMLSpanElement;
const modalStartBtn = document.getElementById("modal-start-btn") as HTMLButtonElement;
const modalCancelBtn = document.getElementById("modal-cancel-btn") as HTMLButtonElement | null;
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

  const muteLabel = document.getElementById("mute-btn-label");
  if (volumeIcon) {
    if (isMuted || vol === 0) {
      volumeIcon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <line x1="23" y1="9" x2="17" y2="15"></line>
        <line x1="17" y1="9" x2="23" y2="15"></line>
      `;
      muteBtn?.setAttribute("title", "Unmute audio");
      if (muteLabel) muteLabel.textContent = "Unmute";
    } else if (vol < 0.5) {
      volumeIcon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      `;
      muteBtn?.setAttribute("title", "Mute audio");
      if (muteLabel) muteLabel.textContent = "Mute";
    } else {
      volumeIcon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
      `;
      muteBtn?.setAttribute("title", "Mute audio");
      if (muteLabel) muteLabel.textContent = "Mute";
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

const savedAudioMode =
  (localStorage.getItem("zx_spectrum_audio_mode") as "mono" | "acb" | "abc" | null) ?? "acb";
if (audioModeSelect) audioModeSelect.value = savedAudioMode;
client.setAudioMode(savedAudioMode);

audioModeSelect?.addEventListener("change", () => {
  const mode = (audioModeSelect.value as "mono" | "acb" | "abc") || "acb";
  localStorage.setItem("zx_spectrum_audio_mode", mode);
  client.setAudioMode(mode);
});

let paused = false;
let romLoaded = false;
let tapePlaying = false;
let libraryOpen = localStorage.getItem("zx_spectrum_library_open") === "true";
let controlsOpen = localStorage.getItem("zx_spectrum_controls_open") === "true";
let activeLeftTab: "tapes" | "snapshots" =
  (localStorage.getItem("zx_spectrum_left_tab") as "tapes" | "snapshots" | null) ?? "tapes";
let pendingTapeEntry: TapeEntry | null = null;
let libraryFilterText = "";
let libraryFilterFormat: "all" | TapeFormat = "all";
const selectedTapeIds = new Set<string>();

function setLeftTab(tab: "tapes" | "snapshots"): void {
  activeLeftTab = tab;
  localStorage.setItem("zx_spectrum_left_tab", tab);
  if (panelTapesTab) panelTapesTab.style.display = tab === "tapes" ? "flex" : "none";
  if (panelSnapshotsTab) panelSnapshotsTab.style.display = tab === "snapshots" ? "flex" : "none";
  leftTabTapesBtn?.classList.toggle("active", tab === "tapes");
  leftTabSnapshotsBtn?.classList.toggle("active", tab === "snapshots");
  tapeLibraryToggle?.classList.toggle("active", libraryOpen && tab === "tapes");
  snapshotsPanelToggle?.classList.toggle("active", libraryOpen && tab === "snapshots");
}

function updateMemoryInfoUi(): void {
  const model = currentModel();
  const memModelVal = document.getElementById("mem-model-val");
  const memRamVal = document.getElementById("mem-ram-val");
  const memArchVal = document.getElementById("mem-arch-val");
  if (!memModelVal || !memRamVal || !memArchVal) return;

  if (model === "48k") {
    memModelVal.textContent = "48K Sinclair";
    memRamVal.textContent = "48 KB RAM / 16 KB ROM";
    memArchVal.textContent = "Contended Bank 1 (0x4000-0x7FFF)";
  } else if (model === "128k") {
    memModelVal.textContent = "128K Toastrack / +2";
    memRamVal.textContent = "128 KB (8x16K) / 32 KB (2x16K ROM)";
    memArchVal.textContent = "Port 0x7FFD / Contended Banks 1,3,5,7";
  } else if (model === "plus3") {
    memModelVal.textContent = "+3 Amstrad";
    memRamVal.textContent = "128 KB (8x16K) / 64 KB (4x16K ROM)";
    memArchVal.textContent = "Ports 0x7FFD, 0x1FFD / Contended Banks 4-7";
  }
}

function currentModel(): MachineModel {
  return modelSelect.value as MachineModel;
}

interface LogEntry {
  timestamp: string;
  message: string;
  level: "info" | "warn" | "error";
}

const logEntries: LogEntry[] = [];

function updateLogButtons(): void {
  const hasEntries = logEntries.length > 0;
  if (saveLogBtn) saveLogBtn.disabled = !hasEntries;
  if (clearLogBtn) clearLogBtn.disabled = !hasEntries;
}

function appendLogEntryUi(entry: LogEntry): void {
  if (!logEntriesEl) return;
  const empty = logEntriesEl.querySelector(".log-entry-empty");
  if (empty) empty.remove();

  const row = document.createElement("div");
  row.className = `log-entry log-${entry.level}`;

  const timeSpan = document.createElement("span");
  timeSpan.className = "log-entry-time";
  timeSpan.textContent = `[${entry.timestamp}]`;

  const msgSpan = document.createElement("span");
  msgSpan.className = "log-entry-msg";
  msgSpan.textContent = entry.message;

  row.appendChild(timeSpan);
  row.appendChild(msgSpan);
  logEntriesEl.appendChild(row);

  while (logEntriesEl.children.length > 200) {
    logEntriesEl.removeChild(logEntriesEl.firstChild!);
  }

  if (logContainer) {
    logContainer.scrollTop = logContainer.scrollHeight;
  }
  updateLogButtons();
}

function renderLogs(): void {
  if (!logEntriesEl) return;
  logEntriesEl.innerHTML = "";
  if (logEntries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "log-entry-empty";
    empty.textContent = "No log entries yet.";
    logEntriesEl.appendChild(empty);
    updateLogButtons();
    return;
  }
  for (const entry of logEntries) {
    appendLogEntryUi(entry);
  }
}

function logEvent(message: string, level: "info" | "warn" | "error" = "info"): void {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const entry: LogEntry = { timestamp: timeStr, message, level };
  logEntries.push(entry);
  if (logEntries.length > 500) logEntries.shift();
  appendLogEntryUi(entry);
}

function setStatus(message: string, level: "info" | "warn" | "error" = "info"): void {
  status.textContent = message;
  logEvent(message, level);
}

renderLogs();

client.onError = (message) => {
  setStatus(`Error: ${message}`, "error");
};

let lastFpsUpdate = performance.now();
let lastFpsFrameCount = 0;
let currentFps = 0;

function updateFpsUi(): void {
  if (!fpsVal) return;
  if (!romLoaded) {
    fpsVal.textContent = "--";
    return;
  }
  if (paused) {
    fpsVal.textContent = "Paused";
    return;
  }
  fpsVal.textContent = currentFps.toFixed(1);
}

function updatePauseUi(): void {
  const pauseIcon = pauseBtn.querySelector(".icon-pause") as SVGElement | null;
  const playIcon = pauseBtn.querySelector(".icon-play") as SVGElement | null;
  const label = document.getElementById("pause-btn-label");
  if (paused) {
    if (pauseIcon) pauseIcon.style.display = "none";
    if (playIcon) playIcon.style.display = "block";
    if (label) label.textContent = "Resume";
    pauseBtn.setAttribute("title", "Resume emulation");
    pauseBtn.setAttribute("aria-label", "Resume emulation");
    pauseBtn.classList.add("btn-accent");
  } else {
    if (pauseIcon) pauseIcon.style.display = "block";
    if (playIcon) playIcon.style.display = "none";
    if (label) label.textContent = "Pause";
    pauseBtn.setAttribute("title", "Pause emulation");
    pauseBtn.setAttribute("aria-label", "Pause emulation");
    pauseBtn.classList.remove("btn-accent");
  }
  updateFpsUi();
}

function updateTapeUi(): void {
  const playIcon = tapeBtn.querySelector(".icon-tape-play") as SVGElement | null;
  const stopIcon = tapeBtn.querySelector(".icon-tape-stop") as SVGElement | null;
  const label = document.getElementById("tape-btn-label");
  if (tapePlaying) {
    if (playIcon) playIcon.style.display = "none";
    if (stopIcon) stopIcon.style.display = "block";
    if (label) label.textContent = "Stop";
    tapeBtn.setAttribute("title", "Stop tape");
    tapeBtn.setAttribute("aria-label", "Stop tape");
    tapeBtn.classList.add("playing");
  } else {
    if (playIcon) playIcon.style.display = "block";
    if (stopIcon) stopIcon.style.display = "none";
    if (label) label.textContent = "Play";
    tapeBtn.setAttribute("title", "Play tape");
    tapeBtn.setAttribute("aria-label", "Play tape");
    tapeBtn.classList.remove("playing");
  }
}

client.onTapeStatus = (playing) => {
  tapePlaying = playing;
  updateTapeUi();
  setStatus(playing ? "Tape playing…" : "Tape stopped.");
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
  if (modalCancelBtn) modalCancelBtn.style.display = romLoaded ? "" : "none";
  const model = currentModel();
  modalModelSelect.value = model;
}

function hideSetupModal(): void {
  setupModal.style.display = "none";
}

function updateRomUi(filename?: string): void {
  if (!romFileText) return;
  if (filename) {
    romFileText.textContent = filename;
    romFileBtn?.setAttribute("title", `Loaded ROM: ${filename} (click to change)`);
  } else {
    const stored = loadRomFromStorage(currentModel());
    if (stored) {
      romFileText.textContent = stored.filename;
      romFileBtn?.setAttribute("title", `Loaded ROM: ${stored.filename} (click to change)`);
    } else {
      romFileText.textContent = "Load ROM…";
      romFileBtn?.setAttribute("title", "Load custom ROM (.rom, .bin)");
    }
  }
}

function updateModalStartBtn(): void {
  modalStartBtn.disabled = modalRomData === null;
}

function formatRomFilename(model: string, files: File[]): string {
  return model === "48k" || files.length === 1
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
  } else if (model === "128k") {
    if (files.length !== 2) {
      return { ok: false, error: "128K requires exactly two ROM files (128-0.rom, 128-1.rom)." };
    }
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
    if (sorted[0]!.size !== ROM_PAGE_SIZE || sorted[1]!.size !== ROM_PAGE_SIZE) {
      return { ok: false, error: `Invalid 128K ROM size (each must be ${ROM_PAGE_SIZE} bytes).` };
    }
    return { ok: true };
  } else if (model === "plus3") {
    if (files.length === 1) {
      if (files[0]!.size !== ROM_PAGE_SIZE * 4) {
        return {
          ok: false,
          error: `Invalid +3 single ROM bundle size: ${files[0]!.size} bytes (expected ${ROM_PAGE_SIZE * 4} bytes / 64KB).`,
        };
      }
      return { ok: true };
    } else if (files.length === 4) {
      for (const f of files) {
        if (f.size !== ROM_PAGE_SIZE) {
          return {
            ok: false,
            error: `Invalid +3 ROM size: "${f.name}" is ${f.size} bytes (expected ${ROM_PAGE_SIZE} bytes).`,
          };
        }
      }
      return { ok: true };
    } else {
      return {
        ok: false,
        error: "+3 requires either 4 separate 16KB ROM files (ROM 0-3) or a single 64KB bundle.",
      };
    }
  }
  return { ok: false, error: `Unknown model: ${model}` };
}

async function readRomFiles(model: string, files: File[]): Promise<ArrayBuffer> {
  if (model === "48k" || files.length === 1) {
    return files[0]!.arrayBuffer();
  } else {
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
    const buffers = await Promise.all(sorted.map((f) => f.arrayBuffer()));
    let totalLen = 0;
    for (const b of buffers) totalLen += b.byteLength;
    const combined = new Uint8Array(totalLen);
    let offset = 0;
    for (const b of buffers) {
      combined.set(new Uint8Array(b), offset);
      offset += b.byteLength;
    }
    return combined.buffer;
  }
}

function updateFloppyUiVisibility(): void {
  if (floppyDriveSection) {
    floppyDriveSection.style.display = currentModel() === "plus3" ? "block" : "none";
  }
}

function updateAudioModeUiVisibility(): void {
  if (ayStereoGroup) {
    ayStereoGroup.style.display = currentModel() === "48k" ? "none" : "";
  }
}

client.onDiskStatus = (diskStatus) => {
  if (floppyLed) {
    floppyLed.classList.toggle("active", diskStatus.motorOn);
  }
  if (floppyStatusText) {
    if (!diskStatus.inserted) {
      floppyStatusText.textContent = "No disk inserted";
    } else {
      floppyStatusText.textContent = `Track ${diskStatus.track}${diskStatus.motorOn ? " (active)" : ""}`;
    }
  }
};

diskFileInput?.addEventListener("change", async () => {
  const file = diskFileInput.files?.[0];
  if (!file) return;
  const data = await file.arrayBuffer();
  client.loadDisk(data);
  if (diskFileText) diskFileText.textContent = file.name;
  if (diskEjectBtn) diskEjectBtn.disabled = false;
  setStatus(`Inserted disk "${file.name}".`);
});

diskEjectBtn?.addEventListener("click", () => {
  client.ejectDisk();
  if (diskFileText) diskFileText.textContent = "Insert Disk…";
  if (diskFileInput) diskFileInput.value = "";
  if (diskEjectBtn) diskEjectBtn.disabled = true;
  if (floppyStatusText) floppyStatusText.textContent = "No disk inserted";
  if (floppyLed) floppyLed.classList.remove("active");
  setStatus("Disk ejected.");
});

let activeSaveStateSlot = 1;

async function refreshSaveStateSlotIndicators(): Promise<void> {
  const model = currentModel();
  const allStates = await getAllSaveStates(model);
  const savedSlots = new Set(allStates.map((s) => s.slot));
  const slotButtons = saveStateSlots?.querySelectorAll(".slot-btn");
  slotButtons?.forEach((btn) => {
    const slot = parseInt(btn.getAttribute("data-slot") ?? "0", 10);
    btn.classList.toggle("active", slot === activeSaveStateSlot);
    btn.classList.toggle("has-state", savedSlots.has(slot));
  });
}

async function updateSaveStatePreview(slot: number): Promise<void> {
  activeSaveStateSlot = slot;
  if (snapshotFileText) {
    snapshotFileText.textContent = `Load into Slot ${slot} (Z80, SNA)…`;
  }
  const exportSlotBtnText = document.getElementById("export-slot-btn-text");
  if (exportSlotBtnText) {
    exportSlotBtnText.textContent = `Export Slot ${slot}`;
  }
  await refreshSaveStateSlotIndicators();
  const model = currentModel();
  const entry = await loadStateFromStorage(slot, model);
  if (entry) {
    if (stateThumbnail) {
      stateThumbnail.innerHTML = `<img src="${entry.screenshot}" alt="Slot ${slot} snapshot" />`;
    }
    if (stateTimestamp) {
      const date = new Date(entry.timestamp);
      const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const label = entry.name
        ? `${entry.name} (${timeStr})`
        : `${date.toLocaleDateString()} ${timeStr}`;
      stateTimestamp.textContent = `Slot ${slot}: ${label}`;
    }
    if (quickLoadBtn) {
      quickLoadBtn.disabled = false;
      quickLoadBtn.title = `Load state from slot ${slot} (F8)`;
    }
    if (quickSaveBtn) {
      quickSaveBtn.title = `Save state into slot ${slot} (F5)`;
    }
    if (deleteStateBtn) deleteStateBtn.disabled = false;
    if (saveSnapshotBtn) saveSnapshotBtn.disabled = false;
    if (snapshotFormatSelect) {
      snapshotFormatSelect.disabled = false;
      if (model === "plus3") {
        snapshotFormatSelect.value = "z80";
      } else if (entry.format === "sna") {
        snapshotFormatSelect.value = "sna";
      } else {
        snapshotFormatSelect.value = "z80";
      }
    }
  } else {
    if (stateThumbnail) {
      stateThumbnail.textContent = "Empty slot";
    }
    if (stateTimestamp) {
      stateTimestamp.textContent = `Slot ${slot}: Empty slot`;
    }
    if (quickLoadBtn) {
      quickLoadBtn.disabled = true;
      quickLoadBtn.title = `Slot ${slot} is empty (F8)`;
    }
    if (quickSaveBtn) {
      quickSaveBtn.title = `Save state into slot ${slot} (F5)`;
    }
    if (deleteStateBtn) deleteStateBtn.disabled = true;
    if (saveSnapshotBtn) saveSnapshotBtn.disabled = true;
    if (snapshotFormatSelect) snapshotFormatSelect.disabled = true;
  }
}

async function quickSaveCurrentSlot(): Promise<void> {
  if (!romLoaded) {
    setStatus("Load a ROM first.", "warn");
    return;
  }
  const model = currentModel();
  const res = await client.saveState(activeSaveStateSlot);
  const screenshot = canvas.toDataURL("image/png");
  await saveStateToStorage(activeSaveStateSlot, model, res.data, screenshot, "Quick Save", "z80");
  await updateSaveStatePreview(activeSaveStateSlot);
  setStatus(`Saved state to slot ${activeSaveStateSlot}.`);
}

async function quickLoadCurrentSlot(): Promise<void> {
  if (!romLoaded) {
    setStatus("Load a ROM first.", "warn");
    return;
  }
  const model = currentModel();
  const entry = await loadStateFromStorage(activeSaveStateSlot, model);
  if (!entry) {
    setStatus(`Slot ${activeSaveStateSlot} is empty.`, "warn");
    return;
  }
  client.loadState(activeSaveStateSlot, entry.data.slice(0), entry.model, entry.format);
  const nameLabel = entry.name ? ` (${entry.name})` : "";
  setStatus(`Loaded state from slot ${activeSaveStateSlot}${nameLabel}.`);
  paused = false;
  updatePauseUi();
  await ensureAudioStarted();
}

async function deleteCurrentSlot(): Promise<void> {
  const ok = window.confirm(`Delete save state in slot ${activeSaveStateSlot}?`);
  if (!ok) return;
  const model = currentModel();
  await deleteStateFromStorage(activeSaveStateSlot, model);
  await updateSaveStatePreview(activeSaveStateSlot);
  setStatus(`Deleted state in slot ${activeSaveStateSlot}.`);
}

saveStateSlots?.addEventListener("click", (e) => {
  const target = (e.target as HTMLElement).closest(".slot-btn") as HTMLElement | null;
  if (!target) return;
  const slot = parseInt(target.getAttribute("data-slot") ?? "1", 10);
  void updateSaveStatePreview(slot);
});

quickSaveBtn?.addEventListener("click", () => void quickSaveCurrentSlot());
quickLoadBtn?.addEventListener("click", () => void quickLoadCurrentSlot());
deleteStateBtn?.addEventListener("click", () => void deleteCurrentSlot());

async function restoreSession(): Promise<void> {
  const lastModel = loadLastModelFromStorage();
  if (lastModel) {
    modelSelect.value = lastModel;
  }
  updateFloppyUiVisibility();
  updateAudioModeUiVisibility();
  updateMemoryInfoUi();
  updateRomUi();
  await updateSaveStatePreview(activeSaveStateSlot);
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
      } else if (storedMedia.format === "dsk") {
        client.loadDisk(storedMedia.data.slice(0));
        if (diskFileText) diskFileText.textContent = storedMedia.filename;
        if (diskEjectBtn) diskEjectBtn.disabled = false;
      } else {
        client.loadTape(storedMedia.format, storedMedia.data.slice(0));
      }
      if (mediaFileText) mediaFileText.textContent = storedMedia.filename;
      setStatus(
        `${model.toUpperCase()} ROM restored (${storedRom.filename}). Loaded "${storedMedia.filename}". Ready.`,
      );
    } else {
      setStatus(
        `${model.toUpperCase()} ROM restored (${storedRom.filename}). Load a snapshot, tape, or disk to play.`,
      );
    }
    await ensureAudioStarted();
  } else {
    showSetupModal();
  }
  initLibraryState();
  initControlsState();
  await renderLibrary();
  renderLogs();
  updateFpsUi();
}

// Tape Library
async function renderLibrary(): Promise<void> {
  const allTapes = await getAllTapes();
  const tapes = allTapes.filter((t) => {
    if (libraryFilterFormat !== "all" && t.format !== libraryFilterFormat) return false;
    if (
      libraryFilterText &&
      !t.name.toLowerCase().includes(libraryFilterText.toLowerCase()) &&
      !t.filename.toLowerCase().includes(libraryFilterText.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  // Drop selections for tapes no longer present (e.g. deleted individually).
  const liveIds = new Set(allTapes.map((t) => t.id));
  for (const id of [...selectedTapeIds]) if (!liveIds.has(id)) selectedTapeIds.delete(id);
  updateBulkBar();

  if (tapes.length === 0) {
    tapeLibraryList.innerHTML = `<div class="tape-library-empty">${
      allTapes.length === 0 ? "No tapes yet. Click + to add." : "No tapes match."
    }</div>`;
    return;
  }
  tapeLibraryList.innerHTML = "";
  for (const tape of tapes) {
    const item = document.createElement("div");
    item.className = "tape-library-item";
    item.dataset.id = tape.id;
    item.innerHTML = `
      <input type="checkbox" class="tape-library-item-checkbox" ${selectedTapeIds.has(tape.id) ? "checked" : ""} aria-label="Select ${tape.name}" />
      <span class="tape-library-item-name" title="${tape.filename}">${tape.name}</span>
      <span class="tape-library-item-format">${tape.format}</span>
      <button class="tape-library-item-edit" title="Rename" aria-label="Rename ${tape.name}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
        </svg>
      </button>
      <button class="tape-library-item-delete" title="Remove from library" aria-label="Remove ${tape.name}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;
    item.querySelector(".tape-library-item-checkbox")!.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleTapeSelection(tape.id);
    });
    item.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          ".tape-library-item-delete, .tape-library-item-edit, .tape-library-item-checkbox",
        )
      )
        return;
      onLibraryTapeClick(tape);
    });
    item.querySelector(".tape-library-item-edit")!.addEventListener("click", (e) => {
      e.stopPropagation();
      startRenameTape(item, tape);
    });
    item.querySelector(".tape-library-item-delete")!.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = window.confirm(`Remove "${tape.name}" from the library?`);
      if (!ok) return;
      await removeTape(tape.id);
      selectedTapeIds.delete(tape.id);
      await renderLibrary();
    });
    tapeLibraryList.appendChild(item);
  }
}

/** Swaps a tape's name span for an editable input; commits via renameTape() on
 * Enter/blur, cancels (re-renders unchanged) on Escape. */
function startRenameTape(item: HTMLElement, tape: TapeEntry): void {
  const nameEl = item.querySelector(".tape-library-item-name") as HTMLElement;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "tape-library-search";
  input.value = tape.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let cancelled = false;
  const commit = async (): Promise<void> => {
    if (cancelled) return;
    const newName = input.value.trim();
    if (newName && newName !== tape.name) await renameTape(tape.id, newName);
    await renderLibrary();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    else if (e.key === "Escape") {
      cancelled = true;
      void renderLibrary();
    }
  });
  input.addEventListener("blur", () => void commit(), { once: true });
}

function toggleTapeSelection(id: string): void {
  if (selectedTapeIds.has(id)) selectedTapeIds.delete(id);
  else selectedTapeIds.add(id);
  updateBulkBar();
}

function updateBulkBar(): void {
  const n = selectedTapeIds.size;
  tapeLibraryBulkBar.hidden = n === 0;
  tapeLibraryBulkCount.textContent = `${n} selected`;
}

function toggleLibrary(): void {
  libraryOpen = !libraryOpen;
  tapeLibraryPanel.classList.toggle("open", libraryOpen);
  document.body.classList.toggle("library-open", libraryOpen);
  localStorage.setItem("zx_spectrum_library_open", libraryOpen.toString());
  tapeLibraryToggle?.classList.toggle("active", libraryOpen && activeLeftTab === "tapes");
  snapshotsPanelToggle?.classList.toggle("active", libraryOpen && activeLeftTab === "snapshots");
  if (libraryOpen && controlsOpen) toggleControls();
}

function initLibraryState(): void {
  tapeLibraryPanel.classList.toggle("open", libraryOpen);
  document.body.classList.toggle("library-open", libraryOpen);
  setLeftTab(activeLeftTab);
}

function toggleControls(): void {
  controlsOpen = !controlsOpen;
  controlsPanel.classList.toggle("open", controlsOpen);
  document.body.classList.toggle("controls-open", controlsOpen);
  localStorage.setItem("zx_spectrum_controls_open", controlsOpen.toString());
  if (controlsOpen && libraryOpen) toggleLibrary();
}

function initControlsState(): void {
  controlsPanel.classList.toggle("open", controlsOpen);
  document.body.classList.toggle("controls-open", controlsOpen);
}

function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

async function onLibraryFileSelect(files: FileList | null): Promise<void> {
  if (!files) return;
  for (const file of Array.from(files)) {
    const name = file.name.toLowerCase();
    const ext = Object.keys(TAPE_EXTENSIONS).find((ext) => name.endsWith(ext));
    if (!ext) continue;
    const format = TAPE_EXTENSIONS[ext as keyof typeof TAPE_EXTENSIONS];
    const data = await file.arrayBuffer();
    await addTape({
      name: stripExtension(file.name),
      filename: file.name,
      format,
      data: data.slice(0),
    });
  }
  tapeLibraryInput.value = "";
  await renderLibrary();
}

function onLibraryTapeClick(entry: TapeEntry): void {
  if (!romLoaded) {
    setStatus("Load a ROM first.", "warn");
    return;
  }
  pendingTapeEntry = entry;
  confirmLoadName.textContent = entry.filename;
  confirmLoadModal.style.display = "flex";
}

async function confirmInstantLoad(): Promise<void> {
  const entry = pendingTapeEntry;
  if (!entry) return;
  confirmLoadModal.style.display = "none";
  pendingTapeEntry = null;

  const model = currentModel();

  client.stopTape();
  // pageRom1: for 128K, skip the boot-into-menu path entirely (see EmulatorClient.reset)
  // — cold-boots straight into 48 BASIC, exactly like Machine48k, so both models share
  // the identical flow below instead of needing separate menu-navigation keystrokes.
  client.reset(model === "128k");

  const tapeData = entry.data.slice(0);
  const sessionData = entry.data.slice(0);
  client.loadTape(entry.format, tapeData);

  client.setFastTapeLoad(true);
  if (fastTapeToggle) fastTapeToggle.checked = true;

  await ensureAudioStarted();

  // Play before typing the load command, not after: TapeEdgePlayer.start() (driving
  // playTape()) unconditionally rewinds the block cursor to 0. The fast-load trap
  // fires on LD-BYTES regardless of "playing" state, so typing LOAD "" first would
  // let the trap consume the header block (cursor 0 -> 1) before playTape() resets
  // it back to 0 — the next trap call then re-serves the header instead of the data
  // block, failing its checksum ("R Tape loading error"). Matches a physical deck
  // too: you press Play, then type the loader command.
  client.playTape();

  // 1800ms (90 frames) is what the project's own fast-load test (fastTapeLoad.test.ts)
  // waits for either ROM to boot to its keyboard-polling ready state before typing;
  // 2500ms adds a safety margin on top — under sustained load the worker's frame
  // timer can fall behind real time, and a keystroke arriving before the ROM is
  // actually polling the keyboard gets silently dropped (observed intermittently
  // at 1800ms during back-to-back scripted loads).
  await sleep(2500);
  // "j" is the single physical key bound to the LOAD keyword on the K-cursor (BASIC's
  // keyword-entry mode at the start of a line) — typing "load" letter-by-letter would
  // send L (itself a keyword, LET), then O/A/D as literal letters in the L-cursor mode
  // that follows a keyword, spelling nonsense like "LET oad" instead of invoking LOAD.
  await typeText('j""\n');

  if (mediaFileText) mediaFileText.textContent = entry.filename;
  await saveSessionMedia({ filename: entry.filename, format: entry.format, data: sessionData });

  setStatus(`Loaded "${entry.filename}". Fast loading...`);
  paused = false;
  updatePauseUi();
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
    setStatus(validation.error!, "warn");
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
  updateRomUi(filename);
  setStatus(`${model.toUpperCase()} ROM loaded and reset. Load a snapshot or tape to play.`);
  await ensureAudioStarted();
}

async function loadMediaFile(file: File): Promise<void> {
  if (!romLoaded) {
    setStatus("Load a ROM first.", "warn");
    return;
  }
  const name = file.name.toLowerCase();
  const data = await file.arrayBuffer();

  const snapshotExt = Object.keys(SNAPSHOT_EXTENSIONS).find((ext) => name.endsWith(ext));
  const tapeExt = Object.keys(TAPE_EXTENSIONS).find((ext) => name.endsWith(ext));
  const diskExt = Object.keys(DISK_EXTENSIONS).find((ext) => name.endsWith(ext));

  if (snapshotExt) {
    const format = SNAPSHOT_EXTENSIONS[snapshotExt as keyof typeof SNAPSHOT_EXTENSIONS];
    const sessionData = data.slice(0);
    const slotData = data.slice(0);
    client.loadSnapshot(format, data);
    if (mediaFileText) mediaFileText.textContent = file.name;
    await saveSessionMedia({ filename: file.name, format, data: sessionData });

    paused = false;
    updatePauseUi();
    await ensureAudioStarted();

    // Allow emulator to render a frame onto canvas before capturing thumbnail
    await new Promise((r) => setTimeout(r, 60));
    const screenshot = canvas.toDataURL("image/png");
    const model = currentModel();
    await saveStateToStorage(activeSaveStateSlot, model, slotData, screenshot, file.name, format);
    await updateSaveStatePreview(activeSaveStateSlot);

    setStatus(`Loaded "${file.name}" into Memory Slot ${activeSaveStateSlot}. Ready.`);
    return;
  } else if (tapeExt) {
    const format = TAPE_EXTENSIONS[tapeExt as keyof typeof TAPE_EXTENSIONS];
    const sessionData = data.slice(0);
    const libraryData = data.slice(0);
    client.loadTape(format, data);
    if (mediaFileText) mediaFileText.textContent = file.name;
    await saveSessionMedia({ filename: file.name, format, data: sessionData });
    await addTape({
      name: stripExtension(file.name),
      filename: file.name,
      format,
      data: libraryData,
    });
    await renderLibrary();
    setStatus(`Loaded "${file.name}". Tape stopped.`);
    paused = false;
    updatePauseUi();
    await ensureAudioStarted();
    return;
  } else if (diskExt) {
    if (currentModel() !== "plus3") {
      const ok = window.confirm("Switch to +3 model to load this disk?");
      if (!ok) return;
      await switchModel("plus3");
    }
    client.loadDisk(data);
    if (diskFileText) diskFileText.textContent = file.name;
    if (diskEjectBtn) diskEjectBtn.disabled = false;
    setStatus(`Inserted disk "${file.name}".`);
    paused = false;
    updatePauseUi();
    await ensureAudioStarted();
    return;
  } else {
    setStatus(`Unrecognized file type: "${file.name}" (expected .sna/.z80/.tap/.tzx/.dsk)`, "warn");
    return;
  }

  setStatus(`Loaded "${file.name}". Ready.`);
  paused = false;
  updatePauseUi();
  await ensureAudioStarted();
}

let previousModel: MachineModel = currentModel();
let rafHandle = 0;
let frameLoopRunning = false;

async function switchModel(newModel: MachineModel): Promise<void> {
  modelSelect.value = newModel;
  previousModel = newModel;
  localStorage.setItem("zx_spectrum_last_model", newModel);
  updateFloppyUiVisibility();
  updateAudioModeUiVisibility();
  updateMemoryInfoUi();
  updateRomUi();
  await updateSaveStatePreview(activeSaveStateSlot);
  const storedRom = loadRomFromStorage(newModel);
  if (storedRom) {
    client.loadRom(newModel, storedRom.data.slice(0));
    client.reset();
    client.resume();
    romLoaded = true;
    setStatus(`${newModel.toUpperCase()} ROM loaded from cache (${storedRom.filename}).`);
    await ensureAudioStarted();
  } else {
    showSetupModal();
  }
}

modelSelect.addEventListener("change", async () => {
  const model = currentModel();

  if (romLoaded) {
    const ok = window.confirm(`Switch to ${model.toUpperCase()}? This will reset the emulator.`);
    if (!ok) {
      modelSelect.value = previousModel;
      return;
    }
  }

  await switchModel(model);
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
  previousModel = model;
  localStorage.setItem("zx_spectrum_last_model", model);
  updateFloppyUiVisibility();
  updateAudioModeUiVisibility();
  updateMemoryInfoUi();
  updateRomUi(modalRomFilename);
  await updateSaveStatePreview(activeSaveStateSlot);
  saveRomToStorage({ model, filename: modalRomFilename, data: modalRomData.slice(0) });

  client.loadRom(model, modalRomData);
  client.reset();
  client.resume();
  romLoaded = true;
  paused = false;
  updatePauseUi();
  setStatus(`${model.toUpperCase()} ROM loaded and reset. Load a snapshot, tape, or disk to play.`);

  hideSetupModal();
  await ensureAudioStarted();
});

modalCancelBtn?.addEventListener("click", () => {
  hideSetupModal();
});

romInput?.addEventListener("change", async () => {
  const files = romInput.files ? Array.from(romInput.files) : [];
  if (files.length > 0) {
    await loadRomFiles(files);
    romInput.value = "";
  }
});

romSetupBtn?.addEventListener("click", () => {
  showSetupModal();
});

pauseBtn.addEventListener("click", () => {
  paused = !paused;
  if (paused) {
    client.pause();
    audio.suspend();
    cancelAnimationFrame(rafHandle);
    logEvent("Emulation paused.");
  } else {
    client.resume();
    audio.resume();
    lastFpsUpdate = performance.now();
    lastFpsFrameCount = client.getFrameCount();
    rafHandle = requestAnimationFrame(frameLoop);
    logEvent("Emulation resumed.");
  }
  updatePauseUi();
});

resetBtn.addEventListener("click", () => {
  client.reset();
  lastFpsUpdate = performance.now();
  lastFpsFrameCount = client.getFrameCount();
  updateFpsUi();
  setStatus("System reset.");
});

saveLogBtn?.addEventListener("click", () => {
  if (logEntries.length === 0) return;
  const lines = logEntries.map((e) => `[${e.timestamp}] [${e.level.toUpperCase()}] ${e.message}`);
  const text = lines.join("\r\n");
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `zx-spectrum-log-${dateStr}.txt`;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  setStatus(`Saved log as "${filename}".`);
});

clearLogBtn?.addEventListener("click", () => {
  logEntries.length = 0;
  renderLogs();
});

saveSnapshotBtn.addEventListener("click", async () => {
  const model = currentModel();
  const entry = await loadStateFromStorage(activeSaveStateSlot, model);
  if (!entry) {
    setStatus(`Slot ${activeSaveStateSlot} is empty.`, "warn");
    return;
  }

  const requestedFormat = snapshotFormatSelect?.value === "sna" ? "sna" : "z80";
  if (model === "plus3" && requestedFormat === "sna") {
    setStatus("Note: .sna does not support +3 paging. Exporting as .z80 instead.", "warn");
  }
  const actualFormat = model === "plus3" && requestedFormat === "sna" ? "z80" : requestedFormat;
  const entryFormat = entry.format ?? "z80";

  let data: ArrayBuffer;
  if (entryFormat === actualFormat) {
    data = entry.data;
  } else {
    data = await client.exportState(entry.data.slice(0), model, actualFormat, entryFormat);
  }

  let baseName = entry.name ? stripExtension(entry.name) : `slot${activeSaveStateSlot}-${model}`;
  if (baseName.toLowerCase() === "quick save") {
    baseName = `slot${activeSaveStateSlot}-${model}-${Date.now()}`;
  }
  const filename = `${baseName}.${actualFormat}`;

  const blob = new Blob([data], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  setStatus(`Exported Slot ${activeSaveStateSlot} as "${filename}".`);
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
  setStatus("Tape ejected.");
});

// Left panel tabs & toggle event listeners
tapeLibraryToggle.addEventListener("click", () => {
  if (!libraryOpen) {
    setLeftTab("tapes");
    toggleLibrary();
  } else if (activeLeftTab !== "tapes") {
    setLeftTab("tapes");
  } else {
    toggleLibrary();
  }
});

snapshotsPanelToggle?.addEventListener("click", () => {
  if (!libraryOpen) {
    setLeftTab("snapshots");
    toggleLibrary();
  } else if (activeLeftTab !== "snapshots") {
    setLeftTab("snapshots");
  } else {
    toggleLibrary();
  }
});

leftTabTapesBtn?.addEventListener("click", () => setLeftTab("tapes"));
leftTabSnapshotsBtn?.addEventListener("click", () => setLeftTab("snapshots"));

snapshotFileInput?.addEventListener("change", async () => {
  const file = snapshotFileInput.files?.[0];
  if (file) {
    await loadMediaFile(file);
    snapshotFileInput.value = "";
  }
});
tapeLibraryAddBtn.addEventListener("click", () => tapeLibraryInput.click());
tapeLibraryInput.addEventListener("change", () => onLibraryFileSelect(tapeLibraryInput.files));

tapeLibrarySearch.addEventListener("input", () => {
  libraryFilterText = tapeLibrarySearch.value;
  void renderLibrary();
});
tapeLibraryFormatFilter.addEventListener("change", () => {
  libraryFilterFormat = tapeLibraryFormatFilter.value as "all" | TapeFormat;
  void renderLibrary();
});

tapeLibraryBulkClearBtn.addEventListener("click", () => {
  selectedTapeIds.clear();
  void renderLibrary();
});

tapeLibraryBulkDeleteBtn.addEventListener("click", async () => {
  if (selectedTapeIds.size === 0) return;
  const ok = window.confirm(`Remove ${selectedTapeIds.size} tape(s) from the library?`);
  if (!ok) return;
  await removeTapes([...selectedTapeIds]);
  selectedTapeIds.clear();
  await renderLibrary();
});

tapeLibraryBulkExportBtn.addEventListener("click", async () => {
  for (const id of selectedTapeIds) {
    const tape = await getTape(id);
    if (!tape) continue;
    const blob = new Blob([tape.data], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = tape.filename;
    a.click();
    URL.revokeObjectURL(url);
    // Space out downloads — browsers can silently drop rapid-fire auto-downloads.
    await sleep(150);
  }
});

// Controls panel toggle
controlsPanelToggle.addEventListener("click", toggleControls);
confirmLoadCancel.addEventListener("click", () => {
  confirmLoadModal.style.display = "none";
  pendingTapeEntry = null;
});
confirmLoadPlay.addEventListener("click", () => confirmInstantLoad());
confirmLoadModal.addEventListener("click", (e) => {
  if (e.target === confirmLoadModal) {
    confirmLoadModal.style.display = "none";
    pendingTapeEntry = null;
  }
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
  if (e.code === "F5") {
    e.preventDefault();
    void quickSaveCurrentSlot();
    return;
  }
  if (e.code === "F8") {
    e.preventDefault();
    void quickLoadCurrentSlot();
    return;
  }
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

  const now = performance.now();
  const elapsed = now - lastFpsUpdate;
  if (elapsed >= 500) {
    const frames = client.getFrameCount();
    const frameDelta = frames - lastFpsFrameCount;
    if (elapsed <= 2000 && frameDelta >= 0) {
      currentFps = (frameDelta * 1000) / elapsed;
    }
    lastFpsUpdate = now;
    lastFpsFrameCount = frames;
    updateFpsUi();
  }

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
    case "saveSnapshot": {
      if (!romLoaded) throw new Error("saveSnapshot: no ROM loaded yet.");
      const format = message.format ?? "sna";
      const data = await client.saveSnapshot(format);
      return { format, dataBase64: arrayBufferToBase64(data) };
    }
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
    case "loadDisk":
      client.loadDisk(base64ToArrayBuffer(message.dataBase64));
      return null;
    case "ejectDisk":
      client.ejectDisk();
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
      // Long enough gap that the ROM's keyboard scan reliably sees a released matrix
      // before the next key lands — two identical taps in a row (e.g. the pair of
      // quotes in LOAD "") with a too-short gap have been observed to get misread
      // as a different symbol, presumably a debounce/repeat quirk. Widened from
      // 120ms after that still intermittently misfired under sustained load.
      await sleep(180);
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
    await sleep(180);
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
    mcpCommandTail = mcpCommandTail
      .then(() => handleMcpCommand(message))
      .then(
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
