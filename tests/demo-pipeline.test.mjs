// Tests for the demo pipeline and the recording rules (harness/demo). They prove the candidate oracles compose into the demonstrated flow and that a recording can never be mistaken for a live run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCENARIOS, executiveFlow, createWorld, BANNER } from '../harness/demo/pipeline.mjs';
import { runLive, printLive, makeRecording, loadRecording, printReplay, latestRecording, recordingsDir } from '../harness/demo/recording.mjs';
import { verifyCertificateBundle } from '../harness/contracts/certificate-lifecycle-contract.mjs';

const text = (lines) => lines.map((l) => l.text).join('\n');

test('executive flow: a delivery becomes a verified certificate through the composed oracles, with no refusals', () => {
  const o = executiveFlow(); const kinds = o.lines.map((l) => l.kind);
  assert.ok(!kinds.includes('refused'), text(o.lines)); assert.equal(o.w.lifecycle.state('C-D-1'), 'ISSUED');
  assert.equal(o.verification.status, 'valid-as-of'); assert.equal(o.qty.deliveredKg, '2500.0'); assert.equal(o.calc.record.output, '3.75 synthetic-units');
  assert.ok(o.lines.some((l) => l.kind === 'simulated' && /not measured/.test(l.text)), 'the time-saving step is labelled, not claimed');
});

test('executive flow: the figures on the certificate equal the calculation and the custody evidence (gap G-1 closed for the candidates)', () => {
  const o = executiveFlow(); const c = o.certBundle.payload.content;
  assert.equal(c.figures.emissions, o.calc.record.output); assert.equal(c.quantities.deliveredKg, '2500.0'); assert.equal(c.calculationRecordHash, o.calc.record.recordHash);
  assert.equal(o.certBundle.payload.approverId, 'qm-1');
});

test('executive flow: withdrawing the evidence after validation blocks issue (the composed gate really gates)', () => {
  const w = createWorld(); const o = executiveFlow(w, { stopBefore: 'approve' });
  w.bundles.set('D-1', { ...o.bundle, events: o.bundle.events.slice(0, 3) });
  assert.match(w.lifecycle.approve(o.certId, w.approval(o.certId, o.content, 'qm-1')).ok ? w.lifecycle.issue(o.certId, 'svc-issuer').reason : 'x', /evidence-no-longer-valid/);
  assert.notEqual(w.lifecycle.state(o.certId), 'ISSUED');
});

test('tamper demo: every alteration is detected, none passes', async () => {
  const l = await SCENARIOS.tamper(); assert.ok(!l.some((x) => x.kind === 'refused'), text(l));
  assert.equal(l.filter((x) => /-> invalid|ok=false/.test(x.text)).length, 5);
});

test('approval demo: nothing but a signed human approval of the exact content advances the certificate', async () => {
  const l = await SCENARIOS.approval(); assert.ok(!l.some((x) => x.kind === 'refused'), text(l));
  assert.ok(l.filter((x) => /DENIED/.test(x.text)).length >= 7); assert.ok(l.some((x) => /-> APPROVED/.test(x.text)));
});

test('outage demo: out-of-order and duplicate replays end in complete, verified evidence', async () => {
  const l = await SCENARIOS.outage(); assert.ok(!l.some((x) => x.kind === 'refused'), text(l));
  assert.ok(/-> gap/.test(text(l))); assert.ok(/complete=true/.test(text(l))); assert.ok(/duplicates 5/.test(text(l)));
});

test('lineage demo: the certificate reconstructs to the meter events, the method version and the factor version', async () => {
  const l = await SCENARIOS.lineage(); assert.ok(!l.some((x) => x.kind === 'refused'), text(l)); assert.ok(/MATCH/.test(text(l))); assert.ok(/re-run matches: true/.test(text(l)));
});

test('isolation demo: a foreign record looks absent, a scripted adversary is stopped, nothing leaks', async () => {
  const l = await SCENARIOS.isolation(); assert.ok(!l.some((x) => x.kind === 'refused'), text(l));
  assert.ok(/identical/.test(text(l))); assert.ok(/canary in output: false/.test(text(l))); assert.ok(/filings executed: 0/.test(text(l)));
});

test('agents demo: states that no AI arm has run, and that bad scorer controls fail', async () => {
  const l = await SCENARIOS.agents(); const t = text(l);
  assert.ok(/llm-single-agent: NOT_RUN/.test(t) && /llm-multi-agent: NOT_RUN/.test(t)); assert.ok(/no AI arm has run/.test(t)); assert.equal(l.filter((x) => /scorer check/.test(x.text) && /FAIL/.test(x.text)).length, 4);
});

test('observability and azure demos say plainly what does not exist', async () => {
  assert.ok(/NOT IMPLEMENTED/.test(text(await SCENARIOS.observability()))); const a = text(await SCENARIOS.azure()); assert.ok(/NOT-READY/.test(a)); assert.ok(/No Azure resource was created/.test(a));
});

test('live output carries the candidate-oracle banner and says it is live; no scenario claims production behaviour', async () => {
  const out = []; for (const n of Object.keys(SCENARIOS)) { const r = await runLive(n); printLive(r, (s) => out.push(s)); }
  const all = out.join('\n'); assert.ok(all.split('LIVE EXECUTION in this process, now').length - 1 === Object.keys(SCENARIOS).length); assert.ok(all.includes(BANNER));
  assert.ok(!/measured result|production result|in production/i.test(all));
});

test('recordings: a recording replays only with an unmissable RECORDED banner, and an altered recording is refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-rec-')); const r = await runLive('tamper'); const { file } = makeRecording(r, { dir });
  const out = []; assert.equal(printReplay(file, (s) => out.push(s)), true); const all = out.join('\n');
  assert.ok(/RECORDED RUN: THIS IS A RECORDING, NOT A LIVE EXECUTION/.test(all)); assert.ok(!/LIVE EXECUTION in this process/.test(all)); assert.ok(/verified/.test(all));
  const rec = JSON.parse(fs.readFileSync(file, 'utf8')); assert.equal(rec.notLive, true); assert.equal(rec.kind, 'RECORDED-RUN');
  rec.lines[1].text = rec.lines[1].text.replace('invalid', 'valid'); fs.writeFileSync(file, JSON.stringify(rec));
  assert.ok(loadRecording(file).problems.length > 0); const bad = []; assert.equal(printReplay(file, (s) => bad.push(s)), false); assert.match(bad[0], /REFUSING/);
  assert.equal(latestRecording('tamper', dir), file); assert.equal(latestRecording('nothing', dir), null);
});

test('committed backup recordings: every scenario has one, each verifies, none is labelled live', () => {
  for (const n of Object.keys(SCENARIOS)) {
    const f = latestRecording(n); assert.ok(f, `missing recording for ${n} in ${recordingsDir}`);
    const { rec, problems } = loadRecording(f); assert.deepEqual(problems, [], n); assert.equal(rec.notLive, true); assert.ok(rec.gitHead && /^[0-9a-f]{40}$/.test(rec.gitHead));
  }
});

test('independent verification still works on the demo certificate with only the public trust set', () => {
  const o = executiveFlow(); const trust = o.w.certTrust(); assert.equal(verifyCertificateBundle(o.certBundle, trust).ok, true);
  assert.equal(verifyCertificateBundle(o.certBundle, { ...trust, signerKeys: {} }).status, 'invalid');
});
