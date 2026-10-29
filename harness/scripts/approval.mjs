#!/usr/bin/env node
// Human-run approval tool. Agents cannot use it: it needs the approver's private key and passphrase, which never enter
// the repository, an agent prompt or a hook, and writing docs/approvals is a control-plane change an agent may not make.
//   node harness/scripts/approval.mjs enroll   --out <folder outside the repo> --holder "Full Name" --classes architecture,repository [--tiers P2]
//                                               creates your key pair and an ENROLLMENT REQUEST. It registers nothing.
//   node harness/scripts/approval.mjs register --request docs/approvals/enrollment/ENR-x.json
//                                               you confirm the fingerprint you compared out of band; adds the entry to the registry
//   node harness/scripts/approval.mjs revoke   --key <keyId> --reason "..."          marks a key revoked
//   node harness/scripts/approval.mjs list                                           read-only: who is enrolled, with which classes
//   node harness/scripts/approval.mjs decision --type adr|review|phase --id <id> --reason "..." --out docs/approvals/AP-x.json
//                                               an architecture decision request bound to the exact text it approves
//   node harness/scripts/approval.mjs keygen  --out <dir>                 (legacy) create an encrypted Ed25519 key pair; prints the PUBLIC entry. Use enroll instead
//   node harness/scripts/approval.mjs request --tier P3 --agent a --op o[,o] --env e [--rg g] [--branch b] [--commit sha]
//                                              --minutes n --uses n --reason "..." [--break-glass --reference "..."]  --out docs/approvals/AP-x.json
//   node harness/scripts/approval.mjs sign    --file docs/approvals/AP-x.json --key <private.pem>                      adds your signature (asks for the passphrase)
//   node harness/scripts/approval.mjs verify  --file docs/approvals/AP-x.json                                         checks it against the registry; read-only
// enroll, register, revoke and sign refuse to run without an interactive terminal, inside a container or in CI: they are for a person at
// their own computer. That is a speed bump for a scripted agent, not a boundary. The boundary is that registry changes must arrive in a
// GitHub-verified commit by an enrolled owner (ci-control-plane-guard.mjs), and that agents in the dev container hold no remote credentials.
// Nothing here is run automatically, and no key has been created for anyone.
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const engine = require('../hooks/permission-engine.cjs');
const registry = require('../approvals/registry.cjs');
const gates = require('../approvals/approval-gates.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i > 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);

// A person at an interactive terminal on their own computer. Not a container, not CI, not a piped or scripted stdin.
export function humanOnly(env = process.env, tty = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY }) {
  if (!tty.stdin || !tty.stdout) throw new Error('refused: this command needs an interactive terminal. Run it yourself, on your own computer');
  if (env.CI || env.GITHUB_ACTIONS) throw new Error('refused: this command does not run in CI');
  if (env.REMOTE_CONTAINERS || env.CODESPACES || env.HARNESS_AGENT_SESSION || existsSync('/.dockerenv')) throw new Error('refused: this command does not run inside a dev container or an agent session. Run it on your own computer');
}

function ask(prompt, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(prompt)) process.stdout.write(s); };
    rl.question(prompt, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}
const askHidden = (prompt) => ask(prompt, true);

// Pure parts, used by the commands and by the tests. No file, terminal or clock access except what is passed in.
export function buildEnrollment({ holder, classes, tiers = [], passphrase, now = new Date() }) {
  const k = engine.generateApproverKey(passphrase);
  const e = { keyId: k.keyId, fingerprint: registry.fingerprint(k.publicKeyPem), holder: String(holder ?? '').trim(), classes: [...classes], tiers: [...tiers], requestedAt: now.toISOString() };
  const privateKey = crypto.createPrivateKey({ key: k.privateKeyPem, format: 'pem', passphrase });
  const request = { schema: registry.ENROLLMENT_SCHEMA, requestId: `ENR-${crypto.randomBytes(6).toString('hex')}`, ...e, publicKeyPem: k.publicKeyPem, proof: registry.signEnrollment(e, privateKey) };
  const entry = requestToEntry(request, now);
  const problems = registry.entryProblems(entry);
  if (problems.length) throw new Error(`the request would not be a valid registry entry: ${problems.join('; ')}`);
  return { request, privateKeyPem: k.privateKeyPem, keyId: k.keyId };
}

export function requestToEntry(request, now = new Date()) {
  return {
    keyId: request.keyId, role: [...request.classes].sort().join('+'), holder: request.holder, classes: request.classes, tiers: request.tiers, added: now.toISOString().slice(0, 10), publicKeyPem: request.publicKeyPem,
    enrollment: { requestId: request.requestId, requestedAt: request.requestedAt, confirmedAt: now.toISOString(), fingerprint: request.fingerprint, proof: request.proof },
  };
}

// Adds a confirmed entry. The fingerprint typed by the human must equal the fingerprint recomputed from the public key in the request.
export function registerEntry({ request, approvers, typedFingerprint, now = new Date() }) {
  if (!request || request.schema !== registry.ENROLLMENT_SCHEMA) throw new Error('not an enrollment request');
  const recomputed = registry.fingerprint(request.publicKeyPem ?? '');
  if (String(typedFingerprint ?? '').replace(/\s+/g, '').toLowerCase() !== recomputed) throw new Error('the fingerprint you typed is not the fingerprint of this request. Nothing was registered');
  if (request.fingerprint !== recomputed || request.keyId !== registry.keyIdOf(request.publicKeyPem)) throw new Error('the request is internally inconsistent');
  const entry = requestToEntry(request, now);
  const next = [...approvers, entry];
  const all = registry.registryProblems(next);
  if (all.errors.length) throw new Error(`the registry would be invalid: ${all.errors.join('; ')}`);
  return { entry, approvers: next, warnings: all.warnings };
}

export function revokeEntry({ approvers, keyId, reason, now = new Date() }) {
  const i = approvers.findIndex((k) => k.keyId === keyId);
  if (i < 0) throw new Error(`no approver with key ${keyId}`);
  if (!reason || !String(reason).trim()) throw new Error('a reason is required');
  const next = approvers.map((k, j) => (j === i ? { ...k, revoked: true, revokedAt: now.toISOString(), revokedReason: String(reason).slice(0, 200) } : k));
  return next;
}

const registryFile = () => path.join(root, 'harness/policy/approvers.json');
const readRegistry = () => JSON.parse(readFileSync(registryFile(), 'utf8'));
const writeRegistry = (doc, approvers) => writeFileSync(registryFile(), `${JSON.stringify({ ...doc, approvers }, null, 2)}\n`);
const adminEvent = (fields) => { try { engine.writeEvent(engine.loadModel(root), 'approval-admin', fields); } catch { /* the record must never block the command */ } };

export async function buildRequest(o, now = new Date()) {
  const lim = engine.loadModel(root).perm.approvals.limits[o.tier];
  if (!lim) throw new Error('--tier must be P2, P3 or P4');
  const minutes = Number(o.minutes ?? lim.maxLifetimeMinutes);
  return {
    schema: 'greenfuel.approval/v1', id: `AP-${crypto.randomBytes(6).toString('hex')}`, tier: o.tier,
    operations: String(o.op ?? '').split(',').filter(Boolean), agents: String(o.agent ?? '').split(',').filter(Boolean), environment: o.env,
    scope: { ...(o.rg ? { resourceGroups: String(o.rg).split(',') } : {}), ...(o.branch ? { branches: String(o.branch).split(',') } : {}), ...(o.commit ? { headCommit: o.commit } : {}) },
    reason: o.reason ?? '', ...(o.breakGlass ? { breakGlass: true, reference: o.reference ?? '' } : { breakGlass: false }),
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + minutes * 60000).toISOString(), maxUses: Number(o.uses ?? 1), nonce: crypto.randomBytes(16).toString('hex'), signatures: [],
  };
}

async function main() {
  if (['enroll', 'register', 'revoke', 'sign', 'keygen'].includes(cmd)) humanOnly();
  if (cmd === 'enroll') {
    const out = path.resolve(opt('out', ''));
    if (!opt('out')) throw new Error('--out <folder outside the repository> is required');
    if (!path.relative(root, out).startsWith('..')) throw new Error('keep the private key outside the repository');
    const holder = opt('holder', ''); const classes = String(opt('classes', '')).split(',').filter(Boolean); const tiers = String(opt('tiers', '')).split(',').filter(Boolean);
    if (!holder || !classes.length) throw new Error('--holder "Full Name" and --classes (architecture, repository, deployment, filing) are required');
    const pass = await askHidden('New passphrase for the private key (at least 12 characters): ');
    if (pass.length < 12 || pass !== await askHidden('Repeat passphrase: ')) throw new Error('passphrases must match and be at least 12 characters');
    const { request, privateKeyPem, keyId } = buildEnrollment({ holder, classes, tiers, passphrase: pass });
    mkdirSync(out, { recursive: true });
    const keyFile = path.join(out, `approver-${keyId}.pem`);
    writeFileSync(keyFile, privateKeyPem, { mode: 0o600 });
    try { chmodSync(keyFile, 0o600); } catch { /* not supported on every platform */ }
    const dir = path.join(root, 'docs/approvals/enrollment'); mkdirSync(dir, { recursive: true });
    const reqFile = path.join(dir, `${request.requestId}.json`);
    writeFileSync(reqFile, `${JSON.stringify(request, null, 2)}\n`, { flag: 'wx' });
    adminEvent({ command: 'enroll', requestId: request.requestId, keyId, classes: classes.join(',') });
    console.log(`Private key (encrypted): ${keyFile}\nKeep it off shared and synced folders. Back it up somewhere only you control.`);
    console.log(`Enrollment request: ${path.relative(root, reqFile)}  (this REGISTERS NOTHING)`);
    console.log(`\nFINGERPRINT: ${registry.fingerprintGroups(request.publicKeyPem)}\nWrite this down now. You will be asked to type it back in the next step, and you should read it from this screen, not from a file.`);
    console.log('Next: node harness/scripts/approval.mjs register --request <that file>');
  } else if (cmd === 'register') {
    const reqFile = path.resolve(opt('request', ''));
    const request = JSON.parse(readFileSync(reqFile, 'utf8'));
    const doc = readRegistry();
    const preview = requestToEntry(request);
    const problems = registry.entryProblems(preview);
    if (problems.length) throw new Error(`the request is not valid: ${problems.join('; ')}`);
    console.log(JSON.stringify({ holder: request.holder, classes: request.classes, tiers: request.tiers, requestedAt: request.requestedAt }, null, 2));
    console.log(`Fingerprint: ${registry.fingerprintGroups(request.publicKeyPem)}`);
    console.log('Compare it with the one printed by the enroll step, on the computer where the key was created. If it differs by one character, stop.');
    const typed = await ask('Type the 64-character fingerprint (spaces optional): ');
    const phrase = await ask('Type exactly: I AM THE REPOSITORY OWNER AND I CONFIRM THIS HUMAN\n> ');
    if (phrase.trim() !== 'I AM THE REPOSITORY OWNER AND I CONFIRM THIS HUMAN') throw new Error('confirmation phrase not typed exactly. Nothing was registered');
    const r = registerEntry({ request, approvers: doc.approvers ?? [], typedFingerprint: typed });
    writeRegistry(doc, r.approvers);
    adminEvent({ command: 'register', requestId: request.requestId, keyId: request.keyId, classes: request.classes.join(',') });
    for (const w of r.warnings) console.log(`WARNING: ${w}`);
    console.log(`Registered ${request.holder} (${request.classes.join(', ')}), key ${request.keyId}.\nThis changed harness/policy/approvers.json only on this computer. Commit it with a SIGNED commit (git commit -S) and push it yourself;\nthe control-plane guard will refuse a registry change that is not a GitHub-verified commit by an enrolled owner.`);
  } else if (cmd === 'revoke') {
    const doc = readRegistry();
    const next = revokeEntry({ approvers: doc.approvers ?? [], keyId: opt('key', ''), reason: opt('reason', '') });
    writeRegistry(doc, next);
    adminEvent({ command: 'revoke', keyId: opt('key', '') });
    console.log(`Revoked key ${opt('key')}. Commit the change with a signed commit.`);
  } else if (cmd === 'list') {
    const doc = readRegistry();
    if (!(doc.approvers ?? []).length) console.log('No approver is enrolled. No signed approval of any class can exist.');
    for (const k of doc.approvers ?? []) console.log(`${k.revoked ? 'REVOKED ' : 'ACTIVE  '}${k.keyId}  ${k.holder}  classes=${(k.classes ?? []).join('+')}  tiers=${(k.tiers ?? []).join(',') || '-'}  fingerprint=${registry.fingerprint(k.publicKeyPem ?? '').slice(0, 16)}...  ${registry.entryProblems(k).length ? 'INVALID' : 'well-formed'}`);
    const r = registry.registryProblems(doc.approvers ?? []);
    for (const w of r.warnings) console.log(`WARNING: ${w}`);
    for (const e of r.errors) console.log(`PROBLEM: ${e}`);
  } else if (cmd === 'decision') {
    const rec = gates.buildDecisionRequest({ type: opt('type'), id: opt('id'), reason: opt('reason'), root });
    const out = opt('out');
    if (!out) { console.log(JSON.stringify(rec, null, 2)); return; }
    writeFileSync(path.resolve(out), `${JSON.stringify(rec, null, 2)}\n`, { flag: 'wx' });
    console.log(`Decision request ${rec.id} for ${rec.subject.type} ${rec.subject.id} written to ${out}. It is bound to the exact text now in the repository. Read the document, then sign it.`);
  } else if (cmd === 'keygen') {
    const out = path.resolve(opt('out', ''));
    if (!opt('out')) throw new Error('--out <folder outside the repository> is required');
    if (!path.relative(root, out).startsWith('..')) throw new Error('keep the private key outside the repository');
    const pass = await askHidden('New passphrase for the private key: ');
    if (pass.length < 12 || pass !== await askHidden('Repeat passphrase: ')) throw new Error('passphrases must match and be at least 12 characters');
    const k = engine.generateApproverKey(pass);
    mkdirSync(out, { recursive: true });
    const file = path.join(out, `approver-${k.keyId}.pem`);
    writeFileSync(file, k.privateKeyPem, { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* not supported on every platform */ }
    console.log(`Private key written to ${file} (encrypted). Keep it off shared and synced folders.`);
    console.log('LEGACY: an entry made from this output carries no enrollment evidence, so the engine will not trust it. Use "enroll" and "register" instead. Public entry:');
    console.log(JSON.stringify({ keyId: k.keyId, role: '<role>', tiers: ['P2'], added: new Date().toISOString().slice(0, 10), publicKeyPem: k.publicKeyPem }, null, 2));
  } else if (cmd === 'request') {
    const rec = await buildRequest({ tier: opt('tier'), agent: opt('agent'), op: opt('op'), env: opt('env'), rg: opt('rg'), branch: opt('branch'), commit: opt('commit'), minutes: opt('minutes'), uses: opt('uses'), reason: opt('reason'), breakGlass: flag('break-glass'), reference: opt('reference') });
    const out = opt('out');
    if (!out) { console.log(JSON.stringify(rec, null, 2)); return; }
    writeFileSync(path.resolve(out), `${JSON.stringify(rec, null, 2)}\n`, { flag: 'wx' });
    console.log(`Request ${rec.id} written to ${out}. Read it, then sign it.`);
  } else if (cmd === 'sign') {
    const file = path.resolve(opt('file', ''));
    const rec = JSON.parse(readFileSync(file, 'utf8'));
    if (rec.schema === gates.DECISION_SCHEMA) console.log(JSON.stringify({ id: rec.id, decision: rec.decision, subject: rec.subject, requiredClasses: rec.requiredClasses, reason: rec.reason }, null, 2));
    else console.log(JSON.stringify({ id: rec.id, tier: rec.tier, agents: rec.agents, operations: rec.operations, environment: rec.environment, scope: rec.scope, expiresAt: rec.expiresAt, breakGlass: rec.breakGlass }, null, 2));
    const keyPem = readFileSync(path.resolve(opt('key', '')), 'utf8');
    const pass = await askHidden('Passphrase (signing means you have reviewed the request above): ');
    const keyId = engine.sha256(crypto.createPublicKey({ key: keyPem, format: 'pem', passphrase: pass }).export({ type: 'spki', format: 'pem' })).slice(0, 16);
    writeFileSync(file, `${JSON.stringify(engine.signApproval(rec, keyPem, keyId, pass), null, 2)}\n`);
    adminEvent({ command: 'sign', approval: rec.id, keyId });
    console.log(`Signed as key ${keyId}. P4 and phase decisions need a second distinct key to sign with their own key.`);
  } else if (cmd === 'verify') {
    const rec = JSON.parse(readFileSync(path.resolve(opt('file', '')), 'utf8'));
    const model = engine.loadModel(root);
    const v = rec.schema === gates.DECISION_SCHEMA ? gates.verifyDecisionApproval(rec, { root, approvers: model.approvers }) : engine.verifyApproval(rec, { model });
    adminEvent({ command: 'verify', approval: rec.id, ok: Boolean(v.ok) });
    console.log(v.ok ? `VALID: ${rec.id} signed by ${v.signers.join(', ')}` : `INVALID: ${v.reasons.join('; ')}`);
    process.exit(v.ok ? 0 : 1);
  } else {
    console.error('usage: approval.mjs enroll|register|revoke|list|decision|request|sign|verify (see the header of this file)');
    process.exit(4);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`approval: ${e.message}`); process.exit(2); });