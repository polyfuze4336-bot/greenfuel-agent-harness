'use strict';
// Enforcement attestation: a hook that actually ran leaves a short, recent heartbeat, and anything that must not run without
// enforcement (the MCP tool server today, a future Azure or GitHub tool tomorrow) checks it and refuses when it is missing or stale.
//
// What this does: turns "the hooks silently did not load" (untrusted folder, hooks setting off, wrong working folder) from an
// invisible failure into a visible refusal. What it does not do: stop a process that has the same file access as the model from writing
// a heartbeat itself. Against an adversarial session the answer is isolation (see docs/security/ISOLATION.md), not this file.
// The heartbeat holds names and versions only: no arguments, no paths, no tool output.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const FILE = 'enforcement-heartbeat.json';
const SCHEMA = 'greenfuel.enforcement-heartbeat/v1';
const DEFAULT_MAX_AGE_SECONDS = 120;

const logDir = () => process.env.HARNESS_LOG_DIR || path.join(ROOT, '.harness-logs');

// Which client launched the hook, from environment variable NAMES (values only for the two terminal-program variables).
function hostFingerprint(env = process.env) {
  const names = Object.keys(env).filter((k) => /^(VSCODE|COPILOT|GITHUB_COPILOT|TERM_PROGRAM|REMOTE_CONTAINERS|CODESPACES)/i.test(k)).sort();
  const program = env.TERM_PROGRAM ?? null;
  let host = 'unknown';
  if (names.some((n) => /^COPILOT|^GITHUB_COPILOT/i.test(n))) host = 'copilot-cli';
  if (program === 'vscode' || names.some((n) => /^VSCODE/i.test(n))) host = names.some((n) => /^COPILOT|^GITHUB_COPILOT/i.test(n)) ? 'vscode-or-cli' : 'vscode';
  return { host, termProgram: program, termProgramVersion: env.TERM_PROGRAM_VERSION ?? null, envMarkers: names, node: process.version, platform: process.platform, inContainer: names.includes('REMOTE_CONTAINERS') || fs.existsSync('/.dockerenv') };
}

function writeHeartbeat({ hook, agent = null, sessionId = null, phase = null, now = new Date() } = {}) {
  try {
    const dir = logDir();
    fs.mkdirSync(dir, { recursive: true });
    const rec = { schema: SCHEMA, ts: now.toISOString(), hook: String(hook ?? ''), agent, session: sessionId ? String(sessionId).slice(0, 64) : null, phase, fingerprint: hostFingerprint() };
    const tmp = path.join(dir, `${FILE}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, `${JSON.stringify(rec)}\n`);
    fs.renameSync(tmp, path.join(dir, FILE));
    return true;
  } catch { return false; } // a heartbeat failure must never change a hook decision
}

function readHeartbeat({ maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS, now = new Date() } = {}) {
  let hb;
  try { hb = JSON.parse(fs.readFileSync(path.join(logDir(), FILE), 'utf8')); } catch { return { ok: false, reason: 'no enforcement heartbeat: no hook has run in this workspace', hb: null }; }
  if (!hb || hb.schema !== SCHEMA || Number.isNaN(Date.parse(hb.ts))) return { ok: false, reason: 'the enforcement heartbeat is malformed', hb: null };
  const age = (now.getTime() - Date.parse(hb.ts)) / 1000;
  if (age < -5) return { ok: false, reason: 'the enforcement heartbeat is dated in the future', hb };
  if (age > maxAgeSeconds) return { ok: false, reason: `the last hook ran ${Math.round(age)} seconds ago: hooks are not active for this call`, hb };
  return { ok: true, reason: 'attested', hb };
}

// 'required' (default) refuses without a fresh heartbeat. 'off' is a human decision made in the launch environment and is reported in the result.
function attestationMode(env = process.env) { return String(env.HARNESS_ENFORCEMENT_ATTESTATION ?? 'required').toLowerCase() === 'off' ? 'off' : 'required'; }

module.exports = { writeHeartbeat, readHeartbeat, hostFingerprint, attestationMode, DEFAULT_MAX_AGE_SECONDS, SCHEMA };
