# YT Localizer — agent notes

Chrome MV3 + TypeScript + Vite (`extension/`), shared logic in `shared/`, CLI in `cli/`, tests via vitest.
Architecture: `docs/ARCHITECTURE.md`. Design system: `design.md` (from `docs/DESIGN-BRIEF.md`).

## UI rules (design system)

1. Read `extension/src/ui/tokens.css` and `design.md` before touching UI. Use only `var(--ytl-*)` tokens;
   **no raw hex, px spacing, radius or shadow values in component CSS** (`extension/src/ui/tokens.test.ts` enforces this).
2. Reuse existing components (`.ytl-btn`, `.ytl-chip`, `.ytl-badge`, `.ytl-toggle`/`.ytl-switch`, `.ytl-notice`,
   `.ytl-progress`, `.ytl-segmented`, `.ytl-card`, the `.vt-panel` modal layout, `statusBadge()` for row states).
   Don't create a new one without saying why.
3. Every interactive component must implement the full state matrix (design.md §2) and `:focus-visible`.
4. New token? Add it at the right tier (semantic first) in `tokens.css` and document it in `design.md`;
   never hard-code "just this once".
5. No dark green, no green at all. Accent = blue tokens only; success = blue check icon + text.
6. Keep content-script DOM isolated: everything under `.ytl-root` and our three root ids
   (`#veil-translate-btn`, `#vt-job-widget`, `#vt-modal-root`) so Studio CSS can't leak in or out.
7. After changes: `npm run typecheck`, `npm test`, `npm run build`, an a11y self-check (contrast, keyboard path),
   then summarize the diff for human review. Don't commit or push unless asked.
