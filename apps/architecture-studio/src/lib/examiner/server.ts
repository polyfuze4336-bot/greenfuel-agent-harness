import { BANK_PATH, parseBank } from './bank.ts';
import { buildDossier } from './dossier.ts';
import { EXAMINER_DIR, validateAiChallenge } from './ai-record.ts';
import type { AiChallenge, ExaminerDossier } from './types.ts';
import { getModel, openAdapter } from '../repo/index.ts';

/** The Examiner's dossier for one decision, with the AI challenge committed for it, if any, checked against the files it cites. Read-only. */
export async function examinerFor(id: string): Promise<ExaminerDossier | null> {
  const m = await getModel();
  const git = openAdapter();
  const files = { read: (p: string) => git.read(p) ?? null, has: (p: string) => git.has(p) };
  const path = `${EXAMINER_DIR}${id}.json`;
  let ai: AiChallenge | null = null;
  let aiProblem: string | null = null;
  if (git.has(path)) {
    try {
      const v = validateAiChallenge(JSON.parse(git.read(path) ?? ''), path, id, files);
      if ('error' in v) aiProblem = `${path} ${v.error}`;
      else ai = v;
    } catch {
      aiProblem = `${path} is not valid JSON`;
    }
  }
  const bank = git.has(BANK_PATH) ? parseBank(git.read(BANK_PATH) ?? '') : [];
  return buildDossier({ commit: m.repo.commit, records: m.register.records, requirements: m.requirements, risks: m.risks, reviews: m.reviews, assumptions: m.assumptions, suggestions: m.register.suggestions, bank, bankPath: BANK_PATH, ai, aiProblem }, id);
}
