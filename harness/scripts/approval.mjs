#!/usr/bin/env node
// Human-run approval tool. Agents cannot use it: it needs the approver's private key and passphrase, which never enter
// the repository, an agent prompt or a hook, and writing docs/approvals is a control-plane change an agent may not make.
//   node harness/scripts/approval.mjs keygen  --out <dir>                 create an encrypted Ed25519 key pair; prints the PUBLIC entry for approvers.json
//   node harness/scripts/approval.mjs request --tier P3 --agent a --op o[,o] --env e [--rg g] [--branch b] [--commit sha]
//                                              --minutes n --uses n --reason "..." [--break-glass --reference "..."]  --out docs/approvals/AP-x.json
//   node harness/scripts/approval.mjs sign    --file docs/approvals/AP-x.json --key <private.pem>                      adds your signature (asks for the passphrase)
//   node harness/scripts/approval.mjs verify  --file docs/approvals/AP-x.json                                         checks it against the registry; read-only
// Nothing here is run automatically, and no key has been created for anyone.
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const engine = require('../hooks/permission-engine.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i > 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(prompt)) process.stdout.write(s); };
    rl.question(prompt, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

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
  if (cmd === 'keygen') {
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
    console.log('Add this entry to harness/policy/approvers.json as a reviewed change (choose the tiers you are authorised for):');
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
    console.log(JSON.stringify({ id: rec.id, tier: rec.tier, agents: rec.agents, operations: rec.operations, environment: rec.environment, scope: rec.scope, expiresAt: rec.expiresAt, breakGlass: rec.breakGlass }, null, 2));
    const keyPem = readFileSync(path.resolve(opt('key', '')), 'utf8');
    const pass = await askHidden('Passphrase (signing means you have reviewed the request above): ');
    const keyId = engine.sha256(crypto.createPublicKey({ key: keyPem, format: 'pem', passphrase: pass }).export({ type: 'spki', format: 'pem' })).slice(0, 16);
    writeFileSync(file, `${JSON.stringify(engine.signApproval(rec, keyPem, keyId, pass), null, 2)}\n`);
    console.log(`Signed as key ${keyId}. P4 needs a second distinct approver to run this command with their own key.`);
  } else if (cmd === 'verify') {
    const rec = JSON.parse(readFileSync(path.resolve(opt('file', '')), 'utf8'));
    const v = engine.verifyApproval(rec, { model: engine.loadModel(root) });
    console.log(v.ok ? `VALID: ${rec.id} signed by ${v.signers.join(', ')}` : `INVALID: ${v.reasons.join('; ')}`);
    process.exit(v.ok ? 0 : 1);
  } else {
    console.error('usage: approval.mjs keygen|request|sign|verify (see the header of this file)');
    process.exit(4);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`approval: ${e.message}`); process.exit(2); });