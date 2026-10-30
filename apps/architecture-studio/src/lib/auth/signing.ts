// Signing and verifying approval records.
//
// A record in the repository (docs/decision-reviews/..., docs/work-items/...) counts only if the Studio server signed it. The
// signature is Ed25519 over a fixed prefix and the record's own hash, and the server signs only after every authorization check
// has passed. Anyone who can commit a file can write a record with a correct hash, because the hash is just a digest. They
// cannot write a correct signature without the server's private key. So a hand-written record, a Markdown note, an AI-written
// commit, or a copy of a real record placed under another path or sequence number is not an approval.
//
// Trust is decided by the operator, not by the repository: the keys that count are read from server configuration. A public key
// committed to the repository is never trusted on its own, because anyone who can commit could add their own.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SIGNATURE_PREFIX = 'greenfuel.studio-record/v2\n';

export interface RecordSignature {
  keyId: string;
  alg: 'Ed25519';
  value: string;
}

export interface TrustedKey {
  id: string;
  publicKey: crypto.KeyObject;
  /** Records created after this instant are not accepted from this key (rotation). */
  notAfter: number | null;
  /** A key the Studio generated for development. Never trusted when Entra sign-in is the authentication mode. */
  dev: boolean;
}

export class Signer {
  readonly keyId: string;
  private readonly key: crypto.KeyObject;
  constructor(privateKey: crypto.KeyObject) {
    this.key = privateKey;
    this.keyId = keyIdOf(crypto.createPublicKey(privateKey));
  }
  sign(eventHash: string): RecordSignature {
    const sig = crypto.sign(null, Buffer.from(SIGNATURE_PREFIX + eventHash), this.key);
    return { keyId: this.keyId, alg: 'Ed25519', value: sig.toString('base64') };
  }
  toJSON() {
    return { keyId: this.keyId };
  }
}

export const keyIdOf = (pub: crypto.KeyObject) => crypto.createHash('sha256').update(pub.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);

export interface Trust {
  signer: Signer | null;
  keys: Map<string, TrustedKey>;
  /** Why the Studio cannot sign, when it cannot. */
  signerProblem: string | null;
}

export function emptyTrust(problem: string | null = null): Trust {
  return { signer: null, keys: new Map(), signerProblem: problem };
}

/** Builds trust from an Ed25519 private key and any extra public keys. Used by the loader and by tests. */
export function trustFrom(o: { privateKeyPem?: string; extra?: { id?: string; publicKeyPem: string; notAfter?: string | null }[]; dev?: boolean }): Trust {
  const t = emptyTrust();
  if (o.privateKeyPem) {
    try {
      const priv = crypto.createPrivateKey(o.privateKeyPem);
      if (priv.asymmetricKeyType !== 'ed25519') throw new Error('not an Ed25519 key');
      t.signer = new Signer(priv);
      const pub = crypto.createPublicKey(priv);
      t.keys.set(t.signer.keyId, { id: t.signer.keyId, publicKey: pub, notAfter: null, dev: !!o.dev });
    } catch {
      t.signerProblem = 'The signing key could not be read. It must be an Ed25519 private key in PEM form.';
    }
  }
  for (const k of o.extra ?? []) {
    try {
      const pub = crypto.createPublicKey(k.publicKeyPem);
      if (pub.asymmetricKeyType !== 'ed25519') continue;
      const id = keyIdOf(pub);
      if (!t.keys.has(id)) t.keys.set(id, { id, publicKey: pub, notAfter: k.notAfter ? Date.parse(k.notAfter) : null, dev: false });
    } catch {
      /* an unreadable extra key is simply not trusted */
    }
  }
  return t;
}

/**
 * Reads the operator's trust configuration.
 *   STUDIO_SIGNING_KEY_FILE            Ed25519 private key (PEM) this server signs with.
 *   STUDIO_TRUSTED_SIGNING_KEYS_FILE   JSON list of { publicKeyPem, notAfter } for earlier keys that must still verify.
 * With no key configured, a development key is created, but only when `allowDevKey` is true (never in Entra mode). It lives in the
 * user's profile (~/.greenfuel-studio, or STUDIO_DEV_KEY_DIR), not in the repository tree: a private key inside the working tree is
 * what the harness's secret scan exists to catch. When STUDIO_CACHE_DIR is set explicitly (tests, throw-away worlds) it lives there.
 */
export function loadTrust(env: Record<string, string | undefined>, cacheDir: string, allowDevKey: boolean): Trust {
  const keyFile = env.STUDIO_SIGNING_KEY_FILE?.trim();
  let extra: { id?: string; publicKeyPem: string; notAfter?: string | null }[] = [];
  const extraFile = env.STUDIO_TRUSTED_SIGNING_KEYS_FILE?.trim();
  if (extraFile) {
    try {
      extra = JSON.parse(fs.readFileSync(extraFile, 'utf8')) as typeof extra;
    } catch {
      extra = [];
    }
  }
  if (keyFile) {
    try {
      return trustFrom({ privateKeyPem: fs.readFileSync(keyFile, 'utf8'), extra });
    } catch {
      return emptyTrust('The signing key file cannot be read.');
    }
  }
  if (!allowDevKey) return { ...trustFrom({ extra }), signerProblem: 'No signing key is configured. Set STUDIO_SIGNING_KEY_FILE: without it the Studio cannot record an approval.' };
  const keyDir = env.STUDIO_DEV_KEY_DIR?.trim() || (env.STUDIO_CACHE_DIR?.trim() ? path.join(cacheDir, 'signing') : path.join(os.homedir(), '.greenfuel-studio'));
  const file = path.join(keyDir, 'dev-ed25519.pem');
  try {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const { privateKey } = crypto.generateKeyPairSync('ed25519');
      fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    }
    return trustFrom({ privateKeyPem: fs.readFileSync(file, 'utf8'), extra, dev: true });
  } catch {
    return emptyTrust('A development signing key could not be created.');
  }
}

/** Null when the signature is valid for this record under a trusted key, otherwise why not. */
export function verifyRecordSignature(trust: Trust, sig: unknown, eventHash: string, createdAtMs: number, opts: { allowDevKeys: boolean }): string | null {
  const s = sig as Partial<RecordSignature> | null;
  if (!s || typeof s !== 'object' || s.alg !== 'Ed25519' || typeof s.keyId !== 'string' || typeof s.value !== 'string') return 'the record carries no valid signature, so it is not an approval';
  const key = trust.keys.get(s.keyId);
  if (!key) return `the record is signed by a key this server does not trust (${s.keyId.slice(0, 16)})`;
  if (key.dev && !opts.allowDevKeys) return 'the record is signed with a development key, which is not accepted in production';
  if (key.notAfter !== null && createdAtMs > key.notAfter) return 'the record was made after its signing key was retired';
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(SIGNATURE_PREFIX + eventHash), key.publicKey, Buffer.from(s.value, 'base64'));
  } catch {
    ok = false;
  }
  return ok ? null : 'the signature does not match the record: it was edited, or it was not signed by this server';
}
