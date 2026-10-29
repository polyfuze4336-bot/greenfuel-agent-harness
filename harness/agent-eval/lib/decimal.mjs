// SYNTHETIC EVALUATION CODE, NOT AN APPLICATION AND NOT A CERTIFICATION METHOD. Fixed-point decimal arithmetic for the evaluation tool environment (BigInt, scale 12, half-even).
// It is deliberately a DIFFERENT implementation from lib/exact.mjs (rational arithmetic), which computes the dataset's expected values; the dataset test requires both to agree.
const S = 12n; const T = 10n ** S;
const DEC = /^-?\d{1,15}(\.\d{1,12})?$/;

export function toScaled(s) {
  if (typeof s !== 'string' || !DEC.test(s)) throw new Error('bad-decimal');
  const neg = s.startsWith('-'); const [i, f = ''] = s.replace('-', '').split('.');
  const v = BigInt(i) * T + BigInt(f.padEnd(Number(S), '0'));
  return neg ? -v : v;
}
export const add = (a, b) => a + b;
export const mul = (a, b) => (a * b) / T;
export const div = (a, b) => (a * T) / b;
export function roundHalfEven(v, digits) {
  const drop = 10n ** (S - BigInt(digits)); const neg = v < 0n; const a = neg ? -v : v;
  let q = a / drop; const r = a % drop; const half = drop / 2n;
  if (r > half || (r === half && q % 2n === 1n)) q += 1n;
  return (neg ? -q : q) * drop;
}
export function fmt(v, digits) {
  const neg = v < 0n; const a = neg ? -v : v; const s = a.toString().padStart(Number(S) + 1, '0');
  return `${neg ? '-' : ''}${s.slice(0, -Number(S))}${digits ? `.${s.slice(-Number(S)).slice(0, digits)}` : ''}`;
}
