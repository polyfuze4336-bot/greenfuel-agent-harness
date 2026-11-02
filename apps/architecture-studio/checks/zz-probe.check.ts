import assert from 'node:assert/strict';
import { it } from 'node:test';
// Deliberately failing: proves a failing required check blocks the owner's admin merge. This PR is never merged.
it('probe: deliberately failing', () => { assert.equal(1, 2); });

