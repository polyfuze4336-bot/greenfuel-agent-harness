// Fixture calculation check. Not application code and not a certification-scheme method. Protected: a repair may not change it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emissionsKg } from './calc.mjs';

const d = JSON.parse(readFileSync(new URL('./fixture-data.json', import.meta.url), 'utf8'));

test('the fixture calculation gives the separately documented expected result', () => {
  assert.equal(emissionsKg(d.massKg, d.factorKgPerKg), d.expectedKg);
});
