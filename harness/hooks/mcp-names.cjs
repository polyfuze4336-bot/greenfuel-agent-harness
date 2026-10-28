// Shared MCP tool-name matching for the guards and the output hook.
// The runtime names an MCP tool "<server>-<tool>" in Copilot CLI 1.0.105. Other surfaces may join with other separators,
// so a small, explicit set of spellings is accepted and nothing else. Names are compared exactly, in lower case:
// "greenfueltools-trace_requirement" is NOT the registered "greenfuel-tools" server, even though both normalise alike.
'use strict';

const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');

// Every accepted spelling of one registered server/tool pair.
function forms(server, tool) {
  const out = new Set();
  for (const s of new Set([server, server.replace(/-/g, '_')])) {
    for (const j of ['-', '_', '/', '.']) out.add(`${s}${j}${tool}`);
    out.add(`mcp_${s}_${tool}`);
    out.add(`mcp__${s}__${tool}`);
  }
  return [...out].map((x) => x.toLowerCase());
}

// Returns { server, exact, builtIn }.
//   server: the registered server this name looks like (by normalised prefix), or null
//   exact:  { server, tool } only when the name is exactly one accepted spelling of a registered MCP tool
// A name that looks like a server but is not an exact registered tool must never be treated as that tool.
function matchMcp(tool, registry) {
  const raw = String(tool).toLowerCase();
  const n = norm(tool);
  const own = Object.keys(registry.servers ?? {});
  const builtIn = registry.builtInServers ?? [];
  let server = null;
  for (const s of [...own, ...builtIn]) if ((n.startsWith(norm(s)) || n.startsWith(`mcp${norm(s)}`)) && (!server || norm(s).length > norm(server).length)) server = s;
  if (!server) return { server: null, exact: null, builtIn: false };
  let exact = null;
  for (const t of registry.tools ?? []) if (t.kind === 'mcp' && t.server === server && forms(server, t.name).includes(raw)) exact = { server, tool: t.name };
  return { server, exact, builtIn: builtIn.includes(server) };
}

module.exports = { norm, forms, matchMcp };
