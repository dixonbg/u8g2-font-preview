# Repository Guidelines

## Project Structure & Module Organization
- `index.html`: Main application (HTML, CSS, and JavaScript in one file). This is the primary place for UI, filtering logic, BDF parsing, and canvas rendering.
- `gen-heights.js`: Node.js maintenance script that fetches U8g2 font metadata and patches the embedded height lookup table in `index.html`.
- `render.png`: Reference render output/image asset.
- `CLAUDE.md`: Local contributor notes about architecture and data flow.

Keep changes focused: UI/runtime behavior belongs in `index.html`; data-table regeneration belongs in `gen-heights.js`.

## Build, Test, and Development Commands
- `python3 -m http.server 8080`
  - Starts a local server for development. Use `http://localhost:8080` (not `file://`, because the app uses `fetch()`).
- `node gen-heights.js`
  - Rebuilds font height metadata and patches the `/* HEIGHTS_START */ ... /* HEIGHTS_END */` block in `index.html`.

## Coding Style & Naming Conventions
- Use 2-space indentation across HTML, CSS, and JavaScript.
- Prefer descriptive `camelCase` for JS functions/variables (for example, `parseFontList`, `renderText`).
- Keep CSS custom properties in `:root` and reuse existing color/token naming patterns (`--bg`, `--accent`, etc.).
- Preserve the no-dependency approach (vanilla JS, no build tooling) unless explicitly discussed.

## Testing Guidelines
- There is no automated test framework in this repository today.
- Validate changes manually in browser:
  - Load the app, select several fonts, and verify preview rendering.
  - Exercise search + filter combinations (height/mode/charset).
  - Confirm external links and data fetch behavior still work.
- If you regenerate heights, verify `index.html` changed only in the marked heights section.

## Commit & Pull Request Guidelines
- Follow concise, imperative commit subjects (current history examples: `Initial commit`, `Add ... renderer ...`).
- Keep commits scoped to one concern (UI behavior, parser fix, metadata refresh).
- PRs should include:
  - Short problem/solution summary.
  - Manual verification steps performed.
  - Screenshots or GIFs for visible UI changes.
  - Linked issue/context when available.

## Security & Configuration Notes
- Do not add secrets or tokens; this project uses public upstream URLs only.
- Treat external fetch endpoints as dependencies: document any URL changes in the PR description.
