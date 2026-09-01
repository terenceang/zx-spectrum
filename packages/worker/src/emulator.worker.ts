import { Machine48k, applySnapshotTo48k, parseSna, parseTap, parseTzx, parseZ80 } from "@zx-spectrum/core";
import { AudioRing, FrameRingWriter } from "./ring-buffers.js";
import type { HostToWorkerMessage, WorkerToHostMessage } from "./protocol.js";

const FRAME_INTERVAL_MS = 1000 / 50;
const SAMPLE_RATE = 44100;
const SAMPLES_PER_FRAME = Math.round(SAMPLE_RATE / 50);

const machine = new Machine48k();

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
    machine.runFrame();
    const { pixels, width, height } = machine.getFrameBuffer();
    const audio = machine.getAudioSamples(SAMPLES_PER_FRAME);

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
    if (timer !== null) clearInterval(timer);
    running = false;
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
        frameWriter = new FrameRingWriter(message.frameBuffer, 512, 384);
        audioRing = new AudioRing(message.audioBuffer, SAMPLE_RATE); // ~1s capacity
      }
      post({ type: "ready" });
      break;
    }
    case "loadRom": {
      machine.loadRom(new Uint8Array(message.rom));
      break;
    }
    case "loadSnapshot": {
      const bytes = new Uint8Array(message.data);
      const snapshot = message.format === "sna" ? parseSna(bytes) : parseZ80(bytes);
      applySnapshotTo48k(machine, snapshot);
      start();
      break;
    }
    case "loadTape": {
      const bytes = new Uint8Array(message.data);
      const pulses = message.format === "tap" ? parseTap(bytes) : parseTzx(bytes);
      machine.loadTape(pulses);
      machine.playTape();
      lastTapePlaying = machine.tape.isPlaying();
      post({ type: "tapeStatus", playing: lastTapePlaying });
      start();
      break;
    }
    case "playTape": {
      machine.playTape();
      break;
    }
    case "stopTape": {
      machine.stopTape();
      break;
    }
    case "keyEvent": {
      machine.keyboard.setKey(message.row, message.bit, message.down);
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
      machine.reset();
      break;
    }
  }
};
