// ARMS: single-agent LLM and multi-agent LLM orchestration. NOT RUN, and not implemented against any endpoint.
// Reason: no verified model deployment exists (D-028), no evaluation budget or non-sovereign-fixture decision exists (T55), and the phase is 0. An arm that cannot run must say so
// and must never return a plausible-looking result. When the owner approves a model, an adapter is implemented here, its model and prompt versions are written to registry.json,
// and the runner then refuses to record a run for it without them (see runner.mjs validateRun).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const registryPath = path.join(here, '..', 'registry.json');
export const readRegistry = () => JSON.parse(fs.readFileSync(registryPath, 'utf8'));

function blockers() {
  const reg = readRegistry(); const out = [];
  if (!reg.models.some((m) => m.status === 'VERIFIED')) out.push('no verified model deployment is registered (D-028, T55)');
  if (!reg.budget || reg.budget.approvedBy === null) out.push('no evaluation budget or approval is recorded (T55)');
  if (!reg.prompts.length) out.push('no prompt version is registered');
  out.push('no adapter implementation exists for any endpoint: it must be written and tested against an approved deployment');
  return out;
}
const mk = (id, orchestration) => ({
  id, kind: 'llm', model: null, promptSha256: null, orchestration, version: null,
  notRun: true, get notRunReasons() { return blockers(); },
  async run() { throw new Error(`${id} cannot run: ${blockers().join('; ')}`); },
});
export const single = mk('llm-single-agent', 'single-agent-with-tools');
export const multi = mk('llm-multi-agent', 'multi-agent-handoffs');
