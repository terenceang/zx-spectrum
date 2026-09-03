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
- [x] Fast-load trap and auto-start on tape load — intercepts ROM `LD-BYTES` (0x0556)
      and `LD-SEARCH` (0x0569) to load tape blocks instantly with flag and parity verification;
      automatically triggers 128K Tape Loader or enters `LOAD ""` on 48K machines upon tape
      insertion so games load and start immediately with zero manual typing required.

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

## Phase 4 — +3 support

- [ ] Second paging port (`0x1ffd`) + special all-RAM modes in `MemoryPlus3`
- [ ] `UlaPlus3` timing profile
- [ ] Scoped `Fdc765` (uPD765) — only the commands +3DOS software actually uses
- [ ] `.dsk` loader (standard + extended CPC formats)
- [ ] +3 ROM set, disk insert/eject UI

**Demo**: boot +3 BASIC/+3DOS from a `.dsk` image and load a disk-based game.

## Outstanding from this session

- **Interactive browser verification**: the Claude-in-Chrome extension was not
  connected this session, so UI interaction (file pickers, keyboard, canvas
  rendering, audio) was verified only via a production `vite build` (catches
  bundling errors — this is how a `?url`-on-`.ts` MIME-type/transpilation bug in
  the AudioWorklet processor loading was caught and fixed) and a Node-level
  `Machine48k` smoke test against a real 48K ROM (confirms the CPU/ULA pipeline
  produces the expected BASIC boot screen). Recommend an in-browser pass — load a
  ROM, load a `.sna` game, confirm keyboard input and audio — before calling Phase
  1 done.
