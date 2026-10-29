// Prints a small, fixed TAP report with two failing tests (one carrying a secret-looking value) and exits 1. Used only by the evidence tests.
console.log([
  'TAP version 13',
  '# Subtest: api contract: response carries the certificate id',
  'not ok 1 - api contract: response carries the certificate id',
  '  ---',
  "  expected: 'CERT-1'",
  "  actual: 'CERT-2'",
  '  note: token=abcdef0123456789zz',
  '  ...',
  'ok 2 - unrelated check',
  'not ok 3 - second failing check',
  '  ---',
  '  error: boom',
  '  ...',
  '1..3',
  '# tests 3',
  '# pass 1',
  '# fail 2',
].join('\n'));
process.exit(1);
