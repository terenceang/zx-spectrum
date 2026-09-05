## 2024-01-22 - XSS in Tape Library Rendering

**Vulnerability:** Cross-Site Scripting (XSS) vulnerability found in `packages/app/src/main.ts` where `tape.name`, `tape.filename`, and `tape.format` are directly interpolated into `innerHTML` strings without HTML escaping.
**Learning:** This codebase heavily uses raw DOM manipulation (`innerHTML`) rather than safer abstractions like React/Vue or `textContent`. User-controllable input (tape names, filenames) can easily become XSS vectors when directly embedded in HTML templates.
**Prevention:** Always use an `escapeHtml` utility function when interpolating variables into `innerHTML` strings, or prefer DOM methods like `textContent` that automatically escape input.
