import {
  type BaseMachine,
  Machine48k,
  Machine128k,
  MachinePlus3,
  ROM_PAGE_SIZE,
  applySnapshot,
  isSnaSnapshot,
  parseDsk,
  parseSna,
  parseTap,
  parseTzx,
  parseZ80,
  writeSna,
  writeZ80,
} from "@zx-spectrum/core";
import { AudioRing, FrameRingWriter } from "./ring-buffers.js";
import {
  AUDIO_CAPACITY_FLOATS,
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
const machinePlus3 = new MachinePlus3();
let model: MachineModel = "48k";

function currentMachine(): BaseMachine {
  switch (model) {
    case "48k":
      return machine48k;
    case "128k":
      return machine128k;
    case "plus3":
      return machinePlus3;
  }
}

let frameWriter: FrameRingWriter | null = null;
let audioRing: AudioRing | null = null;
let running = false;
let timer: ReturnType<typeof setInterval> | null = null;
let lastTapePlaying = false;
let lastDiskMotor = false;
let lastDiskInserted = false;
let lastDiskTrack = -1;

function post(message: WorkerToHostMessage, transfer?: Transferable[]): void {
  if (transfer) {
    self.postMessage(message, transfer);
  } else {
    self.postMessage(message);
  }
}

function tick(): void {
  try {
    const machine = currentMachine();
    machine.runFrame();
    const { pixels, width, height } = machine.getFrameBuffer();
    const audio = machine.getStereoAudioSamples(SAMPLES_PER_FRAME, DEFAULT_SAMPLE_RATE);

    const playing = machine.tape.isPlaying();
    if (playing !== lastTapePlaying) {
      lastTapePlaying = playing;
      post({ type: "tapeStatus", playing });
    }

    if (model === "plus3") {
      const disk = machinePlus3.fdc.getDisk();
      const inserted = disk !== null;
      const motorOn = machinePlus3.fdc.isMotorOn;
      const track = machinePlus3.fdc.currentTrack;
      if (inserted !== lastDiskInserted || motorOn !== lastDiskMotor || track !== lastDiskTrack) {
        lastDiskInserted = inserted;
        lastDiskMotor = motorOn;
        lastDiskTrack = track;
        post({ type: "diskStatus", inserted, motorOn, track });
      }
    }

    if (frameWriter && audioRing) {
      frameWriter.write(pixels, width, height);
      audioRing.write(audio);
    } else {
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
        audioRing = new AudioRing(message.audioBuffer, AUDIO_CAPACITY_FLOATS);
      }
      post({ type: "ready" });
      break;
    }
    case "loadRom": {
      model = message.model;
      const bytes = new Uint8Array(message.rom);
      if (message.model === "48k") {
        machine48k.loadRom(bytes);
      } else if (message.model === "128k") {
        machine128k.loadRoms(
          bytes.subarray(0, ROM_PAGE_SIZE),
          bytes.subarray(ROM_PAGE_SIZE, ROM_PAGE_SIZE * 2),
        );
      } else {
        machinePlus3.loadRoms(
          bytes.subarray(0, ROM_PAGE_SIZE),
          bytes.subarray(ROM_PAGE_SIZE, ROM_PAGE_SIZE * 2),
          bytes.subarray(ROM_PAGE_SIZE * 2, ROM_PAGE_SIZE * 3),
          bytes.subarray(ROM_PAGE_SIZE * 3, ROM_PAGE_SIZE * 4),
        );
      }
      break;
    }
    case "loadSnapshot": {
      const bytes = new Uint8Array(message.data);
      const snapshot = message.format === "sna" ? parseSna(bytes) : parseZ80(bytes);
      applySnapshot(currentMachine(), snapshot);
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
    case "ejectTape": {
      const machine = currentMachine();
      machine.loadTape([]);
      machine.stopTape();
      lastTapePlaying = false;
      post({ type: "tapeStatus", playing: false });
      break;
    }
    case "loadDisk": {
      const bytes = new Uint8Array(message.data);
      const disk = parseDsk(bytes);
      machinePlus3.fdc.insertDisk(disk);
      post({
        type: "diskStatus",
        inserted: true,
        motorOn: machinePlus3.fdc.isMotorOn,
        track: machinePlus3.fdc.currentTrack,
      });
      break;
    }
    case "ejectDisk": {
      machinePlus3.fdc.ejectDisk();
      post({
        type: "diskStatus",
        inserted: false,
        motorOn: false,
        track: 0,
      });
      break;
    }
    case "setTapeSound": {
      machine48k.tapeSoundEnabled = message.enabled;
      machine128k.tapeSoundEnabled = message.enabled;
      machinePlus3.tapeSoundEnabled = message.enabled;
      break;
    }
    case "setFastTapeLoad": {
      machine48k.fastTapeLoad = message.enabled;
      machine128k.fastTapeLoad = message.enabled;
      machinePlus3.fastTapeLoad = message.enabled;
      break;
    }
    case "setAudioMode": {
      machine128k.ay.stereoMode = message.mode;
      machinePlus3.ay.stereoMode = message.mode;
      break;
    }
    case "keyEvent": {
      currentMachine().keyboard.setKey(message.row, message.bit, message.down);
      break;
    }
    case "joystickEvent": {
      currentMachine().joystick.set(message.input, message.down);
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
      if (message.pageRom1 && model === "128k") {
        machine128k.memory.writePagingRegister(0x10);
      }
      break;
    }
    case "saveSnapshot": {
      const machine = currentMachine();
      const border = machine.ula.borderColor;
      const fmt = message.format ?? "sna";
      const data = fmt === "z80" ? writeZ80(machine, border) : writeSna(machine, border);
      const buffer = data.buffer as ArrayBuffer;
      post({ type: "snapshotData", format: fmt, data: buffer }, [buffer]);
      break;
    }
    case "saveState": {
      const machine = currentMachine();
      const border = machine.ula.borderColor;
      const data = writeZ80(machine, border);
      const buffer = data.buffer as ArrayBuffer;
      post({ type: "stateData", slot: message.slot, data: buffer, model }, [buffer]);
      break;
    }
    case "loadState": {
      model = message.model;
      const bytes = new Uint8Array(message.data);
      const isSna = message.format === "sna" || (!message.format && isSnaSnapshot(bytes));
      const snapshot = isSna ? parseSna(bytes) : parseZ80(bytes);
      applySnapshot(currentMachine(), snapshot);
      start();
      break;
    }
    case "exportState": {
      const bytes = new Uint8Array(message.data);
      const isSna = message.inputFormat === "sna" || (!message.inputFormat && isSnaSnapshot(bytes));
      const snapshot = isSna ? parseSna(bytes) : parseZ80(bytes);
      const temp =
        message.model === "48k"
          ? new Machine48k()
          : message.model === "128k"
            ? new Machine128k()
            : new MachinePlus3();
      applySnapshot(temp, snapshot);
      const outData =
        message.targetFormat === "z80"
          ? writeZ80(temp, snapshot.border)
          : writeSna(temp, snapshot.border);
      const buffer = outData.buffer as ArrayBuffer;
      post({ type: "snapshotData", format: message.targetFormat, data: buffer }, [buffer]);
      break;
    }
  }
};
