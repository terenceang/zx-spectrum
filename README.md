# ZX Spectrum Emulator

A ZX Spectrum emulator written in TypeScript, running entirely client-side in the
browser (CPU/ULA emulation in a Web Worker), built for eventual deployment as a
static site. See [`docs/architecture.md`](docs/architecture.md) for how it's put
together.

## Getting started

```sh
npm install
npm run dev       # Vite dev server at http://localhost:5173
```

Open the page, select 48K, 128K, or +3 mode, load the corresponding ROM file(s) (see below),
then drop in a `.sna`/`.z80` snapshot or `.dsk` disk image to play immediately, or a `.tap`/`.tzx`
tape file to add it to the tape library (drag-and-drop and the library's **+ Add** button both just
add — see below for how loading and playing a tape actually works).
The canvas sits in the center with quick **Pause**, **Reset**, **Save** (F5), **Load** (F8), and **Fullscreen** controls right above the screen — fullscreen fills the viewport with just the display (`Escape` to exit).
Everything else lives in two collapsible side panels opened via the edge tabs:

- **Left panel** — contains two tabs:
  - **Tapes**: split into a **Tape Player** section (current-tape status, Play/Eject transport —
    both disabled until a tape is loaded — and the loading-tone/fast-load toggles) and a **Tape
    Library** section below it (IndexedDB-backed, with search, format filters, rename, and bulk
    export/delete). There's no direct tape file picker — add a `.tap`/`.tzx` to the library first,
    then click it to load it into the player (this only replaces what's currently loaded, asking
    for confirmation first if the player wasn't empty; loading never resets the machine or starts
    playback by itself). Press **Play** to actually run it: with **Fast load** checked, Play resets
    the machine and drives a full `LOAD ""` end to end via ROM fast-load traps, resolving in under a
    second regardless of the tape's real length (and loading tones are automatically silenced during
    this, whatever the Loading-tones toggle says); with Fast load unchecked, Play just starts the raw
    tape signal — cycle-accurate and real-time, with `LOAD ""` typed by hand, exactly like real
    hardware.
  - **Snapshots**: 5-slot memory manager with instant thumbnail screenshot preview, timestamp display, slot state deletion, direct `.z80`/`.sna` loading into any slot, and slot export to `.z80` or `.sna` with on-the-fly format translation.
- **Right panel** — holds machine controls (model selector: 48K / 128K / +3, ROM file loader & setup dialog), floppy disk drive A: controls (track indicator, activity LED, insert/eject `.dsk` images when in +3 mode), audio options (mute, volume, and AY stereo mode: ACB authentic +3, ABC Melodik, or Mono for 128K/+3; 48K beeper is pure mono), keyboard options, joystick emulation (Kempston/Sinclair 1/Sinclair 2/Cursor/QAOP with remappable keys and HID gamepad support — see below), MCP bridge status, live diagnostics (FPS), and activity log with a Save Log export button.

### ROMs

This app does **not** bundle Sinclair/Amstrad ROM images — that's copyrighted
material. Supply your own ROM dump via the modal or settings on first run:

- **48K**: a single 16384-byte ROM dump
- **128K**: two 16384-byte ROM dumps (`128-0.rom` and `128-1.rom`)
- **+3**: four 16384-byte ROM dumps (`plus3-0.rom` through `plus3-3.rom`) or a single 65536-byte bundle

ROMs are cached in your browser's `localStorage` per machine model so you only need
to supply them once. Active tape, disk, and snapshot sessions persist across reloads.

### Joystick

Pick an emulated joystick type in the right panel's JOYSTICK section:

- **Kempston** — emulated as the real I/O port (0x1F); auto-detected by most games.
- **Sinclair 1** (keys 1-5), **Sinclair 2** (keys 6-0), **Cursor** (keys 5,6,7,8,0),
  and **QAOP** (Q/A/O/P + Space) — emulated by pressing the corresponding Spectrum keys.

Click **Configure Keys…** to remap which PC keys drive each direction/fire (defaults to
the arrow keys + Space); bindings persist in `localStorage`. A connected HID gamepad
works automatically once a joystick type is selected — D-pad or left stick for
direction, any of the first 4 buttons for fire.

## Testing

All test suites currently pass with a **100% success rate** across unit tests, integration tests, the comprehensive hardware compatibility suite, and the exhaustive Z80 CPU exerciser:

```sh
npm test                     # fast unit/integration suite (17 files, 106 tests, ~6s)
npm run test:compatibility   # hardware compatibility test suite (26 tests, ~60ms)
npm run test:all             # complete verification: typecheck + lint + vitest
npm run test:cpu-exerciser   # zexdoc + zexall Z80 correctness suite (~14 min)
npm run typecheck            # TypeScript type checking (tsc -b)
npm run lint                 # ESLint checks
```

### Test Suite Status & Subsystem Verification

| Test Suite / Subsystem                                                                                |    Tests Passed    | Hardware Behaviors & Compatibility Verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| :---------------------------------------------------------------------------------------------------- | :----------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Z80 CPU Core Exerciser** (`zexdoc` / `zexall`)                                                      |  **2 / 2** (100%)  | Frank Cringle's gold-standard exerciser. Passes all documented opcodes and undocumented flag bits (XF/YF bits 3 & 5, DAA, half-carry, `IXH`/`IXL`/`IYH`/`IYL`, and `DDCB`/`FDCB` copy-back shifts).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Hardware Compatibility Suite** ([`compatibility.test.ts`](packages/core/src/compatibility.test.ts)) | **26 / 26** (100%) | Comprehensive hardware validation benchmarks across 48K, 128K, and +3 architectures:<br>• **Contention & Timing**: 48K contention window (`[6,5,4,3,2,1,0,0]` pattern), 128K odd-bank contention (1/3/5/7), +3 bank contention (4/5/6/7), exact frame budgets (48K: 69888T, 128K/+3: 70908T), and INT line durations.<br>• **128K Banking**: Independent paging of all 8 RAM banks at `0xC000`, ROM 0/1 selection, port `0x7FFD` lockout bit, and shadow screen (Bank 7 vs 5).<br>• **+3 Architecture**: All 4 special All-RAM configurations, RAM write capability in `0x0000..0x3FFF`, and FDC drive motor toggle.<br>• **ULA Display**: 3-third interleaved screen memory mapping, 16-frame flash attribute inversion, and beam-accurate mid-frame border stripes.<br>• **AY-3-8912 Audio**: Ports `0xFFFD`/`0xBFFD` register I/O, tone/noise/envelope generators, and stereo panning (ABC/ACB/Mono).<br>• **I/O & Bus Isolation**: 8-row keyboard matrix combinations, Kempston joystick isolation on port `0x1F`, and floating bus (`0xFF` on unmapped ports).<br>• **Tape & Traps**: ROM `LD-BYTES` (0x0556) and `LD-SEARCH` (0x0569) fast traps with checksum verification, plus model-specific ROM gating.<br>• **Floppy Controller**: +3 FDC µPD765 I/O routing (`0x2FFD` MSR, `0x3FFD` Data, Seek, Sense Interrupt Status).<br>• **Snapshots**: Full round-trip state restoration for 48K and 128K `.sna` formats. |
| **Tape Loading & Audio Player**                                                                       | **32 / 32** (100%) | Instant ROM trap injection for commercial titles (Fairlight 48K/128K, The Hobbit 48K), pulse-level fallback for custom/protected loaders (Speedlock), TZX block parsing (0x10-0x14, 0x20-0x22, 0x30, 0x32, 0x33), and TAP edge transitions. Includes an explicit-option smoke test that loads The Hobbit both fast (instant) and slow (cycle-accurate) on 48K.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Audio Synthesis**                                                                                   |  **8 / 8** (100%)  | Beeper boxcar anti-aliased filtering, DC blocker high-pass filter, AY-3-8912 envelope shapes, and stereo mixing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Machine Integration**                                                                               | **12 / 12** (100%) | Machine48k, Machine128k, and MachinePlus3 boot sequences, real +3 ROM resets, I/O port dispatching, and loading-tone audio being silenced while fast tape load is active regardless of the Loading-tones toggle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Disk Subsystem**                                                                                    |  **5 / 5** (100%)  | Standard & Extended CPC `.dsk` image parser/writer and µPD765 FDC floppy drive controller state machine.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Snapshot Loaders & Serializers**                                                                    | **16 / 16** (100%) | `.sna` and `.z80` (v1, v2, v3) parsing, decompression, bank allocation, and serialization — including the `writeZ80`/`applySnapshot` dispatchers that pick the right format per machine model (48K vs. 128K/+3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **MCP Headless Server**                                                                               |  **1 / 1** (100%)  | PNG screenshot generator with CRC32 calculation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Production build

```sh
npm run build       # packages/app/dist — a static site
npm run preview -w @zx-spectrum/app   # serve it locally with the required headers
```

Deploying behind nginx/Caddy? See the **Deployment** section of
[`docs/architecture.md`](docs/architecture.md) — `SharedArrayBuffer` (used for the
fast frame/audio transport) requires two response headers
(`Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy`) the web server must
send; without them the app still works, just slower.

## MCP server

`packages/mcp-server` exposes the emulator as MCP tools:

- `load_rom`: load 48K, 128K, or +3 ROM images (single or multi-file)
- `load_snapshot`: load `.sna` or `.z80` (v1/v2/v3) snapshots
- `save_snapshot`: save running emulator state as `.sna` or `.z80` snapshot
- `load_tape` / `play_tape` / `stop_tape`: cassette playback with optional ROM fast-load
- `insert_disk` / `eject_disk`: insert/eject `.dsk` (Standard and Extended CPC) disk images
- `press_key` / `get_status` / `run_frames`: headless input and execution
- `read_screen`: screenshot capture as PNG with hand-rolled CRC32

Point an MCP client at `node packages/mcp-server/dist/index.js`.

## Legal

This project's own code is licensed under the [MIT License](LICENSE).

It is an independent, unofficial emulator with no affiliation to or endorsement
by Sky UK Limited or any other holder of the Sinclair/ZX Spectrum trademarks.
It does not bundle or distribute any Sinclair/Amstrad ROM images or copyrighted
game software — you must supply your own legally-obtained ROM/tape/snapshot
files, and you're responsible for how you use them.

## Author

**Terence Ang** (motionfxdesign) — [terenceang.com](https://terenceang.com) — v1.0.0
