import {
  type BaseMachine,
  Machine48k,
  Machine128k,
  ROM_PAGE_SIZE,
  applySnapshotTo48k,
  applySnapshotTo128k,
  parseSna,
  parseTap,
  parseTzx,
  parseZ80,
} from "@zx-spectrum/core";
import { AudioRing, FrameRingWriter } from "./ring-buffers.js";
import {
  AUDIO_CAPACITY_SAMPLES,
  DEFAULT_SAMPLE_RATE,
  FRAME_INTERVAL_MS,
  MAX_FRAME_HEIGHT,
  MAX_FRAME_WIDTH,
  SAMPLES_PER_FRAME,
  type HostToWorkerMessage,
  type MachineModel,
  type WorkerToHostMessage,
} from "./protocol.js";

const machine48k = new Machine48k();
const machine128k = new Machine128k();
let model: MachineModel = "48k";

function currentMachine(): BaseMachine {
  return model === "48k" ? machine48k : machine128k;
}

let frameWriter: FrameRingWriter | null = null;
let audioRing: AudioRing | null = null;
let running = false;
let timer: ReturnType<typeof setInterval> | null = null;
let lastTapePlaying = false;

function post(message: WorkerToHostMessage, transfer?: Transferable[]): void {
  // @ts-expect-error -- postMessage's overloads don't like a possibly-undefined transfer list
  self.postMessage(message, transfer);
}

function tick(): void {
  try {
    const machine = currentMachine();
    machine.runFrame();
    const { pixels, width, height } = machine.getFrameBuffer();
    const audio = machine.getAudioSamples(SAMPLES_PER_FRAME, DEFAULT_SAMPLE_RATE);

    const playing = machine.tape.isPlaying();
    if (playing !== lastTapePlaying) {
      lastTapePlaying = playing;
      post({ type: "tapeStatus", playing });
    }

    if (frameWriter && audioRing) {
      frameWriter.write(pixels, width, height);
      audioRing.write(audio);
    } else {
      // Fallback path: no SharedArrayBuffer (cross-origin isolation unavailable) —
      // ship each frame's pixels/audio as transferable copies instead.
      const pixelsCopy = pixels.slice().buffer;
      const audioCopy = audio.slice().buffer;
      post({ type: "frame", pixels: pixelsCopy, width, height, audio: audioCopy }, [
        pixelsCopy,
        audioCopy,
      ]);
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    stop();
  }
}

function start(): void {
  if (running) return;
  running = true;
  timer = setInterval(tick, FRAME_INTERVAL_MS);
}

function stop(): void {
  running = false;
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

self.onmessage = (event: MessageEvent<HostToWorkerMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "init": {
      if (message.frameBuffer && message.audioBuffer) {
        frameWriter = new FrameRingWriter(message.frameBuffer, MAX_FRAME_WIDTH, MAX_FRAME_HEIGHT);
        audioRing = new AudioRing(message.audioBuffer, AUDIO_CAPACITY_SAMPLES);
      }
      post({ type: "ready" });
      break;
    }
    case "loadRom": {
      model = message.model;
      const bytes = new Uint8Array(message.rom);
      if (message.model === "48k") {
        machine48k.loadRom(bytes);
      } else {
        machine128k.loadRoms(
          bytes.subarray(0, ROM_PAGE_SIZE),
          bytes.subarray(ROM_PAGE_SIZE, ROM_PAGE_SIZE * 2),
        );
      }
      break;
    }
    case "loadSnapshot": {
      const bytes = new Uint8Array(message.data);
      const snapshot = message.format === "sna" ? parseSna(bytes) : parseZ80(bytes);
      if (model === "48k") applySnapshotTo48k(machine48k, snapshot);
      else applySnapshotTo128k(machine128k, snapshot);
      start();
      break;
    }
    case "loadTape": {
      const bytes = new Uint8Array(message.data);
      const pulses = message.format === "tap" ? parseTap(bytes) : parseTzx(bytes);
      const machine = currentMachine();
      machine.loadTape(pulses);
      machine.stopTape();
      lastTapePlaying = false;
      post({ type: "tapeStatus", playing: false });
      start();
      break;
    }
    case "playTape": {
      currentMachine().playTape();
      break;
    }
    case "stopTape": {
      currentMachine().stopTape();
      break;
    }
    case "setTapeSound": {
      machine48k.tapeSoundEnabled = message.enabled;
      machine128k.tapeSoundEnabled = message.enabled;
      break;
    }
    case "setFastTapeLoad": {
      machine48k.fastTapeLoad = message.enabled;
      machine128k.fastTapeLoad = message.enabled;
      break;
    }
    case "keyEvent": {
      currentMachine().keyboard.setKey(message.row, message.bit, message.down);
      break;
    }
    case "pause": {
      stop();
      break;
    }
    case "resume": {
      start();
      break;
    }
    case "reset": {
      currentMachine().reset();
      break;
    }
  }
};
