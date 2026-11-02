import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { builtinModules } from 'node:module';

// Every package the code imports must be declared in package.json. A package that works only because another one happens to install it
// can disappear in an upgrade and break the build without any change to this code.
const appRoot = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
const builtins = new Set(builtinModules);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

const packageOf = (spec: string) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!);

describe('declared dependencies', () => {
  it('every bare import in src, scripts, e2e and checks is a declared package', () => {
    const undeclared = new Map<string, string>();
    for (const dir of ['src', 'scripts', 'e2e', 'checks']) {
      for (const file of walk(path.join(appRoot, dir))) {
        const text = fs.readFileSync(file, 'utf8');
        for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]|\bawait import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
          const spec = m[1] ?? m[2] ?? m[3];
          if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/') || spec.startsWith('node:')) continue;
          const name = packageOf(spec);
          if (builtins.has(name) || declared.has(name)) continue;
          undeclared.set(name, path.relative(appRoot, file));
        }
      }
    }
    assert.deepEqual([...undeclared.entries()], [], 'imported but not declared in package.json');
  });

  it('declares jszip, which the deck inspector imports directly', () => {
    assert.ok(declared.has('jszip'));
  });
});
