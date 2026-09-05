# AGENTS.md

## Quick Reference

```sh
npm install                    # install all workspace dependencies
npm run dev                    # start dev server (Vite + MCP server)
npm test                       # fast unit/integration tests
npm run test:cpu-exerciser     # Z80 correctness suite (~15 min)
npm run typecheck              # TypeScript type checking
npm run lint                   # ESLint
npm run build                  # build all packages
```

## Monorepo Structure

npm workspaces monorepo with TypeScript project references:

- `packages/core` — Pure TS emulator engine (Z80 CPU, memory, ULA, loaders, `BaseMachine` hierarchy). No DOM/Worker APIs — isolated for testability.
- `packages/worker` — Web Worker glue with `SharedArrayBuffer` ring buffers for frame/audio transport.
- `packages/app` — Vite + vanilla TS UI (canvas, keyboard/joystick, audio, file loading).
- `packages/mcp-server` — Headless MCP server exposing emulator as tools.
- `packages/test-fixtures` — Test-only binary assets (CPU exerciser binaries).

## Build Order

`tsc -b` uses project references. Build order: core → worker → app → mcp-server. The root `npm run build` script handles this automatically. When building individual packages, ensure dependencies are built first.

## Testing

- `npm test` runs fast tests, excludes CPU exerciser by default.
- CPU exerciser (`packages/core/src/cpu/zexdoc.test.ts`) is the gold-standard Z80 correctness check. Run explicitly after any CPU changes.
- Tests use Vitest with Node environment.
- Test files: `packages/*/src/**/*.test.ts`.

## Deployment

**Critical**: `SharedArrayBuffer` requires cross-origin isolation headers:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without these headers, app falls back to slower `postMessage` transport silently. Vite dev/preview servers send these headers automatically.

Keep all assets same-origin — COEP `require-corp` breaks cross-origin subresources.

## MCP Server

- Uses stdio transport, designed for MCP client driving.
- Imports core via relative path to compiled `dist/` (not package name) because plain Node can't execute raw `.ts` source.
- `read_screen` returns PNG with hand-rolled CRC32 (Node's `zlib` lacks it).

## Development Server

`npm run dev` starts both:
1. MCP server (builds first, then runs on port 8790)
2. Vite dev server (default port 5173, auto-increments if busy)

## Code Style

- Prettier: 100 char width, trailing commas.
- ESLint: TypeScript recommended rules, unused vars warn with `_` prefix ignore.
- No comments unless requested.
- Follow existing patterns in neighboring files.

## Common Pitfalls

- Port conflicts: MCP server uses 8790, Vite uses 5173+. Check if ports are in use.
- ROM files not bundled: User must supply own legally-obtained ROM dumps.
- CPU exerciser not in default test run: Must run explicitly after CPU changes.
- Cross-origin isolation: Missing headers cause silent performance degradation.
- Machine models: Extend `BaseMachine<M>` when implementing new models (e.g. +3) to inherit timing, contention, and audio handling.

## Known Issues & Software Quirks

- Fairlight 128K: top of screen displays raw staging data after tape loading during the title tune until key press (fixes itself on key press). This is authentic behavior of the original 1985 game release — tape blocks 19 & 21 temporarily reuse screen memory (`0x4000..0x59AA`) as a scratch buffer for compressed data, and the game enters the title music playback loop before calling its screen restoration routine (`0x7C39`) from Bank 4.