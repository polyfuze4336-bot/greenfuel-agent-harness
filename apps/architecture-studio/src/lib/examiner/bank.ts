import { tableRows } from '../repo/parse.ts';

// The design-defence question bank (docs/architecture/DEFENSE-QUESTION-BANK.md) is written by the programme. The Examiner takes panel
// questions from it, by explicit mention of a decision id, rather than writing its own.

export interface BankQuestion {
  id: string;
  perspective: string;
  tags: string[];
  critical: boolean;
  question: string;
  answer: string;
  redFlags: string;
  line: number;
}

export const BANK_PATH = 'docs/architecture/DEFENSE-QUESTION-BANK.md';

export function parseBank(text: string): BankQuestion[] {
  return tableRows(text)
    .filter((r) => /^DQ-\d\d-\d\d$/.test(r.cells[0] ?? ''))
    .map((r) => ({ id: r.cells[0]!, perspective: r.cells[1] ?? '', tags: (r.cells[2] ?? '').split(/[,\s]+/).filter(Boolean), critical: /^yes/i.test(r.cells[3] ?? ''), question: r.cells[4] ?? '', answer: r.cells[5] ?? '', redFlags: r.cells[6] ?? '', line: r.line }));
}
