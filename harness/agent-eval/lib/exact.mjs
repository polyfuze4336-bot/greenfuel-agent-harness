// SYNTHETIC EVALUATION CODE. Exact rational arithmetic used ONLY to compute the dataset's expected values, independently of lib/decimal.mjs (the tool environment's fixed-point code).
const parse = (s) => {
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`bad decimal ${s}`);
  const neg = s.startsWith('-'); const [i, f = ''] = s.replace('-', '').split('.');
  return { n: (neg ? -1n : 1n) * BigInt(i + f), d: 10n ** BigInt(f.length) };
};
const mulR = (a, b) => ({ n: a.n * b.n, d: a.d * b.d });
const addR = (a, b) => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
export function emissions(massKg, parts, digits = 2) {
  // output = (massKg / 1000) * sum(fraction * factor), rounded half-even to `digits` places
  let sum = { n: 0n, d: 1n };
  for (const p of parts) sum = addR(sum, mulR(parse(p.fraction), parse(p.factor)));
  const m = parse(massKg); const total = mulR(mulR(m, { n: 1n, d: 1000n }), sum);
  const scale = 10n ** BigInt(digits);
  const num = total.n * scale; let q = num / total.d; const r = num % total.d; const twice = 2n * (r < 0n ? -r : r);
  if (twice > total.d || (twice === total.d && (q < 0n ? -q : q) % 2n === 1n)) q += total.n < 0n ? -1n : 1n;
  const neg = q < 0n; const a = (neg ? -q : q).toString().padStart(digits + 1, '0');
  return `${neg ? '-' : ''}${a.slice(0, a.length - digits)}${digits ? `.${a.slice(a.length - digits)}` : ''}`;
}
export function sumKg(values) {
  let t = { n: 0n, d: 1n }; for (const v of values) t = addR(t, parse(v));
  return renderKg(t);
}
export function diffKg(a, b) { const x = parse(a); const y = parse(b); return renderKg(addR(x, { n: -y.n, d: y.d })); }
function renderKg(r) {
  // one decimal place, exact for the synthetic inputs (inputs have at most one decimal place)
  const scaled = r.n * 10n; if (scaled % r.d !== 0n) throw new Error('not representable in one decimal place');
  const q = scaled / r.d; const neg = q < 0n; const a = (neg ? -q : q).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${a.slice(0, -1)}.${a.slice(-1)}`;
}
