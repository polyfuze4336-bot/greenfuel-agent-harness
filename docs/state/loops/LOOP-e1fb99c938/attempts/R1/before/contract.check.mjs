// Fixture contract check. Not application code. Protected: a repair may not change it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getItem } from './api/handler.mjs';

const contract = JSON.parse(readFileSync(new URL('./contract/item.contract.json', import.meta.url), 'utf8'));

test('getItem matches the item contract', () => {
  const item = getItem(3);
  for (const k of contract.required) assert.ok(k in item, `missing field ${k}`);
  for (const [k, t] of Object.entries(contract.types)) assert.equal(typeof item[k], t, `field ${k} must be a ${t}`);
});
