# Architecture

## Repo layout

npm workspaces monorepo, TypeScript project references enforcing module boundaries:

- `packages/core` — pure TS emulator engine (Z80 CPU, memory, ULA, loaders,
  machine composition). No DOM, no Worker APIs — its `tsconfig.json` sets
  `"lib": ["ES2022"]` with no `"DOM"`, so any accidental `window`/`document`/
  `postMessage` dependency fails to compile. This is what keeps the core testable
  in plain Node/Vitest and reusable outside the Worker.
- `packages/worker` — Web Worker glue: owns a live `Machine48k` instance, the
  `postMessage` protocol (`protocol.ts`), and the `SharedArrayBuffer` ring-buffer
  implementations (`ring-buffers.ts`) for tear-free frame/audio transport.
- `packages/app` — Vite + vanilla TS UI shell: canvas display, keyboard input
  mapping, ROM/snapshot file loading, Web Audio playback.
- `packages/test-fixtures` — test-only binary assets (zexdoc.com/zexall.com CPU
  exerciser binaries).

## Z80 CPU core (`packages/core/src/cpu/`)

Opcode dispatch is table-driven (`opcodes/baseTable.ts`, `cbTable.ts`, `edTable.ts`,
`indexTable.ts`, `indexCbTable.ts`), built via loops over the repetitive instruction
families (LD r,r'; ALU A,r; INC/DEC r; rotate/shift group; BIT/RES/SET) rather than
~1500 hand-written opcode functions. The DD/FD-prefixed table starts as a copy of
the base table's function references and only overrides the ~60 opcodes the prefix
actually affects — every other opcode is unaffected by design on real hardware.

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
worker→main-thread frame payload 4x smaller.

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
0x20-0x22/0x30/0x32/0x33 pauses/metadata) both parse down to one
`TapePulseSequence` (a flat list of `{level, duration}` edges). `TapeEdgePlayer`
plays that sequence against the machine's `totalTStates` clock — a counter that,
unlike the per-frame `tStates` used for contention/interrupt timing, never resets,
since tape playback spans many frames. The ULA's port 0xFE read takes the current
EAR level as a parameter (supplied by the machine from the tape player) rather than
owning tape state itself.

No fast-load trap — accurate pulse-timing playback is the only path. Verified
against the real 48K ROM's `LD-BYTES` routine, not just our own parser (see
`docs/roadmap.md`).

## ROM sourcing

The app never bundles Sinclair/Amstrad ROM images. Users supply their own ROM file
via the file picker on first run; it's cached in IndexedDB (`packages/app/src/ui/
romStore.ts`) so the prompt only happens once per browser.

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
