// Design tokens for the deck: a restrained maritime palette, one type family, one grid. Apple-like restraint means few colours, large
// quiet type, generous space and no decoration that carries no meaning.

export const SLIDE = { w: 13.333, h: 7.5 } as const;

export const GRID = {
  /** Left and right page margin. */
  mx: 0.7,
  /** Width of the content column. */
  cw: 13.333 - 1.4,
  kickerY: 0.42,
  titleY: 0.68,
  titleH: 1.08,
  messageY: 1.8,
  messageH: 0.66,
  bodyY: 2.62,
  /** Bottom of the body zone. */
  bodyB: 6.42,
  bandY: 6.5,
  footY: 6.98,
} as const;

export const COLOR = {
  navy: '0A1F33',
  deep: '0F3556',
  ocean: '1B5E85',
  teal: '1F7A8C',
  seafoam: '9ED8D2',
  mist: 'E9EEF2',
  paper: 'FFFFFF',
  sand: 'F7F6F2',
  ink: '12202D',
  ink2: '445666',
  ink3: '5A6A79',
  line: 'D3DBE2',
  green: '256F4E',
  greenBg: 'E2F0E8',
  amber: '9A6208',
  amberBg: 'FBF0D9',
  red: 'A83A27',
  redBg: 'F7E1DB',
  grey: '5B6B7A',
  greyBg: 'EDEFF1',
} as const;

export const FONT = { sans: 'Segoe UI', semi: 'Segoe UI Semibold', light: 'Segoe UI Light' } as const;

/** Smallest sizes the quality checks allow. */
export const MIN_FONT = { body: 11, footer: 8.5 } as const;

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

export const TONE: Record<Tone, { fg: string; bg: string }> = {
  good: { fg: COLOR.green, bg: COLOR.greenBg },
  warn: { fg: COLOR.amber, bg: COLOR.amberBg },
  bad: { fg: COLOR.red, bg: COLOR.redBg },
  neutral: { fg: COLOR.grey, bg: COLOR.greyBg },
};

/** The colour of an evidence-class chip. A measurement, a scenario and a design must not look alike. */
export const CHIP: Record<string, { fg: string; bg: string }> = {
  MEASURED: TONE.good,
  'REAL RUN': TONE.good,
  CANDIDATE: { fg: COLOR.ocean, bg: 'E1ECF3' },
  'CASE STUDY': { fg: COLOR.ocean, bg: 'E1ECF3' },
  DESIGN: { fg: '176678', bg: 'DFF0F1' },
  SCENARIO: TONE.warn,
  'NOT PROVIDED': TONE.bad,
  'NOT BUILT': TONE.bad,
  'NOT RUN': TONE.bad,
  REVIEW: TONE.warn,
};

const WIDE = /[WMwm@%]/g;

/**
 * An estimate of the space text needs, for checks made before PowerPoint measures it. Segoe UI averages about half an em per character;
 * semibold and capitals run wider. PowerPoint's own measurement is the authority; this only lets a layout be checked without it.
 */
export function estimate(text: string, fontPt: number, widthIn: number, opts: { bold?: boolean; lineSpacing?: number } = {}): { lines: number; heightIn: number } {
  const em = opts.bold ? 0.47 : 0.46;
  const perLine = Math.max(1, Math.floor(widthIn / ((fontPt * em) / 72)));
  let lines = 0;
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = 0;
    let n = 1;
    for (const w of words) {
      const len = w.length + (w.match(WIDE)?.length ?? 0) * 0.4;
      if (cur === 0) cur = len;
      else if (cur + 1 + len <= perLine) cur += 1 + len;
      else (n++, (cur = len));
    }
    lines += n;
  }
  return { lines, heightIn: (lines * fontPt * (opts.lineSpacing ?? 1.22)) / 72 };
}
