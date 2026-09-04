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

const canvas = document.getElementById("screen") as HTMLCanvasElement;
const modelSelect = document.getElementById("model-select") as HTMLSelectElement;
const normalKeyboardToggle = document.getElementById("normal-keyboard-toggle") as HTMLInputElement;
const tapeSoundToggle = document.getElementById("tape-sound-toggle") as HTMLInputElement | null;
const fastTapeToggle = document.getElementById("fast-tape-toggle") as HTMLInputElement | null;
const snapshotInput = document.getElementById("snapshot-input") as HTMLInputElement;
const mediaFileText = document.getElementById("media-file-text") as HTMLSpanElement | null;
const pauseBtn = document.getElementById("pause-btn") as HTMLButtonElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;
const saveSnapshotBtn = document.getElementById("save-snapshot-btn") as HTMLButtonElement;
const tapeBtn = document.getElementById("tape-btn") as HTMLButtonElement;
const tapeEjectBtn = document.getElementById("tape-eject-btn") as HTMLButtonElement | null;
const muteBtn = document.getElementById("mute-btn") as HTMLButtonElement | null;
const volumeIcon = document.getElementById("volume-icon") as SVGElement | null;
const volumeSlider = document.getElementById("volume-slider") as HTMLInputElement | null;
const volumeValue = document.getElementById("volume-value") as HTMLSpanElement | null;
const status = document.getElementById("status") as HTMLDivElement;

// Tape library elements
const tapeLibraryPanel = document.getElementById("tape-library-panel") as HTMLDivElement;
const tapeLibraryToggle = document.getElementById("tape-library-toggle") as HTMLButtonElement;
const tapeLibraryAddBtn = document.getElementById("tape-library-add-btn") as HTMLButtonElement;
const tapeLibraryList = document.getElementById("tape-library-list") as HTMLDivElement;
const tapeLibraryInput = document.getElementById("tape-library-input") as HTMLInputElement;
const tapeLibrarySearch = document.getElementById("tape-library-search") as HTMLInputElement;
const tapeLibraryFormatFilter = document.getElementById("tape-library-format-filter") as HTMLSelectElement;
const tapeLibraryBulkBar = document.getElementById("tape-library-bulk-bar") as HTMLDivElement;
const tapeLibraryBulkCount = document.getElementById("tape-library-bulk-count") as HTMLSpanElement;
const tapeLibraryBulkExportBtn = document.getElementById("tape-library-bulk-export") as HTMLButtonElement;
const tapeLibraryBulkDeleteBtn = document.getElementById("tape-library-bulk-delete") as HTMLButtonElement;
const tapeLibraryBulkClearBtn = document.getElementById("tape-library-bulk-clear") as HTMLButtonElement;

// Controls panel elements
const controlsPanel = document.getElementById("controls-panel") as HTMLDivElement;
const controlsPanelToggle = document.getElementById("controls-panel-toggle") as HTMLButtonElement;

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

let paused = false;
let romLoaded = false;
let tapePlaying = false;
let libraryOpen = localStorage.getItem("zx_spectrum_library_open") === "true";
let controlsOpen = localStorage.getItem("zx_spectrum_controls_open") === "true";
let pendingTapeEntry: TapeEntry | null = null;
let libraryFilterText = "";
let libraryFilterFormat: "all" | TapeFormat = "all";
const selectedTapeIds = new Set<string>();

function currentModel(): MachineModel {
  return modelSelect.value as MachineModel;
}

client.onError = (message) => {
  status.textContent = `Error: ${message}`;
};

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
  } else {
    if (pauseIcon) pauseIcon.style.display = "block";
    if (playIcon) playIcon.style.display = "none";
    if (label) label.textContent = "Pause";
    pauseBtn.setAttribute("title", "Pause emulation");
    pauseBtn.setAttribute("aria-label", "Pause emulation");
  }
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
  initLibraryState();
  initControlsState();
  await renderLibrary();
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
      if (target.closest(".tape-library-item-delete, .tape-library-item-edit, .tape-library-item-checkbox")) return;
      onLibraryTapeClick(tape);
    });
    item.querySelector(".tape-library-item-edit")!.addEventListener("click", (e) => {
      e.stopPropagation();
      startRenameTape(item, tape);
    });
    item.querySelector(".tape-library-item-delete")!.addEventListener("click", async (e) => {
      e.stopPropagation();
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
  if (libraryOpen && controlsOpen) toggleControls();
}

function initLibraryState(): void {
  tapeLibraryPanel.classList.toggle("open", libraryOpen);
  document.body.classList.toggle("library-open", libraryOpen);
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
    status.textContent = "Load a ROM first.";
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

  status.textContent = `Loaded "${entry.filename}". Fast loading...`;
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
    const sessionData = data.slice(0);
    client.loadSnapshot(format, data);
    if (mediaFileText) mediaFileText.textContent = file.name;
    await saveSessionMedia({ filename: file.name, format, data: sessionData });
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
    status.textContent = `Loaded "${file.name}". Tape stopped.`;
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

saveSnapshotBtn.addEventListener("click", async () => {
  if (!romLoaded) {
    status.textContent = "Load a ROM first.";
    return;
  }
  const data = await client.saveSnapshot();
  const model = currentModel();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `spectrum-${model}-${stamp}.sna`;

  const blob = new Blob([data], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  status.textContent = `Saved snapshot "${filename}".`;
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

// Tape library event listeners
tapeLibraryToggle.addEventListener("click", toggleLibrary);
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
    case "saveSnapshot": {
      if (!romLoaded) throw new Error("saveSnapshot: no ROM loaded yet.");
      const data = await client.saveSnapshot();
      return { format: "sna", dataBase64: arrayBufferToBase64(data) };
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
