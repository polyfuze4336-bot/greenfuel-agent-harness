// Who is using the Studio. Identity is resolved by GitHub, not typed in: `gh api user` returns the account the GitHub CLI
// is signed in to, with its numeric id and its type. Roles then come from the repository policy, keyed on that id.
// Limit, stated plainly: this proves which GitHub account is configured on this computer. It cannot prove that a human is at
// the keyboard. The real gate against an unattended approval is that nothing becomes canonical until a person merges a pull request.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import type { Principal } from '../auth/authorize.ts';

/** A verified person. See auth/authorize.ts: the same type serves GitHub and Entra sign-ins. */
export type VerifiedUser = Principal;

export class IdentityError extends Error {
  readonly code: 'NOT_SIGNED_IN' | 'GH_UNAVAILABLE' | 'NOT_A_PERSON' | 'AGENT_SESSION';
  constructor(code: IdentityError['code'], message: string) {
    super(message);
    this.name = 'IdentityError';
    this.code = code;
  }
}

export interface IdentityProvider {
  verify(): Promise<VerifiedUser>;
}

function parseUser(raw: unknown, verifiedBy: 'github-api' | 'test-fixture'): VerifiedUser {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (typeof o.login !== 'string' || !o.login || !Number.isInteger(o.id)) throw new IdentityError('NOT_SIGNED_IN', 'GitHub did not return an account. Run `gh auth login`.');
  // Accounts of type Bot or Organization cannot decide. A person's account is type "User".
  if (o.type !== 'User') throw new IdentityError('NOT_A_PERSON', `${o.login} is a ${String(o.type)} account. Only a person's GitHub account can decide.`);
  // GitHub signs a person in with no second-factor claim the Studio can see, so mfa is false and authAt is the moment GitHub confirmed them.
  return { provider: 'github', subject: String(o.id), tenantId: null, login: o.login, id: o.id as number, name: typeof o.name === 'string' && o.name ? o.name : null, type: 'User', verifiedBy, entraRoles: [], entraGroups: [], mfa: false, authAt: Date.now() };
}

/** Asks GitHub who the signed-in GitHub CLI account is. No token is read, stored or logged by the Studio. */
export class GhCliIdentity implements IdentityProvider {
  verify(): Promise<VerifiedUser> {
    if (process.env.HARNESS_AGENT_SESSION) return Promise.reject(new IdentityError('AGENT_SESSION', 'The Studio refuses to sign in inside an agent session. Start it from your own terminal.'));
    return new Promise((resolve, reject) => {
      execFile('gh', ['api', 'user'], { timeout: 20_000, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
        if (err) {
          const msg = String(stderr || err.message);
          return reject(new IdentityError(/auth|login|401|token/i.test(msg) ? 'NOT_SIGNED_IN' : 'GH_UNAVAILABLE', `GitHub could not confirm who you are: ${msg.trim().slice(0, 160)}`));
        }
        try {
          resolve(parseUser(JSON.parse(stdout), 'github-api'));
        } catch (e) {
          reject(e);
        }
      });
    });
  }
}

/** Test only: reads the account from a file. Selected by the runtime only when STUDIO_TEST_MODE is set. */
export class FixtureIdentity implements IdentityProvider {
  private readonly file: string;
  constructor(file: string) {
    this.file = file;
  }
  async verify(): Promise<VerifiedUser> {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      throw new IdentityError('NOT_SIGNED_IN', 'No test identity is set.');
    }
    return parseUser(raw, 'test-fixture');
  }
}

export { SessionStore, type Session } from '../auth/sessions.ts';
