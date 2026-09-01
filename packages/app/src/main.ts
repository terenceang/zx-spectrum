import { AudioSink } from "./audio/audioSink.js";
import { KEY_MAP } from "./input/keyMapping.js";
import { Display } from "./ui/display.js";
import { loadRom as loadCachedRom, saveRom } from "./ui/romStore.js";
import { EmulatorClient } from "./worker-client.js";

const ROM_KEY = "48k";

const canvas = document.getElementById("screen") as HTMLCanvasElement;
const romInput = document.getElementById("rom-input") as HTMLInputElement;
const snapshotInput = document.getElementById("snapshot-input") as HTMLInputElement;
const pauseBtn = document.getElementById("pause-btn") as HTMLButtonElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLDivElement;

const display = new Display(canvas);
const client = new EmulatorClient();
const audio = new AudioSink();

let paused = false;
let audioStarted = false;
let romLoaded = false;

client.onError = (message) => {
  status.textContent = `Error: ${message}`;
};
client.onTapeStatus = (playing) => {
  status.textContent = playing ? "Tape playing…" : "Tape stopped.";
};

async function ensureAudioStarted(): Promise<void> {
  if (audioStarted) return;
  audioStarted = true;
  await audio.start(client);
}

async function tryLoadCachedRom(): Promise<void> {
  const cached = await loadCachedRom(ROM_KEY);
  if (cached) {
    client.loadRom("48k", cached.slice(0)); // slice: loadRom transfers its argument
    romLoaded = true;
    status.textContent = "ROM loaded from cache. Load a .sna/.z80/.tap/.tzx file to play.";
  } else {
    status.textContent = "Load a 48K ROM file to begin (never bundled — see README).";
  }
}

const SNAPSHOT_EXTENSIONS = { ".sna": "sna", ".z80": "z80" } as const;
const TAPE_EXTENSIONS = { ".tap": "tap", ".tzx": "tzx" } as const;

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
  const file = romInput.files?.[0];
  if (!file) return;
  const data = await file.arrayBuffer();
  await saveRom(ROM_KEY, data.slice(0));
  client.loadRom("48k", data);
  romLoaded = true;
  status.textContent = `ROM "${file.name}" loaded.`;
  await ensureAudioStarted();
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

window.addEventListener("keydown", (e) => {
  const matrixKeys = KEY_MAP[e.code];
  if (!matrixKeys) return;
  e.preventDefault();
  for (const { row, bit } of matrixKeys) client.sendKey(row, bit, true);
});
window.addEventListener("keyup", (e) => {
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
