// How the Studio is configured for authentication. All of it comes from the server's environment, never from the repository and
// never from the browser: who the identity provider is, which signing key counts, whether the access policy is pinned, and
// whether the development approval allowance is on.
import path from 'node:path';
import type { AuthContext } from './authorize.ts';
import type { AccessPolicy } from './access-policy.ts';
import { loadTrust, type Trust } from './signing.ts';
import { SuspensionStore } from './suspensions.ts';

/** entra: Microsoft Entra ID sign-in, the production mode. github-dev: the GitHub CLI account, for development; it is labelled as such everywhere. */
export type AuthMode = 'entra' | 'github-dev';

export interface EntraConfig {
  tenantId: string;
  clientId: string;
  clientSecretFile: string;
  redirectUri: string;
  /** https://login.microsoftonline.com unless a sovereign cloud or a test authority is used. */
  authority: string;
}

export interface AuthConfig {
  mode: AuthMode;
  /** If set, only an access policy with exactly this sha256 is trusted. */
  policyPin: string | null;
  /** Development only: GitHub-CLI sign-ins may approve. Ignored in entra mode. */
  devApprovals: boolean;
  cacheDir: string;
  entra: EntraConfig | null;
  secureCookies: boolean;
  problems: string[];
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const mode: AuthMode = env.STUDIO_AUTH_MODE?.trim().toLowerCase() === 'entra' ? 'entra' : 'github-dev';
  const cacheDir = env.STUDIO_CACHE_DIR?.trim() || path.resolve(process.cwd(), '.studio-cache');
  const problems: string[] = [];
  let entra: EntraConfig | null = null;
  if (mode === 'entra') {
    const tenantId = env.STUDIO_ENTRA_TENANT_ID?.trim() ?? '';
    const clientId = env.STUDIO_ENTRA_CLIENT_ID?.trim() ?? '';
    const clientSecretFile = env.STUDIO_ENTRA_CLIENT_SECRET_FILE?.trim() ?? '';
    const redirectUri = env.STUDIO_ENTRA_REDIRECT_URI?.trim() ?? '';
    if (!GUID.test(tenantId)) problems.push('STUDIO_ENTRA_TENANT_ID must be the tenant id (a GUID).');
    if (!clientId) problems.push('STUDIO_ENTRA_CLIENT_ID is not set.');
    if (!clientSecretFile) problems.push('STUDIO_ENTRA_CLIENT_SECRET_FILE is not set.');
    if (!/^https?:\/\/[^/]+\/api\/v1\/auth\/entra\/callback$/.test(redirectUri)) problems.push('STUDIO_ENTRA_REDIRECT_URI must be this server\'s /api/v1/auth/entra/callback URL, and registered on the app registration.');
    if (!problems.length) entra = { tenantId: tenantId.toLowerCase(), clientId, clientSecretFile, redirectUri, authority: (env.STUDIO_ENTRA_AUTHORITY?.trim() || 'https://login.microsoftonline.com').replace(/\/+$/, '') };
  }
  const pin = env.STUDIO_ACCESS_POLICY_SHA256?.trim().toLowerCase() || null;
  if (pin && !/^[0-9a-f]{64}$/.test(pin)) problems.push('STUDIO_ACCESS_POLICY_SHA256 must be a 64-digit hex sha256.');
  const redirect = env.STUDIO_ENTRA_REDIRECT_URI?.trim() ?? '';
  return {
    mode,
    policyPin: pin && /^[0-9a-f]{64}$/.test(pin) ? pin : null,
    devApprovals: mode !== 'entra' && env.STUDIO_ALLOW_DEV_APPROVALS === '1',
    cacheDir,
    entra,
    secureCookies: mode === 'entra' ? !/^http:\/\/(localhost|127\.0\.0\.1)/.test(redirect) : false,
    problems,
  };
}

const g = globalThis as unknown as { __studioAuthConfig?: { key: string; cfg: AuthConfig }; __studioTrust?: { key: string; trust: Trust }; __studioAuthOverride?: Partial<AuthConfig> | null; __studioTrustOverride?: Trust | null };

const ENV_KEYS = ['STUDIO_AUTH_MODE', 'STUDIO_ENTRA_TENANT_ID', 'STUDIO_ENTRA_CLIENT_ID', 'STUDIO_ENTRA_CLIENT_SECRET_FILE', 'STUDIO_ENTRA_REDIRECT_URI', 'STUDIO_ENTRA_AUTHORITY', 'STUDIO_ACCESS_POLICY_SHA256', 'STUDIO_ALLOW_DEV_APPROVALS', 'STUDIO_CACHE_DIR', 'STUDIO_SIGNING_KEY_FILE', 'STUDIO_TRUSTED_SIGNING_KEYS_FILE'];
const envKey = () => ENV_KEYS.map((k) => process.env[k] ?? '').join('|');

export function authConfig(): AuthConfig {
  const key = envKey();
  if (!g.__studioAuthConfig || g.__studioAuthConfig.key !== key) g.__studioAuthConfig = { key, cfg: readAuthConfig() };
  return g.__studioAuthOverride ? { ...g.__studioAuthConfig.cfg, ...g.__studioAuthOverride } : g.__studioAuthConfig.cfg;
}

/** The signing key and the keys that still verify. Created once per configuration. */
export function getTrust(): Trust {
  if (g.__studioTrustOverride) return g.__studioTrustOverride;
  const cfg = authConfig();
  const key = envKey();
  if (!g.__studioTrust || g.__studioTrust.key !== key) g.__studioTrust = { key, trust: loadTrust(process.env, cfg.cacheDir, cfg.mode !== 'entra') };
  return g.__studioTrust.trust;
}

/** Tests only. */
export function __setAuthForTests(o: { config?: Partial<AuthConfig> | null; trust?: Trust | null }) {
  if (o.config !== undefined) g.__studioAuthOverride = o.config;
  if (o.trust !== undefined) g.__studioTrustOverride = o.trust;
}

export function suspensions(): SuspensionStore {
  return new SuspensionStore(authConfig().cacheDir);
}

export function authContextFor(policy: AccessPolicy, now: number = Date.now()): AuthContext {
  const cfg = authConfig();
  return { policy, now, devApprovals: cfg.mode !== 'entra' && cfg.devApprovals, suspended: suspensions().set() };
}
