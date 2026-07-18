# Contributing

Thanks for looking. Issues and pull requests are welcome.

## Translations

Every string lives in `packages/core/src/i18n/locales/<code>.ts` and is typed
against the `Messages` interface, so a missing key is a compile error rather
than a blank label in production.

To fix or improve a translation, edit that file and run `npm run typecheck`.
To add a language: add the code to `LOCALE_CODES` and its metadata to `LOCALES`
in `locales.ts`, then create the locale file. TypeScript will list exactly what
is missing.

Please translate meaning, not words. The tone is calm and direct: short
sentences, no exclamation marks, second person.

## Adding an effect

1. Create `packages/visuals/src/effects/<id>.ts` exporting a `FocusEffect`.
2. Add name and description keys to `Messages` and to all locale files.
3. Register it in `packages/visuals/src/effects/registry.ts`.

It then appears in the settings picker automatically. Preview it without
waiting for a real cycle:

```bash
cd packages/desktop
npx electron-vite build
npx electron scripts/capture-preview.mjs out.png "effect=<id>&lensing=1"
```

## Code

- `npm run typecheck` must pass.
- Keep `packages/core` free of platform APIs — it has to run on mobile later.
- Comments should explain constraints and reasoning, not restate the code.
