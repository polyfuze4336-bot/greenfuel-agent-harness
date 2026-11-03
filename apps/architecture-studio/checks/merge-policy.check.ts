import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MergePolicyReader, interpretRules, mergePolicyMode } from '../src/lib/github/merge-policy.ts';
import type { GitHubApi } from '../src/lib/github/api.ts';

// What GitHub says protects the canonical branch, and what the Studio does with it.

const NOW = new Date('2026-11-03T00:00:00Z');
const PR = { type: 'pull_request', parameters: {} };
const CHECKS = { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'validate' }, { context: 'gate' }, { context: 'validate' }] } };

describe('reading the rules on the canonical branch', () => {
  it('is enforced when a pull request and passing checks are required, and lists each check once', () => {
    const p = interpretRules([PR, CHECKS, { type: 'non_fast_forward' }], 'main', NOW);
    assert.equal(p.state, 'enforced');
    assert.deepEqual(p.requiredChecks, ['validate', 'gate']);
    assert.equal(p.blocksForcePush, true);
    assert.match(p.detail, /requires a pull request and 2 passing checks/);
  });

  it('is partial when pull requests are required but nothing validates them', () => {
    const p = interpretRules([PR], 'main', NOW);
    assert.equal(p.state, 'partial');
    assert.match(p.detail, /without validation/);
    assert.equal(interpretRules([PR, { type: 'required_status_checks', parameters: { required_status_checks: [] } }], 'main', NOW).state, 'partial');
  });

  it('is absent when no rule requires a pull request, even if other rules exist', () => {
    assert.equal(interpretRules([], 'main', NOW).state, 'absent');
    assert.equal(interpretRules([CHECKS, { type: 'deletion' }], 'main', NOW).state, 'absent');
    assert.match(interpretRules([], 'main', NOW).detail, /Classic branch protection is not readable/);
  });

  it('copes with rules it does not know', () => {
    const p = interpretRules([PR, CHECKS, { type: 'a_rule_invented_next_year', parameters: { x: 1 } } as never], 'main', NOW);
    assert.equal(p.state, 'enforced');
  });
});

describe('the reader', () => {
  const api = (answers: (() => unknown)[]) => {
    let n = 0;
    const calls: string[] = [];
    return {
      calls,
      api: {
        request: async (_m: string, path: string) => {
          calls.push(path);
          const a = answers[Math.min(n++, answers.length - 1)]!();
          return { status: 200, data: a, headers: new Headers() };
        },
      } as unknown as GitHubApi,
    };
  };
  const boom = () => {
    throw new Error('GitHub is rate limiting the Studio. Try again in 30 seconds.');
  };

  it('asks for the right branch of the right repository and keeps the answer for the cache time', async () => {
    const t = { now: NOW.getTime() };
    const { api: a, calls } = api([() => [PR, CHECKS]]);
    const r = new MergePolicyReader(a, 'acme/greenfuel', 'main', 60_000, () => new Date(t.now));
    assert.equal((await r.read()).state, 'enforced');
    assert.equal((await r.read()).state, 'enforced');
    assert.deepEqual(calls, ['/repos/acme/greenfuel/rules/branches/main']);
    t.now += 61_000;
    await r.read();
    assert.equal(calls.length, 2);
  });

  it('a failure is unknown, says why, never throws, and is not remembered', async () => {
    const { api: a, calls } = api([boom, () => [PR, CHECKS]]);
    const r = new MergePolicyReader(a, 'acme/greenfuel', 'main');
    const first = await r.read();
    assert.equal(first.state, 'unknown');
    assert.match(first.detail, /rate limiting/);
    assert.equal((await r.read()).state, 'enforced', 'asked again, not stuck on the failure');
    assert.equal(calls.length, 2);
  });

  it('a weak policy is remembered only for the cache time, so a ruleset added later is noticed', async () => {
    const t = { now: NOW.getTime() };
    const { api: a } = api([() => [], () => [PR, CHECKS]]);
    const r = new MergePolicyReader(a, 'acme/greenfuel', 'main', 1000, () => new Date(t.now));
    assert.equal((await r.read()).state, 'absent');
    t.now += 1500;
    assert.equal((await r.read()).state, 'enforced');
  });

  it('an answer that is not a list is unknown', async () => {
    const { api: a } = api([() => ({ message: 'surprise' })]);
    assert.equal((await new MergePolicyReader(a, 'o/r', 'main').read()).state, 'unknown');
  });

  it('force reads again', async () => {
    const { api: a, calls } = api([() => [PR]]);
    const r = new MergePolicyReader(a, 'o/r', 'main');
    await r.read();
    await r.read(true);
    assert.equal(calls.length, 2);
  });
});

describe('the mode', () => {
  it('defaults to require, and only warn or off relax it', () => {
    const was = process.env.STUDIO_MERGE_POLICY;
    try {
      delete process.env.STUDIO_MERGE_POLICY;
      assert.equal(mergePolicyMode(), 'require');
      for (const [v, want] of [['warn', 'warn'], ['OFF', 'off'], ['', 'require'], ['allow-everything', 'require'], ['true', 'require']] as const) {
        process.env.STUDIO_MERGE_POLICY = v;
        assert.equal(mergePolicyMode(), want, v);
      }
    } finally {
      if (was === undefined) delete process.env.STUDIO_MERGE_POLICY;
      else process.env.STUDIO_MERGE_POLICY = was;
    }
  });
});
