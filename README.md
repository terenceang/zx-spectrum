# ZX Spectrum Emulator

A ZX Spectrum emulator written in TypeScript, running entirely client-side in the
browser (CPU/ULA emulation in a Web Worker), built for eventual deployment as a
static site. See [`docs/architecture.md`](docs/architecture.md) for how it's put
together and [`docs/roadmap.md`](docs/roadmap.md) for what's built vs. planned.

## Getting started

```sh
npm install
npm run dev       # Vite dev server at http://localhost:5173
```

Open the page, select 48K, 128K, or +3 mode, load the corresponding ROM file(s) (see below),
then drop in a `.sna`, `.z80` snapshot, `.tap`, `.tzx` tape file, or `.dsk` disk image to play.
The canvas sits in the center with quick **Pause**, **Reset**, **Save** (F5), and **Load** (F8) controls right above the screen.
Everything else lives in two collapsible side panels opened via the edge tabs:

- **Left panel** — contains two tabs:
  - **Tapes**: Tape library (IndexedDB-backed) with search, format filters, rename, and bulk export/delete, plus tape transport (play/stop, eject), loading-tone and fast-load toggles, and tape file picker. Clicking a saved tape drives a full `LOAD ""` end to end and loads in under a second via ROM fast-load traps.
  - **Snapshots**: 5-slot memory manager with instant thumbnail screenshot preview, timestamp display, slot state deletion, direct `.z80`/`.sna` loading into any slot, and slot export to `.z80` or `.sna` with on-the-fly format translation.
- **Right panel** — holds machine controls (model selector: 48K / 128K / +3), floppy disk drive A: controls (track indicator, activity LED, insert/eject `.dsk` images when in +3 mode), audio options (mute, volume, and AY stereo mode: ACB authentic +3, ABC Melodik, or Mono for 128K/+3; 48K beeper is pure mono), keyboard options, MCP bridge status, live diagnostics (FPS), and activity log with a Save Log export button.

### ROMs

This app does **not** bundle Sinclair/Amstrad ROM images — that's copyrighted
material. Supply your own ROM dump via the modal or settings on first run:

- **48K**: a single 16384-byte ROM dump
- **128K**: two 16384-byte ROM dumps (`128-0.rom` and `128-1.rom`)
- **+3**: four 16384-byte ROM dumps (`plus3-0.rom` through `plus3-3.rom`) or a single 65536-byte bundle

ROMs are cached in your browser's `localStorage` per machine model so you only need
to supply them once. Active tape, disk, and snapshot sessions persist across reloads.

## Testing

```sh
npm test                     # fast unit/integration suite
npm run test:cpu-exerciser   # zexdoc + zexall Z80 correctness suite (~15 min under vitest)
npm run typecheck
npm run lint
```

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

Point an MCP client at `node packages/mcp-server/dist/index.js` — already registered in `.mcp.json` for Claude Code in this repo.

## Legal

This project's own code is licensed under the [MIT License](LICENSE).

It is an independent, unofficial emulator with no affiliation to or endorsement
by Sky UK Limited or any other holder of the Sinclair/ZX Spectrum trademarks.
It does not bundle or distribute any Sinclair/Amstrad ROM images or copyrighted
game software — you must supply your own legally-obtained ROM/tape/snapshot
files, and you're responsible for how you use them.

## Author

**Terence Ang** (motionfxdesign) — [terenceang.com](https://terenceang.com) — v0.2.0

Vibe coded with [Claude Code](https://claude.com/claude-code).
