#!/usr/bin/env node
// Validates the isolated execution environment.
//   node harness/scripts/validate-isolation.mjs             static checks of .devcontainer/* (no Docker needed)
//   node harness/scripts/validate-isolation.mjs --runtime   self-check from INSIDE the container (read-only probes); exits 3 when not isolated
// Static validation proves the configuration says the right things. It does NOT prove a container built from it behaves that way:
// that needs a Docker daemon, which this machine did not have when the configuration was written (see docs/security/ISOLATION.md).
import { existsSync, readFileSync, accessSync, constants, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function parseJsonc(text) {
  let out = ''; let inStr = false; let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; const n = text[i + 1];
    if (inStr) { out += c; if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// Everything the isolated environment must never mount, forward or reach.
const FORBIDDEN_MOUNT = /(docker\.sock|\.azure|\.ssh|\.gnupg|\.config\/gh|\.kube|\.docker|\.aws|\.npmrc|\.git-credentials|appdata|\/var\/run|\/run\/docker|\\\\\.\\pipe)/i;
const FORBIDDEN_RUN_ARGS = [/--privileged/, /--network[= ]host/, /--net[= ]host/, /--pid[= ]host/, /--ipc[= ]host/, /--cap-add[= ](?!NET_ADMIN\b|NET_RAW\b)/, /--device/, /--security-opt[= ](?:seccomp|apparmor)[:=]unconfined/, /-v[= ]/, /--mount/, /--userns[= ]host/];
const REQUIRED_READONLY = ['harness', 'tests', 'evaluation', '.github', '.vscode', '.devcontainer', '.git/hooks', '.git/config', 'package.json', '.mcp.json', '.gitignore', '.gitattributes', 'docs/evidence', 'docs/approvals', 'docs/adr', 'memory'];
const BLANKED_ENV = ['GH_TOKEN', 'GITHUB_TOKEN', 'AZURE_CLIENT_SECRET', 'ARM_CLIENT_SECRET', 'SSH_AUTH_SOCK'];
const NEVER_ALLOWED_HOSTS = [/(^|\.)github\.com$/, /githubusercontent\.com$/, /(^|\.)azure\.com$/, /microsoftonline\.com$/, /(^|\.)azure\.net$/, /npmjs\.(org|com)$/, /^\*|\*/, /^\d+\.\d+\.\d+\.\d+$/];
const COPILOT_HOST = /(^|\.)(githubcopilot\.com|githubusercontent\.com|exp-tas\.com)$/;

export function validateIsolation(rootDir = root) {
  const errors = []; const notes = []; const fail = (m) => errors.push(m);
  const dc = path.join(rootDir, '.devcontainer');
  const need = ['devcontainer.json', 'Dockerfile', 'init-firewall.sh', 'allowed-hosts.txt', 'pre-push-deny'];
  for (const f of need) if (!existsSync(path.join(dc, f))) fail(`.devcontainer/${f} is missing`);
  if (errors.length) return { errors, notes };
  let c; try { c = parseJsonc(readFileSync(path.join(dc, 'devcontainer.json'), 'utf8')); } catch (e) { return { errors: [`devcontainer.json is not valid JSONC (${e.message})`], notes }; }
  const raw = readFileSync(path.join(dc, 'devcontainer.json'), 'utf8').replace(/\/\/.*$/gm, '');

  // user and privileges
  if (!c.remoteUser || /^(root|0)$/.test(c.remoteUser)) fail('remoteUser must be a non-root user');
  if (c.privileged === true) fail('the container must not be privileged');
  if (c.features && Object.keys(c.features).some((k) => /docker/i.test(k))) fail(`a Docker feature (${Object.keys(c.features).find((k) => /docker/i.test(k))}) would give the container control of a Docker daemon`);
  if (/\$\{localEnv:/i.test(raw)) fail('${localEnv:...} forwards a host environment variable into the container');
  const args = c.runArgs ?? [];
  if (!args.includes('--cap-drop=ALL')) fail('runArgs must include --cap-drop=ALL');
  if (!args.includes('--security-opt=no-new-privileges')) fail('runArgs must include --security-opt=no-new-privileges');
  for (const a of args) for (const re of FORBIDDEN_RUN_ARGS) if (re.test(a)) fail(`runArgs: ${a} is not permitted (${re})`);
  for (const a of args) if (/^--cap-add=/.test(a) && !/^--cap-add=(NET_ADMIN|NET_RAW)$/.test(a)) fail(`runArgs: ${a} is not permitted; only NET_ADMIN and NET_RAW, for the firewall`);
  if (!args.some((a) => /^--memory=/.test(a)) || !args.some((a) => /^--pids-limit=/.test(a))) fail('runArgs must bound memory and processes (--memory, --pids-limit)');

  // mounts
  const mounts = [...(c.mounts ?? []), c.workspaceMount].filter(Boolean).map((m) => (typeof m === 'string' ? m : Object.entries(m).map(([k, v]) => `${k}=${v}`).join(',')));
  for (const m of mounts) if (FORBIDDEN_MOUNT.test(m)) fail(`mount '${m}' exposes a host credential store, the Docker socket or a host system path`);
  const ro = new Set();
  for (const m of mounts) {
    const t = /target=([^,]+)/.exec(m)?.[1]; if (!t) continue;
    if (/(^|,)readonly(,|$)|(^|,)ro(,|$)|readonly=true/.test(m)) ro.add(t.replace('/workspaces/greenfuel-agent-harness/', ''));
  }
  for (const p of REQUIRED_READONLY) if (!ro.has(p)) fail(`control-plane path '${p}' must be mounted read-only`);
  for (const m of mounts) { const t = /target=([^,]+)/.exec(m)?.[1] ?? ''; if (/source=\$\{localWorkspaceFolder\}(,|$)/.test(m) && !/\/workspaces\/greenfuel-agent-harness$/.test(t)) fail(`the workspace mount targets an unexpected path: ${t}`); }

  // environment
  for (const k of BLANKED_ENV) {
    const inContainer = c.containerEnv?.[k]; const inRemote = c.remoteEnv?.[k];
    if (inContainer !== undefined && inContainer !== '') fail(`${k} must be blank in containerEnv`);
    if (inRemote !== undefined && inRemote !== '') fail(`${k} must be blank in remoteEnv`);
    if (inContainer === undefined && inRemote === undefined) fail(`${k} must be explicitly blanked in containerEnv/remoteEnv`);
  }
  for (const [k, v] of Object.entries({ ...(c.containerEnv ?? {}), ...(c.remoteEnv ?? {}) })) if (/secret|token|password|key/i.test(k) && v !== '') fail(`${k} must not carry a value`);
  if (c.containerEnv?.HARNESS_AGENT_SESSION !== '1') fail('containerEnv.HARNESS_AGENT_SESSION must be "1" so approval commands refuse to run here');
  if (c.containerEnv?.HARNESS_ISOLATED !== '1') fail('containerEnv.HARNESS_ISOLATED must be "1"');
  if (c.overrideCommand !== false) fail('overrideCommand must be false so the firewall entrypoint runs');
  if ((c.forwardPorts ?? []).length) fail('forwardPorts must be empty');
  const s = c.customizations?.vscode?.settings ?? {};
  if (s['chat.tools.global.autoApprove'] !== false) fail('settings must keep chat.tools.global.autoApprove false');
  if (s['chat.useHooks'] !== true) fail('settings must keep chat.useHooks true');
  if (s['task.allowAutomaticTasks'] !== 'off') fail('settings must keep automatic tasks off');
  if (/postCreateCommand|onCreateCommand|updateContentCommand/.test(raw)) fail('create-time lifecycle commands are not permitted (nothing runs on create)');
  if (c.postStartCommand && !/^node harness\/scripts\/validate-isolation\.mjs --runtime$/.test(c.postStartCommand)) fail('postStartCommand may only run the read-only isolation self-check');

  // image
  const df = readFileSync(path.join(dc, 'Dockerfile'), 'utf8');
  const from = /^FROM\s+(\S+)/m.exec(df)?.[1] ?? '';
  if (!from) fail('Dockerfile has no FROM');
  else if (!/@sha256:[0-9a-f]{64}$/.test(from)) notes.push(`base image ${from} is pinned by tag, not digest: pin it by digest after the first reviewed pull`);
  if (!/purge -y sudo|rm -f \/etc\/sudoers\.d/.test(df)) fail('Dockerfile must remove passwordless sudo from the base image');
  if (/docker\.sock|--privileged|chmod\s+[0-7]*[2367][0-7]{0,2}\s+\/etc\/sudoers/.test(df)) fail('Dockerfile contains a forbidden privilege setting');
  if (/^\s*(ENV|ARG)\s+\S*(TOKEN|SECRET|PASSWORD|KEY)\S*=\S+/im.test(df)) fail('Dockerfile bakes a credential-looking value into the image');
  if (!/ENTRYPOINT.*init-firewall\.sh/.test(df)) fail('Dockerfile ENTRYPOINT must run init-firewall.sh');
  if (!/core\.hooksPath \/opt\/harness-hooks/.test(df)) fail('Dockerfile must install the pre-push denial hook');

  // firewall and allowlist
  const fw = readFileSync(path.join(dc, 'init-firewall.sh'), 'utf8');
  for (const [re, why] of [[/set -euo pipefail/, 'must fail on any error'], [/iptables -P OUTPUT DROP/, 'must default-deny outbound'], [/iptables -P INPUT DROP/, 'must default-deny inbound'], [/ipset create harness-allow/, 'must use an allowlist set'], [/--match-set harness-allow dst -j ACCEPT/, 'must allow only the allowlist'], [/ip6tables -P OUTPUT DROP/, 'must close IPv6'], [/self-check failed/, 'must verify a non-listed host is unreachable'], [/refusing to start with an empty allowlist/, 'must refuse to start with an empty allowlist']]) if (!re.test(fw)) fail(`init-firewall.sh ${why}`);
  if (/iptables\s+-A\s+OUTPUT\s+-j\s+ACCEPT\b|iptables\s+-P\s+OUTPUT\s+ACCEPT/.test(fw)) fail('init-firewall.sh opens all outbound traffic');
  const hosts = readFileSync(path.join(dc, 'allowed-hosts.txt'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!hosts.length) fail('allowed-hosts.txt lists no host');
  for (const h of hosts) {
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(h)) fail(`allowed host '${h}' is not a plain host name`);
    else if (NEVER_ALLOWED_HOSTS.some((re) => re.test(h)) && !COPILOT_HOST.test(h)) fail(`allowed host '${h}' is on the never-allow list (Git, GitHub API, Azure control plane, package registries, wildcards, raw IPs)`);
  }
  if (hosts.some((h) => /(^|\.)github\.com$/.test(h))) fail('github.com and api.github.com must not be reachable: Git operations and the REST API are how a leaked credential would be used');
  const hook = readFileSync(path.join(dc, 'pre-push-deny'), 'utf8');
  if (!/exit 1/.test(hook)) fail('pre-push-deny must exit non-zero');
  return { errors, notes };
}

// Inside the container only. Read-only probes; prints each result and never claims more than it observed.
export function runtimeSelfCheck(env = process.env) {
  const results = [];
  const add = (name, ok, detail) => results.push({ name, ok, detail });
  add('HARNESS_ISOLATED is set', env.HARNESS_ISOLATED === '1', env.HARNESS_ISOLATED ?? 'unset');
  add('running inside a container', existsSync('/.dockerenv') || Boolean(env.REMOTE_CONTAINERS), existsSync('/.dockerenv') ? '/.dockerenv present' : 'no /.dockerenv');
  add('Docker socket is absent', !existsSync('/var/run/docker.sock') && !existsSync('/run/docker.sock'), 'checked /var/run/docker.sock and /run/docker.sock');
  const home = os.homedir();
  for (const d of ['.azure', '.ssh', '.config/gh', '.gnupg', '.kube', '.aws']) add(`no ${d} in the home directory`, !existsSync(path.join(home, d)) || readdirSync(path.join(home, d)).length === 0, path.join('~', d));
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'AZURE_CLIENT_SECRET', 'ARM_CLIENT_SECRET', 'SSH_AUTH_SOCK']) add(`${k} is empty`, !env[k], env[k] ? 'SET' : 'empty or unset');
  add('not running as root', typeof process.getuid === 'function' && process.getuid() !== 0, typeof process.getuid === 'function' ? `uid ${process.getuid()}` : 'uid unavailable');
  for (const p of ['harness', 'tests', '.github', 'package.json']) {
    let writable = true; try { accessSync(path.join(root, p), constants.W_OK); } catch { writable = false; }
    add(`${p} is read-only`, !writable, writable ? 'WRITABLE' : 'not writable');
  }
  void statSync;
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--runtime')) {
    const r = runtimeSelfCheck();
    for (const x of r) console.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.name} (${x.detail})`);
    const bad = r.filter((x) => !x.ok);
    const inContainer = r.find((x) => x.name === 'running inside a container')?.ok;
    console.log(inContainer ? (bad.length ? `isolation self-check: ${bad.length} check(s) FAILED. Do not run agents here.` : 'isolation self-check: all probes passed (these are probes of this process, not a proof of isolation)') : 'isolation self-check: NOT RUNNING IN THE ISOLATED ENVIRONMENT. Nothing here is isolated.');
    process.exit(bad.length ? 3 : 0);
  }
  const { errors, notes } = validateIsolation();
  for (const e of errors) console.error(`FAIL ${e}`);
  for (const n of notes) console.log(`note: ${n}`);
  console.log(errors.length ? `${errors.length} isolation problem(s).` : 'validate-isolation: OK (static: the container was not built or run).');
  process.exit(errors.length ? 1 : 0);
}
