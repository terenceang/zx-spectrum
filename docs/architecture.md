# Architecture

## Repo layout

npm workspaces monorepo, TypeScript project references enforcing module boundaries:

- `packages/core` — pure TS emulator engine (Z80 CPU, memory, ULA, loaders,
  machine composition). No DOM, no Worker APIs — its `tsconfig.json` sets
  `"lib": ["ES2022"]` with no `"DOM"`, so any accidental `window`/`document`/
  `postMessage` dependency fails to compile. This is what keeps the core testable
  in plain Node/Vitest and reusable outside the Worker.
- `packages/worker` — Web Worker glue: owns live `Machine48k` and `Machine128k` instances
  (inheriting from `BaseMachine`), the `postMessage` protocol (`protocol.ts`), and the
  `SharedArrayBuffer` ring-buffer implementations (`ring-buffers.ts`) for tear-free
  frame/audio transport.
- `packages/app` — Vite + vanilla TS UI shell: canvas display, keyboard input
  mapping, ROM/snapshot file loading, Web Audio playback.
- `packages/test-fixtures` — test-only binary assets (zexdoc.com/zexall.com CPU
  exerciser binaries).
- `packages/mcp-server` — headless MCP server exposing a `Machine48k`/`Machine128k`
  (driven polymorphically through `BaseMachine`) as MCP tools (load ROM/snapshot/tape,
  press keys, run frames, read the screen as a PNG) so an MCP client can drive and inspect
  the emulator without a browser.

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
correct contention *shape* in the common case, but isn't a per-cycle-exact
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

## Web Worker transport

Primary path: `SharedArrayBuffer` — a seqlock-protected frame buffer (tear-free
reads without needing two full buffer copies) and a lock-free single-producer/
single-consumer audio ring, both in `packages/worker/src/ring-buffers.ts`. An
`AudioWorkletProcessor` (`packages/app/src/audio/beeper-processor.ts`) reads the
audio ring directly on its own realtime thread — audio never depends on main-thread
rAF timing or worker frame jitter.

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
   against the real Sinclair 48K ROM's `LD-BYTES` routine (see `docs/roadmap.md`).

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
    (`fast-tape-toggle` with `localStorage` persistence in the screen options bar below the canvas), and MCP server tools (`set_fast_tape_load`,
    `load_tape` with `fastLoad` option).

Tapes load into the cassette player in the **stopped** state (`isPlaying === false`). Playback is started
via the UI Play tape button, worker protocol `playTape` message, or MCP `play_tape` tool. When `fastTapeLoad`
is active, any tape playback running during ROM loader routines (`0x0556` or `0x0569`) transfers blocks
instantly into memory.
## Machine composition (`packages/core/src/machines/`)

Both `Machine48k` and `Machine128k` extend `BaseMachine<M extends MemoryDevice>`,
which implements `Z80Bus` and orchestrates CPU execution, contention, ULA rendering,
keyboard input, tape playback, and unified audio extraction (`getAudioSamples`).

In `Machine128k`:
- `Memory128k` contends by physical bank (odd banks 1/3/5/7), not by address slot —
  the ULA's video-fetch contention follows whichever RAM chip is actually being
  accessed, so a contended bank stays contended no matter which 16K slot it's
  currently paged into.
- `AyChip` is a free-running oscillator, not frame-scoped like `Beeper` — its tone/
  noise/envelope counters advance via a fractional clock accumulator
  (`AY_CLOCK_HZ` / host sample rate) so pitch stays correct across frame boundaries
  without drift. Generator counter rollover limits are precomputed to avoid division
  in the inner tick loop. `Machine128k.getAudioSamples` mixes AY and beeper audio.

## MCP server (`packages/mcp-server`)

A thin headless wrapper: one live `Machine48k`/`Machine128k` instance, no worker or
`SharedArrayBuffer` transport (a tool call and its reply are already a natural
request/reply boundary, so the seqlock/ring-buffer machinery the browser needs for
tear-free 60fps rendering doesn't apply here). `load_rom` replaces the machine
outright rather than keeping both models alive simultaneously the way the app's
worker does for live in-browser switching.

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
`packages/app/src/input/keyMapping.ts` (which translates *browser* `KeyboardEvent`
codes to these same coordinates, a genuinely device-specific concern) it belongs in
core and both packages import the one copy.

The bridge protocol wire format (`BridgeCommand`), port number (`MCP_BRIDGE_PORT`),
and recognized file extension maps (`SNAPSHOT_EXTENSIONS`, `TAPE_EXTENSIONS`) are
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
once per browser. Active snapshot/tape sessions (`sessionStore.ts`) and the saved
tape library (`tapeLibrary.ts`) are stored in IndexedDB to restore emulator state
and let users re-load a tape without re-picking the file. Both share one small
promise-wrapping helper (`packages/app/src/utils/idb.ts`) for opening a database
and awaiting a request/transaction, rather than each hand-rolling the same
`IDBOpenDBRequest`/`IDBTransaction` callback boilerplate.

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
