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

Open the page, load a 48K ROM file (see below), then drop in a `.sna` or `.z80`
snapshot to play.

### ROM

This app does **not** bundle Sinclair/Amstrad ROM images — that's copyrighted
material. Supply your own 48K ROM dump (16384 bytes) via the file picker on first
run; it's cached in your browser's IndexedDB so you only need to do this once.

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

`packages/mcp-server` exposes the emulator as MCP tools (load ROM/snapshot/tape,
press keys, run frames, read the screen as a PNG) so an MCP client can drive it
headlessly. Build it (`npm run build --workspace=@zx-spectrum/mcp-server`, or just
`npm run build`), then point an MCP client at
`node packages/mcp-server/dist/index.js` — already registered in `.mcp.json` for
Claude Code in this repo.

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
