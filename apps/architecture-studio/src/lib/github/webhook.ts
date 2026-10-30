// Webhook handling. A delivery is accepted only if its HMAC-SHA256 signature over the exact raw body matches the shared secret.
// Even then, nothing in the payload is trusted as state: a verified delivery only tells the Studio WHICH proposals to re-check,
// and the re-check asks GitHub directly. A forged or replayed payload therefore cannot make anything look merged or approved.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** True when `header` (`sha256=<hex>`) is the correct signature of `rawBody` under `secret`. Constant-time compare. */
export function verifySignature(secret: string, rawBody: string | Buffer, header: string | null): boolean {
  if (!secret || !header) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(m[1]!, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export function signBody(secret: string, rawBody: string | Buffer): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

/** Remembers recent delivery ids so a replayed delivery is acknowledged but not processed twice. */
export class DeliveryLog {
  private readonly file: string;
  private readonly keep: number;
  constructor(file: string, keep = 500) {
    this.file = file;
    this.keep = keep;
  }

  private read(): string[] {
    try {
      const v = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  seen(id: string): boolean {
    return this.read().includes(id);
  }

  record(id: string) {
    const all = [...this.read().filter((x) => x !== id), id].slice(-this.keep);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(all), { mode: 0o600 });
  }
}

export interface WebhookTarget {
  event: string;
  action: string | null;
  repo: string | null;
  /** Pull request numbers and head shas the event refers to. */
  prNumbers: number[];
  headShas: string[];
  /** A push to this ref: the canonical branch may have moved. */
  pushedRef: string | null;
}

const EVENTS = new Set(['ping', 'pull_request', 'pull_request_review', 'check_run', 'check_suite', 'status', 'push']);
export const isHandledEvent = (e: string) => EVENTS.has(e);

/** Pulls out just the identifiers a re-check needs. Anything else in the payload is ignored. */
export function targetOf(event: string, payload: unknown): WebhookTarget {
  const p = (payload ?? {}) as Record<string, any>;
  const prNumbers = new Set<number>();
  const headShas = new Set<string>();
  const num = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
  const sha = (v: unknown) => (typeof v === 'string' && /^[0-9a-f]{40,64}$/.test(v) ? v : null);
  const n = num(p.pull_request?.number) ?? num(p.number);
  if (n) prNumbers.add(n);
  for (const x of [p.check_run?.check_suite?.pull_requests, p.check_suite?.pull_requests, p.check_run?.pull_requests] as unknown[]) {
    if (Array.isArray(x)) for (const pr of x) if (num((pr as any)?.number)) prNumbers.add((pr as any).number);
  }
  for (const s of [p.pull_request?.head?.sha, p.check_run?.head_sha, p.check_suite?.head_sha, p.sha]) {
    const v = sha(s);
    if (v) headShas.add(v);
  }
  return {
    event,
    action: typeof p.action === 'string' ? p.action : null,
    repo: typeof p.repository?.full_name === 'string' ? p.repository.full_name : null,
    prNumbers: [...prNumbers],
    headShas: [...headShas],
    pushedRef: event === 'push' && typeof p.ref === 'string' ? p.ref : null,
  };
}
