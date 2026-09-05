# Architecture

## Repo layout

npm workspaces monorepo, TypeScript project references enforcing module boundaries:

- `packages/core` — pure TS emulator engine (Z80 CPU, memory devices `Memory48k`,
  `Memory128k`, `MemoryPlus3`, ULA, loaders, disk controller `Fdc765` and `.dsk` parser/writer,
  machine composition hierarchy `BaseMachine`, `Machine48k`, `Machine128k`, `MachinePlus3`).
  No DOM, no Worker APIs — its `tsconfig.json` sets `"lib": ["ES2022"]` with no `"DOM"`,
  so any accidental `window`/`document`/`postMessage` dependency fails to compile.
  This is what keeps the core testable in plain Node/Vitest and reusable outside the Worker.
- `packages/worker` — Web Worker glue: owns live `Machine48k`, `Machine128k`, and `MachinePlus3`
  instances (inheriting from `BaseMachine`), handles on-the-fly snapshot export conversion (`exportState`),
  the `postMessage` protocol (`protocol.ts`), and the `SharedArrayBuffer` ring-buffer implementations
  (`ring-buffers.ts`) for tear-free frame and stereo audio transport.
- `packages/app` — Vite + vanilla TS UI shell: canvas display, keyboard/joystick input
  mapping, ROM/snapshot/tape/disk file loading, Web Audio stereo playback, IndexedDB-backed
  tape library and 5-slot save state manager.
- `packages/test-fixtures` — test-only binary assets (zexdoc.com/zexall.com CPU
  exerciser binaries).
- `packages/mcp-server` — headless MCP server exposing `Machine48k`/`Machine128k`/`MachinePlus3`
  (driven polymorphically through `BaseMachine`) as MCP tools (load ROM/snapshot/tape, insert/eject disk,
  save snapshot as `.sna`/`.z80`, press keys, run frames, read the screen as a PNG) so an MCP
  client can drive and inspect the emulator without a browser.

## Z80 CPU core (`packages/core/src/cpu/`)

Opcode dispatch is table-driven (`opcodes/baseTable.ts`, `cbTable.ts`, `edTable.ts`,
`indexTable.ts`, `indexCbTable.ts`), built via loops over the repetitive instruction
families (LD r,r'; ALU A,r; INC/DEC r; rotate/shift group; BIT/RES/SET) rather than
~1500 hand-written opcode functions. Static dispatch tables are built lazily once and
cached across `Z80` instances, eliminating closure allocation overhead. The shared
rotate/shift function table (`ROTATE_OPS`) is centralized in `opcodes/alu.ts`. The DD/FD-prefixed
table starts as a copy of the base table's function references and only overrides the ~60
opcodes the prefix actually affects — every other opcode is unaffected by design on real hardware.

**Verified against zexdoc and zexall** (Frank Cringle's Z80 instruction exerciser,
documented- and undocumented-flags variants respectively) — both pass with zero
errors, covering the full documented instruction set, undocumented IXH/IXL
opcodes, DDCB/FDCB copy-back behavior, and undocumented flag bits (see
`packages/core/src/cpu/zexdoc.test.ts`).

The CPU never touches contention/timing directly — every memory/port access flows
through the injected `Z80Bus` interface (`cpu/bus.ts`), which the machine layer
implements. This keeps the CPU hardware-agnostic while still cycle-accurate when
driven by a contention-aware bus.

**Known simplification**: internal (non-bus-access) `contend()` calls use `PC` as
the "address held on the bus" placeholder. Real hardware holds the I/R register
pair on the bus during some of these cycles instead. This gives the correct total
T-state count per instruction (verified — zexdoc/zexall don't check timing) and the
correct contention _shape_ in the common case, but isn't a per-cycle-exact
contended-address model. Revisit if perfect conformance against FUSE's
contended-memory test suite is ever needed.

## ULA (`packages/core/src/ula/`)

One data-driven `UlaEngine` parameterized by a `UlaTimingProfile` (T-states/line,
lines/frame, contention window, interrupt length) rather than duplicated per-model
classes — 48K/128K/+3 differ almost entirely in these constants.

Phase 1 renders end-of-frame in one bulk pass rather than true per-scanline
beam-racing, with a logged border-color-change list rasterized per scanline so
border-stripe loader effects still render correctly. The framebuffer stays
**palette-indexed** (1 byte/pixel, 0-15), not pre-expanded RGBA — the RGBA LUT
lives in the app layer (`packages/app/src/ui/display.ts`) at blit time, keeping the
worker→main-thread frame payload 4x smaller. `UlaEngine` reuses a pre-allocated
framebuffer across frames, and `Display` caches its canvas `Uint32Array` view to avoid
allocation churn.

## Audio (`packages/core/src/audio/`)

Audio filtering relies on `DcBlocker` (`packages/core/src/audio/dcBlocker.ts`), a single-pole
IIR high-pass filter (`y[n] = x[n] - x[n-1] + 0.995 * y[n-1]`) shared between the ULA `Beeper`
and `TapeEdgePlayer`. This removes the DC bias inherent in square-wave pulse audio before mixing.

`Beeper` (`packages/core/src/audio/beeper.ts`) models the ZX Spectrum 48K ear/mic beeper port (0xFE).
It uses continuous-time boxcar integration anti-aliasing across each audio sample interval rather
than point-sampling, suppressing square-wave aliasing noise and preserving narrow pulses without
phase quantization jitter. Beeper audio is strictly mono and mixed identically to left and right
channels for dual-mono playback.

`AyChip` (AY-3-8912) models three independent sound channels (`A`, `B`, `C`), a noise generator
(17-bit LFSR), and a hardware envelope generator. It supports stereo panning modes:

- **ACB** (authentic +3 default): Channel A panned left, Channel C panned center, Channel B panned right.
- **ABC** (Melodik interface layout): Channel A panned left, Channel B panned center, Channel C panned right.
- **Mono**: Channels A, B, and C mixed equally across left and right.

The ULA beeper and tape monitor tones are mixed into both left and right channels equally.
Stereo panning controls in the UI apply exclusively to the AY sound chip and are dynamically hidden
when running in 48K mode.

## Web Worker transport

Primary path: `SharedArrayBuffer` — a seqlock-protected frame buffer (tear-free
reads without needing two full buffer copies) and a lock-free single-producer/
single-consumer stereo audio ring (`AudioRing`), both in `packages/worker/src/ring-buffers.ts`.
Audio samples are stored as interleaved `[left, right]` float pairs (capacity: 8192 sample pairs = 16384 floats).
An `AudioWorkletProcessor` (`packages/app/src/audio/beeper-processor.ts`) reads the
audio ring directly on its own realtime thread, filling stereo audio output channels — audio never
depends on main-thread rAF timing or worker frame jitter.

Fallback path (no `SharedArrayBuffer`, i.e. cross-origin isolation isn't set up —
see Deployment below): per-frame `postMessage` with `Transferable` `ArrayBuffer`s,
selected automatically at `EmulatorClient` construction time.

## Tape loading (`packages/core/src/loaders/tap.ts`, `tzx.ts`, `tapePlayer.ts`)

`.tap` blocks and the common `.tzx` block types (0x10-0x14 speed-data variants,
0x20-0x22/0x30/0x32/0x33 pauses/metadata) parse down to `TapePulseSequence`
(a flat list of `{level, duration}` edges). Pulse generation and pause handling
are consolidated into reusable utilities (`appendStandardRomBlock`, `appendTapePause`).
Structured block data is preserved non-enumerable on `TapePulseSequence` (`blocks: TapeBlock[]`),
associating raw block bytes with pulse boundary ranges (`pulseStartIndex`, `pulseEndIndex`).

Tape loading supports two operational modes:

1. **Cycle-accurate pulse playback** (default):
   `TapeEdgePlayer` feeds the sequence into port 0xFE bit 6 at exact pilot/sync/data pulse
   timings driven off the machine's absolute `totalTStates` clock. Loading audio (screech/pilot
   tones) is filtered through `DcBlocker` and mixed into frame audio when enabled. Verified
   against the real Sinclair 48K ROM's `LD-BYTES` routine.

2. **Fast tape instant load option** (`fastTapeLoad`, off by default):
   Intercepts calls to the standard Sinclair ROM loader routines (`0x0556: LD-BYTES` and
   `0x0569: LD-SEARCH`, commonly used by games like Fairlight to customize border colors and return
   sequences) on `Machine48k` and `Machine128k` (active only when ROM 1, 48 BASIC, is paged in).
   Validates the block flag byte (`A` at `0x0556`, `A'` at `0x0569`) and Sinclair XOR parity checksum,
   transfers data bytes directly into memory at `IX` (or verifies in VERIFY mode), synchronizes the pulse
   player's indices to the end of the block, configures return registers (`IX = IX + DE`, `DE = 0`, `A = 0`,
   `HL = checksum`, `C = 1`), and routes return cleanly (to `0x053F: SA-ALL` cleanup for `0x0556`, or popping
   the caller's return address for `0x0569`). If a game switches to a custom turbo loader that bypasses
   ROM routines, the pulse player seamlessly continues real-time audio pulse playback from the exact block boundary.
   Configurable via `BaseMachine.fastTapeLoad`, worker protocol message `setFastTapeLoad`, UI toggle
   (`fast-tape-toggle` with `localStorage` persistence, living in the Tape Player section's options
   row alongside `tape-sound-toggle`), and MCP server tools (`set_fast_tape_load`,
   `load_tape` with `fastLoad` option).

   **Loading tones are unconditionally suppressed while `fastTapeLoad` is active**, regardless of
   the `tape-sound-toggle`/Loading-tones checkbox: `BaseMachine.mixAudio`/`mixAudioStereo` gate tape
   audio on `this.tapeSoundEnabled && !this.fastTapeLoad && this.tape.isPlaying()`. This lives at the
   audio-mixing level rather than in the UI, so it holds no matter which caller triggered the fast
   load (Play button, library load, or the MCP bridge) — without it, the tape's real-time pulse
   position is decoupled from the trap-driven block transfer, so leftover screech audio would keep
   playing in the background for the tape's full real duration even after the game had already
   finished loading and started running.

Tapes load into the cassette player in the **stopped** state (`isPlaying === false`). Playback is started
via the UI Play button, worker protocol `playTape` message, or MCP `play_tape` tool. When `fastTapeLoad`
is active, any tape playback running during ROM loader routines (`0x0556` or `0x0569`) transfers blocks
instantly into memory.

### Loading a tape from the library (`packages/app/src/main.ts`)

Loading a tape and playing it are two separate, explicit steps — clicking a library row never
resets the machine or starts playback on its own:

- **Click a library row → `onLibraryTapeClick` → `promptLoadTape`.** If the player already has a
  tape loaded (tracked by the `tapeLoaded` flag, not by scraping UI text — see below), a "Replace
  Tape" confirmation modal appears first; if the player is empty, `loadTapeIntoPlayer` runs
  immediately with no confirmation. Either way, loading only calls `client.loadTape(...)`, updates
  the Tape Player status line, and persists the choice to `sessionStore.ts` — no reset, no
  `playTape()`, no simulated keystrokes.
- **Play (`tapeBtn`) is where the fast-load convenience lives now.** With **Fast load** checked,
  pressing Play (when nothing is currently playing) runs `instantLoadCurrentTape()`: reset the
  machine (`EmulatorClient.reset(pageRom1)` — 128K boots directly into ROM 1 via the `"reset"`
  protocol message's `pageRom1` field, so 48K and 128K share an identical post-reset "cold-boot
  into 48 BASIC" flow), start tape playback, wait for the ROM to reach its keyboard-polling ready
  state, then type `LOAD ""` via simulated keystrokes (with the inter-keystroke interval needed for
  the ROM's keyboard scan to detect matrix release between the two identical `"` characters) —
  resolving in under a second regardless of the tape's real length. With **Fast load** unchecked,
  Play is a plain `playTape()`/`stopTape()` toggle: the raw tape signal starts playing and the user
  types `LOAD ""` themselves, exactly like real hardware, so cycle-accurate loading stays reachable
  from the UI.
- **Play and Eject are disabled whenever no tape is loaded.** A dedicated `tapeLoaded` boolean
  (set/cleared at every load/eject/session-restore site) drives `updateTapePlayerAvailability()`,
  which toggles both buttons' `disabled` state. This intentionally does *not* reuse the status
  line's text as a proxy — that text is shared with snapshot/disk loads too (a snapshot restored
  after a tape was loaded would otherwise be misread as "no tape loaded" or vice versa).
- **Eject actually clears the tape now.** `client.ejectTape()` → worker `"ejectTape"` case →
  `machine.loadTape([])` — reuses the existing `loadTape` machinery with an empty
  `TapePulseSequence` (valid since `blocks` is optional on that type) rather than adding new core
  API, so pressing Play again after Eject is a correct no-op instead of resuming the "ejected" tape.

## Snapshot save/load (`packages/core/src/loaders/sna.ts`, `z80.ts`, `apply.ts`)

### `.sna` Serialization & Deserialization

`parseSna` reads a `.sna` file (48K: 27-byte header + 49152 bytes RAM; 128K: the
same header/RAM shape for banks 5/2/current, plus an explicit PC field, port
`0x7FFD`, and the remaining banks) into a `ParsedSnaSnapshot`; `applySnapshotTo48k`/
`applySnapshotTo128k` (`apply.ts`) push it into a live machine. `writeSna48k`/
`writeSna128k` do the reverse — capture a live machine's CPU/memory/border state
into `.sna` bytes:

- **48K has no PC field in the format.** The convention (both directions) is that
  the snapshot-maker pushes PC onto the stack before saving, so loading is
  effectively a `RET`: `writeSna48k` decrements a copy of SP by 2 and writes PC
  there in its RAM copy (the live machine's own memory/registers are untouched),
  matching what `parseSna` expects to pop back off.
- **128K has an explicit PC field**, so no push-the-stack trick is needed there —
  SP round-trips as-is.
- Small read-only accessors exist on memory and ULA devices: `Memory48k.readRam()`,
  `Memory128k.peekBank()`/`.port7ffd`, `MemoryPlus3.peekBank()`/`.port7ffd`/`.port1ffd`,
  `UlaEngine.borderColor`.

### `.z80` (v3) Serialization

`writeZ8048k`, `writeZ80128k`, and `writeZ80Plus3` (`packages/core/src/loaders/z80.ts`)
serialize live machine state to standard Z80 version 3 snapshots:

- **Header**: 30-byte base header (with PC=0 to signify v2/v3) + 55-byte extended header
  (86 bytes total) encoding PC, hardware mode (48K: mode 0; 128K: mode 4; +3: mode 7),
  paging ports `0x7FFD` and `0x1FFD`, AY register state, and flags.
- **Memory Blocks**: Memory is compressed using ED ED RLE compression (`compressZ80Rle` in `rle.ts`).
  Each block is prefixed by a 3-byte header `[len_lo, len_hi, page_id]` (or uncompressed if compressed
  size exceeds raw 16KB). 48K uses standard pages 8, 4, 5; 128K and +3 serialize all 8 RAM banks
  mapped to page IDs 3..10.

### 5-Slot Save State Manager (`packages/app/src/ui/saveStates.ts`)

The left panel's Snapshots tab provides an integrated 5-slot memory manager backed by IndexedDB (`zx-spectrum-save-states`):

- **Live Preview & Metadata**: Each slot captures a 160×120 JPEG thumbnail of the canvas and timestamp or loaded file name.
- **Quick Save (F5) / Quick Load (F8)**: Instant keyboard shortcuts to save to or restore from the active slot.
- **Load into Slot**: Loads external `.z80` or `.sna` files directly into a specific memory slot.
- **Export Slot**: Exports the active slot directly to disk as `.z80` or `.sna`.
- **On-The-Fly Format Translation (`exportState`)**: The Web Worker transparently converts between `.sna` and `.z80` if the user exports in a format different from what is stored in the slot.

## Machine composition (`packages/core/src/machines/`)

`Machine48k`, `Machine128k`, and `MachinePlus3` extend `BaseMachine<M extends MemoryDevice>`,
which implements `Z80Bus` and orchestrates CPU execution, contention, ULA rendering,
keyboard input, tape playback, and audio extraction (`getAudioSamples`).

### `Machine128k`

- `Memory128k` contends by physical bank (odd banks 1/3/5/7), not by address slot —
  the ULA's video-fetch contention follows whichever RAM chip is actually being
  accessed, so a contended bank stays contended no matter which 16K slot it's
  currently paged into.
- `AyChip` is a free-running oscillator, advancing via fractional clock accumulator
  (`AY_CLOCK_HZ` / host sample rate) without pitch drift.
- Supports stereo panning modes (`ACB`, `ABC`, `Mono`) mixed with beeper and tape audio.

### `MachinePlus3`

- `MemoryPlus3` implements both port `0x7FFD` and port `0x1FFD`:
  - **Standard Paging**: ROM 0..3 at `0x0000..0x3FFF`, Bank 5 at `0x4000..0x7FFF`, Bank 2 at `0x8000..0xBFFF`, switchable Bank 0..7 at `0xC000..0xFFFF`.
  - **Special All-RAM Modes**: Bit 0 of `0x1FFD` activates 4 all-RAM configurations (0/1/2/3, 4/5/6/7, 4/5/6/3, 4/7/6/3) for CP/M and +3DOS.
  - **Amstrad +3 Contention**: RAM banks 4, 5, 6, and 7 are contended regardless of where they are paged.
- `ULA_PLUS3_PROFILE`: 228 T-states/line × 311 lines (70,908 T-states/frame), 32 T-state interrupt.
- **Floppy Disk Subsystem**:
  - `Fdc765` (`packages/core/src/disk/fdc765.ts`): NEC uPD765A FDC connected to port `0x2FFD` (Status/Data) and `0x3FFD` (Motor Control). Implements Specify, Sense Drive Status, Recalibrate, Sense Interrupt Status, Seek, Read Data, Write Data, and Read ID.
  - `.dsk` Parser & Writer (`packages/core/src/disk/dsk.ts`): Parses Standard CPC ("MV - CPC") and Extended CPC disk images, sector track headers, and data blocks.
  - Disk operations wire through the worker protocol (`insertDisk`, `ejectDisk`, `diskStatus`).

### MCP server (`packages/mcp-server`)

A thin headless wrapper: one live `Machine48k`/`Machine128k`/`MachinePlus3` instance, no worker or
`SharedArrayBuffer` transport (a tool call and its reply are already a natural
request/reply boundary, so the seqlock/ring-buffer machinery the browser needs for
tear-free 60fps rendering doesn't apply here). `load_rom` replaces the machine
outright rather than keeping models alive simultaneously the way the app's
worker does for live in-browser switching. It supports loading 48K, 128K, or +3 ROMs
(either 4 separate 16KB ROMs or a single 64KB image).

Snapshots can be loaded via `load_snapshot` (`.sna` or `.z80`) or saved via `save_snapshot`
in either `.sna` or `.z80` format. Disk images (`.dsk`) can be inserted or ejected on +3
via `insert_disk` and `eject_disk`.

Imports core via a relative path to its compiled `dist/` output
(`../../core/dist/index.js`), not the `@zx-spectrum/core` package name — that name
resolves to core's raw `.ts` source (via `package.json` "main"), which Vite
transforms on the fly for the app/worker but plain Node can't execute directly.
Composite TS project references mean `tsc -b` here already builds core first.
Mirrors the same relative-import pattern `packages/app/src/worker-client.ts` uses
for the worker package, for the same underlying reason.

`read_screen` returns a PNG. Node's `zlib` supplies the DEFLATE compression PNG
needs; CRC32 isn't in `zlib`'s API, so `png.ts` hand-rolls the standard table-driven
algorithm rather than adding a PNG library for what's otherwise a ~100-line encoder.

The key-matrix data `press_key`/`get_status` need (`SPECTRUM_KEY_MATRIX`,
`SYMBOL_SHIFT_CHARS`) lives in `packages/core/src/io/spectrumKeys.ts` — it's a fact
about the machine's hardware, not about any particular input device, so unlike
`packages/app/src/input/keyMapping.ts` (which translates _browser_ `KeyboardEvent`
codes to these same coordinates, a genuinely device-specific concern) it belongs in
core and both packages import the one copy.

### Joystick emulation

Kempston is real hardware — it's a byte read on I/O port 0x1F, active-high,
independent of the keyboard matrix — so it gets its own core class,
`JoystickState` (`packages/core/src/io/joystick.ts`), composed onto `BaseMachine`
next to `keyboard` and decoded in each machine's `readPort` (`(port & 0xff) ===
0x1f`, fully decoded — real hardware partial-decodes fewer bits, but no software
relies on that). Sinclair 1/2, Cursor, and QAOP joysticks are not separate
hardware at all — they're just specific keys on the matrix — so they need no core
support; `packages/app/src/input/joystickMapping.ts` maps each of their
directions straight to a `MatrixKey`, the same shape `keyMapping.ts` uses.

The app tracks joystick direction state twice — once from a remappable set of PC
keys, once from an HID gamepad's D-pad/stick/buttons (polled once per rendered
frame in `frameLoop`) — and ORs the two before sending an event, so keyboard and
gamepad can drive the same session interchangeably. Whichever emulated type is
selected decides where that event goes: `client.sendJoystick()` (a
`joystickEvent` protocol message straight to `JoystickState`) for Kempston, or
`client.sendKey()` against the type's `MatrixKey` table for the rest. Switching
type at runtime releases whatever the old mapping was holding down before
applying the new one, so a direction can't get stuck pressed.

The bridge protocol wire format (`BridgeCommand`), port number (`MCP_BRIDGE_PORT`),
and recognized file extension maps (`SNAPSHOT_EXTENSIONS`, `TAPE_EXTENSIONS`, `DISK_EXTENSIONS`) are
defined in `packages/core/src/io/bridgeProtocol.ts` and shared across both the MCP
server and the browser UI as a single source of truth.

Shared ring buffer geometry constants (`MAX_FRAME_WIDTH`, `MAX_FRAME_HEIGHT`,
`AUDIO_CAPACITY_SAMPLES`, `DEFAULT_SAMPLE_RATE`, `SPECTRUM_FPS`) are defined in
`packages/worker/src/protocol.ts`. The `AudioWorkletProcessor` (`beeper-processor.ts`)
directly instantiates `AudioRing` from `packages/worker/src/ring-buffers.ts` rather
than reimplementing the lock-free read logic.

## ROM and session persistence

The app never bundles Sinclair/Amstrad ROM images. Users supply their own ROM file(s)
via the file picker on first run; ROM bytes are cached in `localStorage`
(`packages/app/src/ui/romStorage.ts`) per machine model so the prompt only happens
once per browser. Active snapshot, tape, and disk sessions (`sessionStore.ts`), the saved
tape library (`tapeLibrary.ts`), and save states (`saveStates.ts`) are stored in IndexedDB to restore
emulator state across reloads. Both share one small promise-wrapping helper
(`packages/app/src/utils/idb.ts`) for opening a database and awaiting a request/transaction.

## UI layout (`packages/app/index.html`, `style.css`)

The canvas sits in the centered column with a top toolbar (`.screen-toolbar`) holding quick Pause, Reset, Save (F5), Load (F8), and Fullscreen controls right above the CRT screen frame. Everything else lives in two
`position:fixed` side panels, mutually exclusive (opening one auto-closes the
other), closed by default, toggled by always-visible edge tabs (`#tape-library-toggle` and
`#snapshots-panel-toggle` on the left, `#controls-panel-toggle` on the right — icon + vertical text label)
that shift with their panel via `body.library-open`/`body.controls-open` classes:

- **Left panel** — contains two primary navigation tabs:
  - **Tapes tab** (`#panel-tapes-tab`), split into two visually distinct sections:
    - **Tape Player** (`.tape-player-section`, at top): current-tape status line (`#media-file-text`),
      tape transport (`tape-btn`/`tape-eject-btn`, both disabled until a tape is loaded), and the
      `tape-sound-toggle`/`fast-tape-toggle` options.
    - **Tape Library** (`.tape-library-section`, below): Add (`#tape-library-add-btn` — only ever
      adds files to the IndexedDB library, never loads them), search/filter-by-format, per-item
      rename/delete, bulk select/export/delete, and the tape list itself. There is no direct
      "insert tape" file picker — a `.tap`/`.tzx` must be in the library before it can be loaded
      (dragging a tape file onto the page routes to the same library-add path, not a direct load).
  - **Snapshots tab** (`#panel-snapshots-tab`): Consolidated 5-slot memory manager (`#save-state-slots`),
    live thumbnail screenshot preview and timestamp display, slot state deletion,
    direct external file load into slot, and slot export (.z80 / .sna) with dynamic worker conversion.
    Also displays active hardware memory configuration (model, RAM size, paging mode).
- **Right panel — controls** (`#controls-panel`):
  - **MACHINE**: Model selector (48K / 128K / +3), direct ROM file loader (`#rom-input`), and ROM setup dialog launcher (`#rom-setup-btn`).
  - **FLOPPY DISK (+3)**: Active drive A: indicator, track stepper position, activity LED,
    insert/eject `.dsk` floppy images.
  - **AUDIO**: Mute, volume slider, AY stereo mode selector (ACB authentic +3 / ABC Melodik / Mono, shown for 128K/+3; the 48K beeper is pure mono).
  - **OPTIONS**: Normal keyboard toggle.
  - **JOYSTICK**: Emulated type selector (`#joystick-type-select`: None/Kempston/Sinclair 1/Sinclair 2/Cursor/QAOP),
    key-remap modal launcher (`#joystick-setup-btn` → `#joystick-modal`), and HID gamepad connection indicator (`#gamepad-indicator`).
  - **MCP BRIDGE**: Live server bridge connection indicator (`#mcp-indicator`).
  - **DIAGNOSTICS**: Live emulation performance telemetry and FPS display (`#fps-val`).
  - **LOGS**: Scrollable activity log (`#log-container`), with level-coded timestamped entries, Save Log text export (`#save-log-btn`), and clear actions (`#clear-log-btn`).

**Fullscreen** (`#fullscreen-btn` in `.screen-toolbar`) calls the standard Fullscreen
API directly on `.screen-frame` (`#screen-frame`), not a wrapping panel — since
`.screen-toolbar` and `.status-console` are siblings of `.screen-frame` rather than
descendants, and the Fullscreen API only renders the target element and its
descendants, this gets a chrome-free "just the display" fullscreen for free with no
extra hide/show logic. No new canvas-scaling code is needed either: `.screen-frame`'s
existing `aspect-ratio: 320 / 296` and `canvas#screen`'s existing `width:100%;
height:100%; object-fit:contain; image-rendering:pixelated` already produce a
correctly letterboxed, pixel-crisp scale-up inside whatever box they're given — a
`.screen-frame:fullscreen` rule only needs to free the size constraint
(`width/height: 100vw/100vh`) and drop the border/shadow. The button's icon/label are
kept in sync via the native `"fullscreenchange"` event (not just its own click
handler), so they correctly reset when the user exits via `Escape` rather than the
button — the button itself is invisible while fullscreen is active, since it lives
outside `.screen-frame`, so `Escape` is the only exit path. No `localStorage`
persistence, matching the precedent set by `paused` (the closest analogous transient
playback-state toggle, also never persisted).

Buttons throughout both panels use icon + visible text (`.btn` is `inline-flex` with
a gap for this), not icon-only-with-tooltip — the tape library's bulk-action bar is
the one deliberate exception (count text + 3 actions already fill that 280px row).

## Testing and verification strategy

The emulator relies on a multi-tiered automated testing hierarchy for hardware verification:

1. **Hardware compatibility suite (`packages/core/src/compatibility.test.ts`)**:
   - 26 end-to-end tests verifying hardware accuracy across 48K, 128K, and +3 machines.
   - Verifies ULA memory contention latency patterns (`[6, 5, 4, 3, 2, 1, 0, 0]`), bank contention rules (odd banks 1/3/5/7 on 128K, banks 4/5/6/7 on +3), frame T-state budgets (69888 / 70908), and maskable interrupt line durations.
   - Verifies 128K paging protocols (port `0x7FFD` paging lockout bit 5, shadow screen bit 3 swap between Bank 5 and 7, ROM 0/1 selection).
   - Verifies +3 special All-RAM configurations (port `0x1FFD`), disk drive motor control, ULA screen memory interleaving, 16-frame flash attribute inversion, and mid-frame raster border stripes.
   - Tests AY-3-8912 sound generation across ports `0xFFFD`/`0xBFFD` with stereo panning (ABC/ACB/Mono), keyboard matrix row decoding, Kempston joystick isolation, floating bus behavior, and fast tape traps (`0x0556`/`0x0569`).

2. **Z80 instruction correctness exerciser (`packages/core/src/cpu/zexdoc.test.ts`)**:
   - Executes Frank Cringle's `zexdoc` (documented flags) and `zexall` (documented + undocumented flags) test binaries against a minimal CP/M BDOS stub.
   - Verified 100% passing with zero errors across all instruction groups, flags (including undocumented bits 3 and 5), DAA decimal adjust, and undocumented index registers (`IXH`/`IXL`/`IYH`/`IYL`).

3. **Fast unit & integration tests (`npm test`)**:
   - 17 test files, 106 tests, covering loaders (`.tap`, `.tzx`, `.sna`, `.z80`, `.dsk`), disk controller `Fdc765`, audio filters (`DcBlocker`, `Beeper`, `AyChip`), machine bootstrap sequences, and end-to-end fast/slow tape loading (including a dedicated 48K fast+slow smoke test against a real commercial tape, The Hobbit).
   - Excludes the long-running Z80 exerciser by default to run in ~6s. Run all suites together via `npm run test:all`.

## Deployment (Proxmox LXC)

`vite build` in `packages/app` emits a static `dist/` (content-hashed assets); the
worker and audio-worklet bundles are automatically code-split by Vite. Copy `dist/`
into the LXC's web root.

**`SharedArrayBuffer` requires cross-origin isolation.** Without it, the app
silently falls back to the slower `postMessage` transport — a "works but
mysteriously slow" failure mode that's easy to miss during initial deployment
testing. The web server must send, site-wide:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

nginx:

```nginx
add_header Cross-Origin-Opener-Policy same-origin always;
add_header Cross-Origin-Embedder-Policy require-corp always;
```

Keep all assets same-origin (no CDN fonts/scripts) — COEP `require-corp` breaks
cross-origin subresources unless they also send `Cross-Origin-Resource-Policy`.

Standard static-SPA caching: long-cache/immutable on hashed asset files, no-cache
on `index.html`. No history-fallback routing needed (single page, no router).

`vite dev`/`vite preview` already send these headers locally (see
`packages/app/vite.config.ts`), so the `SharedArrayBuffer` path is exercised in
development too, not just in production.
