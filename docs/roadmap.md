# Roadmap

## Phase 1 — Working 48K emulator (current)

- [x] Monorepo scaffold, strict TS project references, core/app DOM boundary
- [x] Z80 CPU core: full documented + undocumented instruction set, IM0/1/2, NMI,
      EI one-instruction delay — verified against zexdoc and zexall (zero errors)
- [x] `Memory48k`, `UlaEngine` (border/contention/beeper/flash), `KeyboardState`
- [x] `Machine48k` composition + `Z80Bus` implementation (contention, interrupt
      timing)
- [x] `.sna` and `.z80` (v1/v2/v3) snapshot loaders, unit-tested
- [x] Web Worker plumbing: `SharedArrayBuffer` seqlock frame ring + lock-free audio
      ring, with `postMessage`/`Transferable` fallback
- [x] App UI: canvas display, keyboard input, ROM file-picker + IndexedDB cache,
      snapshot file-drop loading, Web Audio (`AudioWorklet`) beeper output,
      pause/reset
- [x] Verified end-to-end against a real 48K ROM at the machine level (boots to
      the standard BASIC screen — attribute bytes and palette usage match the
      expected default screen exactly)
- [ ] Interactive in-browser verification (blocked this session: Claude-in-Chrome
      extension not connected — see below)

**Demo**: load a `.sna` of a real 48K game and play it with sound.

## Phase 2 — Real tape loading (done)

- [x] `.tap`/`.tzx` parsers converging on a unified `TapePulseSequence`
      (`.tzx` covers the common speed-data/pause/metadata block IDs: 0x10-0x14,
      0x20-0x22, 0x30, 0x32, 0x33 — rarer blocks throw a clear "unsupported"
      error naming the block ID rather than silently misparsing)
- [x] `TapeEdgePlayer` feeding ULA EAR input (port 0xFE bit 6) at accurate pilot/
      sync/bit timing, driven off the machine's persistent (never-per-frame-reset)
      T-state clock so playback stays in sync across many frames
- [x] Play/stop wired through the worker protocol (`loadTape`/`playTape`/
      `stopTape`) with a `tapeStatus` message back to the app
- [x] Fast-load trap option (`Machine` setting, off by default) — intercepts ROM
      `LD-BYTES` (0x0556) and `LD-SEARCH` (0x0569) to load tape blocks instantly into
      memory at native speed with flag and parity verification when tape playback is active,
      preserving full compatibility with accurate pulse playback for custom loaders.

**Verified against the real 48K ROM, not just our own parser**: hand-built a
synthetic `.tap` data block, ran it through `parseTap` -> `TapeEdgePlayer`, and
called the ROM's actual `LD-BYTES` routine (0x0556) against it — the ROM decoded
the pulses and wrote back the exact expected bytes. This is the strongest evidence
available that the pulse timings (pilot/sync/bit0/bit1 durations) are correct,
since it's real 1982 machine code doing the verification, not our own logic
checking itself.

**Bug found and fixed (2026-09-01)**: that single-block verification passed but
missed a real bug, because it never exercised a *multi*-block file. Testing
against a real commercial `.tap` (3 header/data pairs) showed the header always
loaded but every following block failed with "R Tape loading error" on real
hardware ROM code — `parseTap`/`parseTzx` set the pulse level to match the
just-emitted pause (0) before starting the next block's pilot tone, so the pilot
tone's first pulse was also level 0: two adjacent same-level pulses with no edge
between them, silently dropping the pilot tone's first transition. Fixed by
starting every block after a pause at level 1 (a real edge out of the pause),
matching the file's own initial level. Re-verified the same real 3-block file
end-to-end via direct `LD-BYTES` calls: all 6 blocks (including a 40001-byte
block) now decode with zero byte errors. Regression-tested in `tap.test.ts`/
`tzx.test.ts` via a general invariant (no two adjacent pulses share a level)
built from a synthetic 2-block file, so this class of bug can't reappear
undetected.

**Demo**: load a `.tap`/`.tzx` through the Spectrum's own ROM loader and watch it
load with real loading stripes/sound.

## Phase 3 — 128K/+2 support (done)

- [x] `Memory128k` — 8 banked 16K RAM banks + 2 paged 16K ROMs behind port 0x7FFD
      (RAM bank, screen bank 5/7, ROM bank, paging lock). Contention follows the
      *bank* (odd banks 1/3/5/7), not the address slot, matching real hardware.
- [x] `ULA_128K_PROFILE` timing profile (228 T-states/line x 311 lines = 70908/frame,
      36 T-state interrupt, same visible border geometry as 48K)
- [x] `UlaEngine.renderFrame` generalized from a concrete `Memory48k` param to a
      structural `ScreenSource` interface, so it works unchanged against either
      memory model's `screenBytes`
- [x] `AyChip` (AY-3-8912): 3 tone generators + shared noise (17-bit LFSR) +
      envelope generator (all 10 canonical CONT/ALT/HOLD/ATT shapes), driven by its
      own fractional-accumulator clock (1773400 Hz) so pitch is correct regardless
      of frame/sample-rate boundaries — not reset per frame like the beeper, since
      it's a free-running oscillator. Verified by unit test: measured zero-crossing
      frequency of a generated tone matches the datasheet formula
      (`clock / (16 x period)`) to within 5%.
- [x] `Machine128k`: same Z80/ULA/tape composition as `Machine48k`, plus port
      0x7FFD paging and partially-decoded AY ports (0xFFFD select/read, 0xBFFD
      data write) mixed 50/50 with the beeper in `getAudioSamples`
- [x] `applySnapshotTo128k` — pushes `.z80`/`.sna` 128K snapshots' already-parsed
      `banks`/`pagedBanks` (see `ParsedZ80Snapshot`/`ParsedSnaSnapshot`) directly
      into the right physical RAM bank, bypassing paging, plus AY register state
      via `ayRegisters` (with 48K snapshot fallback mapping into banks 5/2/0)
- [x] App: model selector (48K/128K), ROM input accepts either one 48K ROM or two
      128K ROMs (sorted by filename -> ROM0/ROM1), cached in IndexedDB per model
- [x] Verified end-to-end against the real `128-0.rom`/`128-1.rom` images: boots
      120 frames without hanging, PC lands mid-ROM (not spinning at reset), and the
      display attribute bytes show a sensible white-paper/black-ink text screen
- [ ] Interactive in-browser verification — same blocker as Phase 1 (see
      "Outstanding from this session" below)
- Save-state format: skipped — no save-state feature exists yet for 48K either, so
  there's nothing to extend. Revisit if/when save-states are added for any model.

**Demo**: switch to 128K model, load a 128K game/tune, hear AY music alongside
beeper effects.

## Architectural Consolidation & Optimization Pass (2026-09-03)

- [x] **BaseMachine Extraction**: Unified 80%+ duplicate machine logic across `Machine48k` and `Machine128k` into `BaseMachine<M extends MemoryDevice>`. Both machines now share CPU, keyboard, tape, frame execution, and bus contention handling with polymorphic `getAudioSamples`.
- [x] **Single Source of Truth (SSoT)**: Centralized machine types (`MachineModel`, `FrameBuffer`, `MediaFormat`) and memory constants (`ROM_PAGE_SIZE`, `RAM_48K_SIZE`, `TOTAL_RAM_128K_BANKS`) in `@zx-spectrum/core`. Cleaned up redundant storage routines in favor of dedicated `romStorage` (`localStorage`) and `sessionStore` (IndexedDB).
- [x] **Hot Path & Allocation Optimization**:
  - `AyChip`: Precomputed counter reload limits (`toneLimit`, `noiseLimit`, `envelopeLimit`), eliminating over 100,000 operations per frame in the inner generator tick loop.
  - `UlaEngine`: Eliminated per-frame 76.8 KB garbage collection churn by caching and reusing internal framebuffer allocations.
  - `Display`: Reused `Uint32Array` view for canvas blitting.
  - `Z80`: Statically cached opcode tables and unified `ROTATE_OPS` across CB and Index-CB instruction dispatchers.
  - `KeyboardState`: Fast-pathed unselected keyboard matrix reads.
- [x] **Bug Fixes & Loader Deduplication**:
  - Fixed buffer capacity truncation bug in `decompressZ80Rle` for snapshots with large compression ratios.
  - Consolidated tape pause and standard ROM block serialization across `.tap` and `.tzx`.

## Tape library instant-load reliability pass (2026-09-05)

The tape library's one-click "select a saved tape, it just loads" flow
(`confirmInstantLoad`) had never been exercised in a real browser before this
session — only its individual pieces (`fastTapeLoad` itself, the IndexedDB
library storage) had unit coverage. A live Chrome smoke test surfaced four
bugs, each hidden behind the previous one:

- [x] **Detached-buffer crash**: both the tape-library instant-load path and
  the regular file-picker/drag-drop path sliced an `ArrayBuffer` for session
  persistence *after* transferring it to the worker (which detaches it),
  throwing on every single load and silently aborting mid-flow.
- [x] **Wrong 128K menu keystroke**: the instant-load flow sent `"3\n"`
  assuming digit keys select the Nth displayed menu row; they're actually
  direct hotkeys to the ROM's other four entries. `"3"` launched 48 BASIC,
  not the tape loader.
- [x] **128K ROM 0→ROM 1 transition hang**: root-caused via headless Z80
  instrumentation (comparing `Machine48k`, a directly-ROM1-paged
  `Machine128k`, and the normal ROM0-menu-then-ROM1 path) that navigating the
  128 menu before loading leaves the machine in a state where multi-stage
  custom-loader tapes (confirmed on Zaxxon) hang after the first blocks. Fixed
  by forcing ROM 1 paged in from a cold boot instead (`EmulatorClient.reset(pageRom1)`),
  bypassing the menu, and unifying the 48K/128K instant-load flow onto one
  code path. See "Tape library one-click instant load" in `docs/architecture.md`.
- [x] **Simulated-keystroke timing races**: a pre-existing bug (typing
  `LOAD ""` letter-by-letter instead of using the single K-cursor keyword
  key) and two timing margins too tight for sustained scripted use (boot-wait,
  inter-keystroke gap) — both widened after a full 16-tape library pass.

**Verified**: every tape in the saved library (`Tapes/TAP/*`, 16 files —
Zaxxon, Prince of Persia, Fairlight x4, The Hobbit x2, Jet Set Willy, Skool
Daze, Spy vs Spy, War in Middle Earth, Yie Ar Kung-Fu, aydete, Attribute2You,
128DEMO) now loads cleanly via the library's instant-load click with zero
console errors.

## Snapshot save (2026-09-05)

- [x] **`.sna` writer**: `writeSna48k`/`writeSna128k` (`packages/core/src/loaders/sna.ts`)
  serialize a live machine's CPU/memory/border state to standard `.sna` bytes — the
  reverse of the existing `parseSna`/`applySnapshotTo48k`/`applySnapshotTo128k`.
  Round-trip tested (write → parse → apply → verify) for both variants.
- [x] **UI**: a Save Snapshot button (controls panel, next to Reset) downloads
  `spectrum-<model>-<timestamp>.sna`.
- [x] **MCP**: a `save_snapshot` tool (headless or a connected browser instance,
  mirroring `read_screen`'s pattern).

Motivated by a real gap hit this session: asked to get an `.sna` for a specific
game, no pre-made one existed at the usual preservation archives (only `.tap`/`.tzx`
— `.sna` isn't really a distribution format, it's a snapshot of wherever someone's
emulator happened to be), so producing one meant loading the tape and dumping
machine state by hand. See "Snapshot save/load" in `docs/architecture.md`.

## UI: collapsible side panels + tape library management (2026-09-05)

- [x] **Two `position:fixed` side panels** replace the old two-row toolbar +
  bottom options bar: a left tape library panel and a right controls panel,
  each toggled by an always-visible edge tab (icon + vertical text label),
  mutually exclusive (opening one closes the other), closed by default,
  open/closed state persisted per-panel in `localStorage`.
- [x] **Tape library CRUD/bulk/filters**: per-item rename (inline, Enter/blur
  commits, Escape cancels) and delete, bulk select → export or delete
  (`removeTapes` batches one IndexedDB transaction), text search (name/
  filename) + format filter (TAP/TZX).
- [x] **Tape playback moved into the library panel**: since the library is
  where tape loading actually happens, transport (play/stop, eject), the
  loading-tone/fast-load toggles, and the general Insert Tape/Snapshot file
  picker all live there now instead of the controls panel.
- [x] **MCP bridge status indicator** moved out of the top bar into a new
  MCP BRIDGE group in the controls panel; the top bar now holds only the
  brand/logo.
- [x] **Icon + text labels throughout**, replacing icon-only-with-tooltip
  buttons — the tape library's bulk-action bar is the one deliberate
  exception (count text + 3 actions already fill the 280px row).

See "UI layout" in `docs/architecture.md`.

## Phase 4 — +3 support, Snapshot Export (.z80), Save States, AY Stereo Audio (done)

- [x] Second paging port (`0x1ffd`) + 4 special all-RAM modes in `MemoryPlus3` with Amstrad +3 contention (banks 4-7)
- [x] `ULA_PLUS3_PROFILE` timing profile (228 T-states/line x 311 lines, 32 T-state interrupt)
- [x] Scoped `Fdc765` (NEC uPD765A) — Specify, Sense Drive Status, Recalibrate, Sense Interrupt Status, Seek, Read Data, Write Data, Read ID
- [x] `.dsk` parser and serializer (Standard CPC "MV - CPC" + Extended CPC formats)
- [x] `MachinePlus3` composition with +3 contention, AY-3-8912, and uPD765 FDC
- [x] +3 ROM set handling (4 separate 16KB ROMs 0-3 or single 64KB bundle), floppy drive UI (activity LED, track indicator, insert/eject)
- [x] `.z80` v3 snapshot export (`writeZ8048k`, `writeZ80128k`, `writeZ80Plus3`) with memory block RLE compression and format selection (.sna / .z80) in UI & MCP
- [x] Save states system: 5-slot IndexedDB storage with canvas thumbnail preview and timestamp, F5 quick save, F8 quick load, direct external `.z80`/`.sna` loading into slot, and slot export (.z80 / .sna)
- [x] Snapshot panel consolidation: unified all memory and snapshot actions into the left panel's Snapshots & Memory tab, matching styling, button metrics, and typography with the Controls and Tape library panels
- [x] Worker on-the-fly format conversion (`exportState`): converts stored slot binaries between `.sna` and `.z80` formats seamlessly upon export
- [x] AY stereo audio: ACB (+3 default), ABC (Melodik), and mono modes with stereo AudioWorklet transport

**Demo**: boot +3 BASIC/+3DOS from a `.dsk` image, load disk software, save/load slot states with F5/F8, and export `.z80` snapshots.

## Audio Fidelity, Diagnostics & Screen Toolbar (2026-09-05)

- [x] **Beeper audio pipeline fix**:
  - Fixed `AudioWorklet` stereo channel consumption in `beeper-processor.js` (reading stereo sample pairs instead of mono floats), preventing ring buffer overflow dropouts, frame skipping, and 50Hz tearing buzz.
  - Added 2-channel stereo de-interleaving to fallback `AudioBuffer` allocation and playback in `AudioSink`.
  - Replaced point-sampling in `Beeper` with continuous-time boxcar integration anti-aliasing across sample intervals, eliminating phase quantization noise and aliasing.
- [x] **Mono beeper & AY stereo separation**:
  - Preserved pure mono beeper synthesis on hardware port 0xFE, mixed centered to left and right channels.
  - Tied AY stereo mode dropdown visibility to machine model (dynamically hidden for 48K; enabled for 128K and +3).
- [x] **Screen toolbar & diagnostics**:
  - Relocated Pause, Reset, Save (F5), and Load (F8) into a dedicated `.screen-toolbar` directly above the CRT screen frame.
  - Added live Diagnostics section in the controls panel with rolling 500ms FPS readout backed by the frame ring buffer sequence counter.
  - Added slot state deletion button to the Snapshots manager.

## Outstanding

- **Interactive browser verification is now routine**: as of the 2026-09-05 pass
  above, Claude-in-Chrome connects and drives the real UI (clicks, keystrokes,
  console/screenshot inspection) rather than relying only on `vite build` and
  headless Node smoke tests. The tape-library instant-load flow was verified
  this way end to end; ROM/`.sna` file-picker loading and audio have not been
  re-verified interactively since the persistence/tape-library refactors and
  would be worth another pass.
