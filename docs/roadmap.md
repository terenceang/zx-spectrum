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
- [x] App: `.tap`/`.tzx` accepted by the same file input/drag-drop as snapshots
- [ ] Optional fast-load trap (`Machine` setting, off by default) — skipped for
      now, add if load-time UX becomes a complaint; accurate playback is the
      only path today

**Verified against the real 48K ROM, not just our own parser**: hand-built a
synthetic `.tap` data block, ran it through `parseTap` -> `TapeEdgePlayer`, and
called the ROM's actual `LD-BYTES` routine (0x0556) against it — the ROM decoded
the pulses and wrote back the exact expected bytes. This is the strongest evidence
available that the pulse timings (pilot/sync/bit0/bit1 durations) are correct,
since it's real 1982 machine code doing the verification, not our own logic
checking itself.

**Demo**: load a `.tap`/`.tzx` through the Spectrum's own ROM loader and watch it
load with real loading stripes/sound.

## Phase 3 — 128K/+2 support

- [ ] `Memory128k` (banked, shared `BankedMemoryCore` with +3)
- [ ] `Ula128k` timing profile (70908 T-states/frame)
- [ ] `AyChip` (AY-3-8912, 3 tone + noise + envelope generators)
- [ ] `Machine128k`, model selector UI
- [ ] Extend `.z80`/`.sna` loaders' already-parsed 128K bank data into
      `Machine128k` (the loaders already parse this — see `banks`/`pagedBanks` in
      `ParsedZ80Snapshot`/`ParsedSnaSnapshot`)
- [ ] Save-state format extended for banked memory + AY registers

**Demo**: switch to 128K model, load a 128K game/tune, hear AY music alongside
beeper effects.

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
