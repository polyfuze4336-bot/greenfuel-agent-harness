// Immediate suspension. Changing the access policy is a reviewed repository change and takes a pull request. When someone must lose
// access NOW, an administrator can suspend them here: it is checked on every request, ends their sessions, and cannot be undone
// by the person suspended. It is recorded with who did it and why. A suspension does not change the policy; the policy change
// (revoking the enrollment) still has to follow, and the administrative review lists any suspension that has no matching revocation.
import fs from 'node:fs';
import path from 'node:path';

export interface Suspension {
  subject: string;
  by: string;
  reason: string;
  at: string;
}

export class SuspensionStore {
  private readonly file: string;
  constructor(dir: string) {
    this.file = path.join(dir, 'suspensions.json');
  }

  list(): Suspension[] {
    try {
      const v = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown;
      return Array.isArray(v) ? (v as Suspension[]).filter((s) => s && typeof s.subject === 'string') : [];
    } catch {
      return [];
    }
  }

  set(): Set<string> {
    return new Set(this.list().map((s) => s.subject.toLowerCase()));
  }

  suspend(s: Suspension) {
    const all = this.list().filter((x) => x.subject.toLowerCase() !== s.subject.toLowerCase());
    all.push({ ...s, subject: s.subject.toLowerCase() });
    this.write(all);
  }

  lift(subject: string): boolean {
    const all = this.list();
    const next = all.filter((x) => x.subject.toLowerCase() !== subject.toLowerCase());
    if (next.length === all.length) return false;
    this.write(next);
    return true;
  }

  private write(all: Suspension[]) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(all, null, 2), { mode: 0o600 });
  }
}
