// Fixture for the repair-loop tests. Not application code.
export function sumValues(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return Math.round(total * 10) / 10;
}
