# Project Instructions

You are assisting with development of this Home Assistant Lovelace custom card project.
The codebase is TypeScript + Lit and builds with Rollup.

Use these instructions as project-specific guardrails when generating, editing, or reviewing code.

## Quick reference

### Core commands

```bash
yarn install
yarn start
yarn build
yarn lint
```

### Primary files

- `src/index.ts` — bundle entry; imports every card so it registers
- `src/cards/bedjet/bedjet-card.ts` — BedJet card implementation
- `src/cards/bedjet/bedjet-card-editor.ts` — BedJet visual editor (`LovelaceCardEditor`)
- `src/cards/bedjet/bedjet-card-types.ts` — BedJet config and type definitions
- `src/shared/action-handler-directive.ts` — tap/hold/double-tap directive
- `src/shared/const.ts` — `CARD_VERSION` constant
- `src/shared/localize/localize.ts` — localization helper
- `src/shared/localize/languages/*.json` — translation files
- `rollup.config.js` and `rollup.config.dev.js` — production and dev build config

## Architecture and patterns

- Each card lives in `src/cards/<card>/` and is added to the bundle by importing it in `src/index.ts`.
- The BedJet custom element is `custom:sf-bedjet-card`.
- Prefer Lit 3 patterns and idiomatic web component structure.
- Keep configuration shape centralized in `src/types.ts`.
- Keep editor schema and defaults aligned with runtime card behavior.
- Keep feature logic in small, readable helpers instead of long monolithic methods.

## TypeScript standards

- Use strict, explicit typing; avoid `any` unless there is no practical alternative.
- Use `import type` for type-only imports where appropriate.
- Validate and narrow optional config fields before use.
- Keep public API names stable unless explicitly requested to change them.

## Lit and component guidance

- Use `@property` for public reactive inputs and `@state` for internal state.
- Avoid direct DOM mutation when Lit reactivity can handle updates.
- Preserve existing card/editor lifecycle behavior.
- For card config, validate early in `setConfig` and throw actionable errors.
- Keep `getCardSize` deterministic and aligned with rendered density.

### Quick checklist

- [ ] **Updates:** Keep `useDefineForClassFields: false` with Lit decorators; if overriding `shouldUpdate`, allow relevant `hass` changes through for every entity the card renders. This keeps reactive accessors working so the UI stays in sync with device state.
- [ ] **Configurable size:** Implement `getGridOptions()` with defaults and resize bounds; make the card fill and adapt to its allocated Sections grid cell, while retaining `getCardSize()` for Masonry.

## Home Assistant integration

- Use Home Assistant helpers and conventions from `custom-card-helpers`.
- Ensure tap, hold, and double-tap actions are wired through existing action patterns.
- Support unavailable/loading/error states gracefully.
- Keep Lovelace config compatibility in mind when changing schema or defaults.

## Localization and copy

- Do not hardcode user-facing strings when a localize key should be used.
- Add new translation keys to both language files currently in the repo (`en.json`, `nb.json`).
- Keep copy concise, sentence case, and user-facing.
- Favor consistent terminology across card UI and editor labels.

## Styling and UX

- Respect Home Assistant theme variables and CSS custom properties.
- Avoid hardcoded colors when theme tokens can be used.
- Keep spacing and typography consistent with existing card styles.
- Ensure layouts work in both compact and wider dashboard widths.

## Build and quality expectations

- Keep `yarn lint` clean for changed code.
- Ensure `yarn build` succeeds after non-trivial changes.
- Do not introduce unrelated refactors in focused changes.
- If updating build tooling, keep dev and prod Rollup configs consistent.

## Safe change workflow

1. Read adjacent code before editing.
2. Implement the smallest viable change.
3. Run relevant checks (`yarn lint`, `yarn build`, or targeted command).
4. Update docs/README when behavior or config changes.
5. Summarize what changed and why.

## Releasing

Releases are Git tags surfaced to HACS via a GitHub release. Before tagging:

1. Bump `version` in `package.json` and `CARD_VERSION` in `src/shared/const.ts`.
2. Commit the change, then run:

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z"
```

## Pull request guidance

- Keep PRs focused to one logical change.
- Include screenshots or short clips for visible UI/editor changes.
- Document config changes and migration notes when applicable.
- Call out any follow-up work explicitly instead of bundling extra scope.

## Avoid these common issues

- Breaking editor/card config parity
- Adding untyped dynamic config access
- Hardcoding text instead of localization keys
- Overriding theme behavior with fixed styles
- Changing output filenames or card tag without explicit request
