#!/usr/bin/env node
/**
 * Locale completeness check.
 *
 * TypeScript already makes a missing key a compile error, because every locale
 * is typed as `Messages`. This catches the things types cannot:
 *
 *   - a key present but left as an empty string
 *   - a key left untranslated, still identical to the English source
 *   - placeholders like {time} dropped or renamed in a translation, which would
 *     silently print a literal brace to the user
 *
 * Runs in CI and exits non-zero on a real problem. Untranslated strings are
 * reported as warnings, since a few (product name, "Ion", "Aurora") are
 * legitimately the same in every language.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const localesDir = join(here, '..', 'packages', 'core', 'src', 'i18n', 'locales');

/** Extracts `'key': 'value'` pairs without needing to compile TypeScript. */
function parseLocale(source) {
  const entries = new Map();
  const pattern = /'([\w.]+)':\s*(?:\n\s*)?((?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")(?:\s*\+\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"))*)/g;

  for (const match of source.matchAll(pattern)) {
    const [, key, rawValue] = match;
    const value = rawValue
      .split(/\s*\+\s*/)
      .map((part) => part.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"'))
      .join('');
    entries.set(key, value);
  }
  return entries;
}

const files = readdirSync(localesDir).filter((name) => name.endsWith('.ts'));
const locales = new Map();

for (const file of files) {
  const code = file.replace(/\.ts$/, '');
  locales.set(code, parseLocale(readFileSync(join(localesDir, file), 'utf8')));
}

const reference = locales.get('en');
if (!reference || reference.size === 0) {
  console.error('✗ Could not read the English reference locale.');
  process.exit(1);
}

const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

let errors = 0;
let warnings = 0;

console.log(`Checking ${locales.size} locales against ${reference.size} English keys.\n`);

for (const [code, table] of [...locales].sort()) {
  if (code === 'en') continue;

  const missing = [];
  const empty = [];
  const badPlaceholders = [];
  const untranslated = [];

  for (const [key, englishValue] of reference) {
    const value = table.get(key);

    if (value === undefined) {
      missing.push(key);
      continue;
    }
    if (value.trim().length === 0) {
      empty.push(key);
      continue;
    }

    const expected = placeholders(englishValue).join(',');
    const actual = placeholders(value).join(',');
    if (expected !== actual) {
      badPlaceholders.push(`${key}  expected {${expected}} got {${actual}}`);
    }
    if (value === englishValue) untranslated.push(key);
  }

  const extra = [...table.keys()].filter((key) => !reference.has(key));

  const failed = missing.length + empty.length + badPlaceholders.length + extra.length;
  const status = failed === 0 ? '✓' : '✗';
  console.log(`${status} ${code}  ${table.size}/${reference.size} keys`);

  for (const key of missing) console.log(`    missing: ${key}`);
  for (const key of empty) console.log(`    empty: ${key}`);
  for (const line of badPlaceholders) console.log(`    placeholder mismatch: ${line}`);
  for (const key of extra) console.log(`    unknown key: ${key}`);

  if (untranslated.length > 0) {
    warnings += untranslated.length;
    console.log(`    note: ${untranslated.length} string(s) identical to English`);
  }
  errors += failed;
}

console.log('');
if (errors > 0) {
  console.error(`✗ ${errors} problem(s) found.`);
  process.exit(1);
}
console.log(`✓ All locales complete.${warnings ? ` (${warnings} identical-to-English notes)` : ''}`);
