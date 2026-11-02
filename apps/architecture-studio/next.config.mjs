import { spawnSync } from 'node:child_process';

// Which code this build is. A container build has no git, so it receives STUDIO_BUILD_ID as a build argument; a local build asks git.
// "+dirty" means the working tree differed from the commit, so the build is not exactly that commit.
function buildId() {
  if (process.env.STUDIO_BUILD_ID?.trim()) return process.env.STUDIO_BUILD_ID.trim();
  const git = (...a) => spawnSync('git', a, { encoding: 'utf8' });
  const head = git('rev-parse', '--short=7', 'HEAD');
  if (head.status !== 0) return 'unknown';
  const dirty = git('status', '--porcelain', '--', '.').stdout.trim() !== '';
  return head.stdout.trim() + (dirty ? '+dirty' : '');
}

/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

// The Studio is a local, read-only viewer. The policy lets it load nothing from any other origin.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];

const nextConfig = {
  reactStrictMode: true,
  env: { STUDIO_BUILD_ID: buildId() },
  poweredByHeader: false,
  // pptxgenjs and jszip are plain Node packages; they are loaded as they are rather than bundled.
  serverExternalPackages: ['pptxgenjs', 'jszip'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
