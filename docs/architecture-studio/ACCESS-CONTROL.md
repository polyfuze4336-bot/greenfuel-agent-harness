# Access control for the Architecture Decision Studio

Status: built and tested against a **stand-in** for Microsoft Entra ID and a **simulated** GitHub. It has never run against a real Entra tenant or real GitHub. Not pushed, not approved. Read [Limitations](#remaining-limitations) before relying on any claim here.

This replaces the earlier "registered approver" list (`harness/policy/decision-workflow.json`, now deleted) with roles, enrollment, approval domains, segregation of duties, signed records, sessions and an administrator review. The review workflow ([REVIEW-WORKFLOW](REVIEW-WORKFLOW.md)), work queue ([WORK-QUEUE](WORK-QUEUE.md)) and GitHub sync ([GITHUB-SYNC](GITHUB-SYNC.md)) all call the same server-side decision.

## What it protects, in one paragraph

A person signs in through Microsoft Entra ID. Their role comes from an Entra **app role assignment** and, for any privileged role, **also** from an **enrollment** in `harness/policy/access-policy.json`; neither alone is enough. Every action is authorized on the server against that policy, by approval **domain**, designated approver, sign-in freshness, multi-factor sign-in and segregation of duties. An approval is written as a record **signed by the server's own key**; a record in the repository that lacks a valid signature, or whose actor was not enrolled for that domain at the time, is ignored and reported. Markdown, commit messages, comments and AI output cannot become an approval, because only the signed record counts.

## Roles

| Role | Can | Cannot |
|---|---|---|
| Viewer | Read | Comment, propose, approve |
| Contributor | Read, comment, propose (request revision, work-queue changes) | Approve, recommend |
| Architect | Contributor plus recommend | Approve |
| Security Reviewer | Read, comment, recommend, **approve security-gate** decisions | Approve architecture or deployment |
| Architecture Owner | Read, comment, propose, recommend, **approve architecture** decisions and **work completion** | Approve security, deployment, regulatory |
| Deployment Approver | Read, comment, **approve deployment-gate** decisions | Approve architecture or security |
| Administrator | Read, comment, **review access, suspend or reinstate people** | **Approve anything.** Holding an approver role as well is refused |

An Administrator does not override approval requirements: `administrator` carries no `approve:*` permission, and the policy drops both roles from anyone who holds an administrator role together with an approver role. Source: [model.ts](../../apps/architecture-studio/src/lib/auth/model.ts).

## Approval domains

A decision's domain is **derived** from the record's own stated approver and id by rules in the access policy. A user never chooses it. The most restrictive match wins: regulatory, then deployment, then security, then architecture.

| Domain | Who can approve in the Studio |
|---|---|
| architecture | Architecture Owner, if designated |
| security | Security Reviewer, if designated |
| deployment | Deployment Approver, if designated (the shipped policy has none) |
| **regulatory** (certification-scheme or filing matters) | **Nobody.** The Studio has no role for it and cannot record it |
| **unclassified** | **Nobody**, until the policy classifies it |

Architecture approval therefore cannot authorise a regulatory filing or a production deployment: those are different permissions, different roles, or not Studio actions at all.

## Order of checks for every action

Implemented in [authorize.ts](../../apps/architecture-studio/src/lib/auth/authorize.ts); each check is recorded in the audit event with its result.

1. The access policy is trusted (present, version 2, matches the optional pin).
2. The person holds at least one role right now (enrollment dates and revocation, tenant, suspension applied on every request, never cached in the session).
3. The domain is one the Studio can approve.
4. The role carries the permission the action needs.
5. For approval-class actions: provider accepted, designated approver, sign-in recent enough, multi-factor sign-in (Entra), and segregation of duties.

Validation of the request itself (valid option, rationale length, state machine) runs before authorization; see finding F-2.

## Enforced controls

"Enforced" means code refuses the action on the server and a test shows it. Test names are in `apps/architecture-studio/checks/access.check.ts` (unit and service level, 77 tests) and `e2e/access.spec.ts` (browser, 23 tests).

| ID | Control | Where | Evidence |
|---|---|---|---|
| AC-01 | Human sign-in only through Entra OIDC code flow with PKCE; state and nonce single-use and bound to the browser by a cookie | `auth/entra.ts` | "refuses a replayed callback…", "sends PKCE, state, nonce…", e2e "a callback replayed…" |
| AC-02 | ID token must be RS256, signed by a published key, right issuer, tenant, audience, unexpired, not future-dated, carrying our nonce, v2.0, a person not an application, with an object id. `alg:none`, HS256-with-public-key, other-key signature, unknown `kid` refused | `auth/entra.ts` | 15 parameterised refusals in `access.check.ts`; e2e "tokens that fail a check never create a session" |
| AC-03 | Discovery document may not point outside the configured authority; the client secret goes only to the token endpoint | `auth/entra.ts` | "does not trust a discovery document…", "never sends the client secret anywhere but…" |
| AC-04 | Group claim overage fails closed (no group-derived role) | `auth/entra.ts` | "gives no group roles when the token says groups overflowed" |
| AC-05 | Privileged role needs **both** an Entra assignment and an active enrollment | `auth/authorize.ts` | "an Entra role claim alone grants no privileged role", "enrollment alone grants nothing", e2e "a privileged Entra role claim without an enrollment…" |
| AC-06 | Token from another tenant carries no role; unknown or near-miss role names ignored | `auth/authorize.ts` | "a token from another tenant…", "an unknown role claim is ignored" |
| AC-07 | Nobody can enroll themselves; a privileged enrollment needs two different enrolled administrators as requester and approver (or is marked `bootstrap`, which is flagged) | `auth/access-policy.ts` | "nobody can enroll themselves…" (6 variants) |
| AC-08 | Only `kind: human` entries with a stable subject (`github:<id>` or `entra:<tenant>:<oid>`) are enrolled; agents, bots, service principals, names and emails are dropped | `auth/access-policy.ts` | "an entry that is not a human…is never enrolled" |
| AC-09 | Conflicting role pairs (including administrator with any approver role) are both removed | `auth/access-policy.ts` | "an administrator cannot also hold an approver role…" |
| AC-10 | Access policy pin (`STUDIO_ACCESS_POLICY_SHA256`): a policy that does not match grants nothing | `auth/access-policy.ts` | "a policy that does not match the pinned hash grants nothing"; service-level pin test |
| AC-11 | Roles are never read from a request; the domain is never chosen by the user | action routes | "a user cannot grant themselves access by what they send" |
| AC-12 | Server-side authorization on every API action, and on the reads in Entra mode; the page payload carries no repository content for someone who may not read | `lib/api.ts`, `repo/index.ts`, `layout.tsx` | e2e "every page shows only the sign-in screen…" (searches the served HTML for repository text), F-1 |
| AC-13 | Approval domains separate: architecture owner cannot approve security, security reviewer cannot approve architecture, **nobody** approves regulatory or unclassified | `auth/authorize.ts` | "approval domains are separate…", "architecture approval cannot authorise a regulatory filing or a deployment", e2e "regulatory decisions cannot be approved…" |
| AC-14 | Only the **designated** approver for the domain may decide, even with the role | `auth/authorize.ts` | "only the designated approver may decide" (unit, service) |
| AC-15 | Approvals need a recent sign-in (default 15 min) and, for Entra, a multi-factor sign-in; stale sign-in answers 401 `reauth-required` and the UI offers "Sign in again" with `prompt=login` | `auth/authorize.ts`, rail | "approving needs a recent sign-in…", "…needs multi-factor…", e2e step-up and MFA tests |
| AC-16 | GitHub-CLI sign-ins cannot approve unless the operator sets `STUDIO_ALLOW_DEV_APPROVALS=1`; the allowance is ignored in Entra mode | `auth/config.ts` | "a GitHub sign-in cannot approve unless…", "the development allowance is ignored in Entra mode" |
| AC-17 | Segregation of duties: the proposer of a revision cannot approve, reject or defer it; the submitter of work cannot complete or reject it; optionally an independent recommendation is required first | `auth/authorize.ts` | "segregation of duties" (4 tests), e2e SoD test |
| AC-18 | Approval records are **signed** by the server's Ed25519 key; an unsigned, wrongly signed, or hash-mismatched record is ignored and reported. Without a key the server records nothing (503) | `auth/signing.ts`, `workflow/review.ts` | "forged approval records" (11 tests), "without a signing key it records nothing", e2e hand-written record test |
| AC-19 | A signed record counts only if its actor was enrolled for the domain's role **at the record's time** (blocks back-dating, cross-role and agent-authored records); a record cannot be moved to another decision or sequence number | `auth/authenticity.ts` | "back-dating", "cross-role forgery", "replay" tests |
| AC-20 | Prose cannot impersonate approval: Markdown "Approved by…", a commit message, or a comment saying approved changes no status | `workflow/overlay`, loaders | "prose cannot impersonate an approval" |
| AC-21 | Idempotent submissions, stale-revision refusal, one change in flight at a time | `workflow/review.ts` | "a replayed submission (same key)…" |
| AC-22 | Sessions: random 256-bit token, only its hash stored, new token each sign-in, idle (30 min) and absolute (8 h) limits from the policy, server-side revocation, `HttpOnly`, `SameSite=Lax`, `Secure` when the redirect is HTTPS | `auth/sessions.ts`, `auth/login.ts` | "session management" (4 tests), e2e cookie and sign-out tests |
| AC-23 | CSRF and origin: changes need the same origin, `application/json` and a per-session token | `workflow/http.ts` | e2e "a request needs the origin and the per-session CSRF token…" |
| AC-24 | Revoked approver: an enrollment that has ended grants nothing from that moment, but does not unwind approvals made while it was valid | policy, `authenticity.ts` | "an enrollment that has ended grants nothing…", "a person revoked after approving…" |
| AC-25 | Administrator suspension: immediate, ends that person's sessions, refuses sign-in, survives restart, cannot be applied to oneself | `auth/suspensions.ts`, `access/suspend` | unit tests, e2e "a suspended approver loses access on their very next request…" |
| AC-26 | Administrative review: who holds what, what looks wrong (single administrator, bootstrap enrollments, unpinned policy, designated but revoked, repeated refusals), and an audited attestation recording who looked at which policy hash | `auth/review.ts`, `/access` | "administrative review" unit tests, e2e administration tests |
| AC-27 | Unauthorized actions are audited (actor, action, decision, code, checks) and refused with a reason; non-administrators get 403 from `/api/v1/access/*` | `workflow/store.ts` | "denies an unauthenticated caller…", e2e "…nobody else can" |
| AC-28 | No secret reaches the browser: client secret and signing key are read from files on the server; none is in the built client assets or the session response | config | e2e "no secret reaches the browser" (scans `.next/static`) |
| AC-29 | AI and agents: an agent identity cannot be enrolled (AC-08); a GitHub-CLI sign-in is refused inside an agent session; approvals by AI-authored records fail AC-18/19 | `workflow/identity.ts` | "refuses to sign in inside an agent session", forged-record tests |

## The required acceptance scenarios

| Scenario | Result | Where |
|---|---|---|
| Unauthorized approval | Refused for viewer, contributor, administrator, wrong-domain reviewer, unenrolled person, bot, recycled login (right login, wrong id) | AC-05, 13, 14; unit and e2e |
| Privilege escalation | Role claim without enrollment, enrollment without role claim, wrong tenant, self-enrollment, one-person enrollment, administrator+approver, agent entry, tampered policy | AC-05 to AC-10 |
| Cross-role access | Each role refused outside its permissions; only an Administrator reaches `/access`; Administrator cannot approve | AC-13, 26, 27 |
| Approval replay | Same idempotency key returns the first result; replayed OIDC callback refused; a genuine record copied to another decision or sequence number refused | AC-01, 19, 21 |
| Forged approval record | Unsigned, wrong key, signature from another event, unenrolled actor, back-dated, wrong role, regulatory domain, hand-planted commit in a real repository clone | AC-18, 19; unit and e2e |
| Session expiration | Idle and absolute expiry with reason; activity does not extend the absolute limit or refresh the sign-in age used for step-up | AC-22; unit |
| Revoked approver | Policy revocation and administrator suspension take effect on the next request; earlier approvals stand | AC-24, 25 |
| Segregation-of-duties violation | Proposer approving, submitter completing, own recommendation, conflicting roles | AC-09, 17 |

## Findings made while testing

- **F-1 (fixed): the page payload leaked repository content to signed-out visitors.** The first version gated the layout, but Next.js renders each page separately and serialised the page data into the HTML for a signed-out request (the Decision Register text was present). Repository reads now refuse in Entra mode (`getModel` checks the session), and the browser test searches the served HTML for repository text.
- **F-2 (open, low): validation runs before authorization.** An unauthorized caller who sends a malformed request gets a 400 validation message rather than a 403. It discloses only request-format rules, but a cleaner order is authorization first.
- **F-3 (design consequence, not a bug):** requesting a revision counts as *proposing*, so the person who asked for the revision cannot then approve, reject or defer that decision. A second Architecture Owner is needed to complete it.
- **F-4 (fixed):** a record whose source file was not in git history made the author lookup throw; it now looks the author up only when the policy binds git emails to people, and treats a missing history as "no author on file".
- **F-5 (consequence for this repository, see below):** under the shipped policy, many register decisions are not approvable in the Studio at all.

## What this means for this repository today

Estimated from the 37 register entries in `docs/context/DECISION-REGISTER.md` using the shipped classification rules (text match on the stated approver; the live figure is the "Approval domains" panel on `/access`, which also counts ADRs):

| Domain | Register entries | Approvable in the Studio |
|---|---|---|
| architecture | 11 | by the one enrolled Architecture Owner |
| security | 5 | nobody: no Security Reviewer is enrolled |
| regulatory | 16 (named approver includes quality manager or compliance counsel) | never |
| unclassified | 5 (commercial lead, data protection lead, port operations) | nobody until classified |

The shipped policy enrolls **one** person (`github:225331490`, the account the owner named on 2026-10-30) as Architecture Owner, `basis: bootstrap`, with no second administrator. Consequences:

- Segregation of duties is enforced, so that person **cannot approve work they submitted** and cannot decide a decision they requested a revision on. This reverses the earlier `requireIndependentCompletionApproval: false` setting (T63).
- There is **no Administrator**, so `/access` is unavailable and nobody can suspend anyone from the Studio.
- That GitHub identity is accepted for approvals only on a development server with `STUDIO_ALLOW_DEV_APPROVALS=1`. In Entra mode no approval is possible until an Entra tenant exists and real people are enrolled.

## Remaining limitations

These are not hidden defects; they are what the design does not do.

| ID | Limitation |
|---|---|
| L-01 | **Real Entra and real GitHub were never exercised.** Tests use a stand-in IdP that implements the protocol as I read it. Real-tenant behaviour (claims, `amr` values, token lifetimes, conditional access, group overage) is unverified. |
| L-02 | **Entra role removal takes effect at the next sign-in,** up to the 8-hour session. Enrollment revocation, policy changes and administrator suspension are immediate (the policy is re-read every 2 s). Use suspension for urgent cases. |
| L-03 | **The development GitHub sign-in cannot prove a human is present** and has no multi-factor claim; step-up is nominal. It is refused for approvals unless an operator sets a flag, and unavailable in Entra mode. |
| L-04 | **An agent driving a signed-in browser session** can still act as that person within the session. Step-up, multi-factor sign-in, one-change-at-a-time and the merge by a different person on GitHub reduce but do not remove this. |
| L-05 | **The trust root is the server's signing key**, held in an environment-selected file. Whoever holds it can sign anything. Rotation is supported (`STUDIO_TRUSTED_SIGNING_KEYS_FILE`), but there is no hardware key or HSM. On a development server with no key configured the Studio generates a development key in `~/.greenfuel-studio` (outside the repository, which the harness secret scan would otherwise flag); records signed by it are refused in Entra mode. |
| L-06 | **Denial of service by committing garbage.** A malformed or unsigned record on a decision's path is reported and blocks further actions on that decision until it is removed through a reviewed repository change. Fail closed is deliberate. |
| L-07 | **Enrollment is a repository file.** Only a reviewed pull request should change it, but branch protection is unavailable on this plan (T14). The optional pin mitigates; if unset, a policy change that reaches the canonical branch is trusted once read. |
| L-08 | **Bootstrap enrollment is unreviewed by construction** and is flagged on `/access`. |
| L-09 | **Audit log is local and hash-chained**, not external or immutable storage. The approval itself is also in the signed repository record. |
| L-10 | **Reading is gated only in Entra mode.** Development and test modes answer on loopback only, as before. |
| L-11 | **Group overage fails closed:** use app roles, not groups, for people in many groups. |
| L-12 | **No per-person GitHub authorization** on the GitHub App path: the App makes the commit and opens the pull request, and the person is recorded in the signed event, not as the GitHub commit author. |
| L-13 | **Validation precedes authorization** (F-2). |
| L-14 | **No rate limiting or lockout** on sign-in or action attempts beyond the repeated-refusal finding on the access review. |
| L-15 | **Regulatory and certification-scheme filing approval is out of band.** The Studio refuses it and has no way to record it. That separate process has no implementation here. |
| L-16 | **Session store is in memory:** a restart signs everyone out (safe, but a limit). It is a single-instance design. |
| L-17 | **No manual accessibility or keyboard review** has been done on the new screens; only automated axe checks. |

## Operator setup (not yet done)

1. In Entra: register an application, create the seven app roles (`Studio.Viewer`, `Studio.Contributor`, `Studio.Architect`, `Studio.SecurityReviewer`, `Studio.ArchitectureOwner`, `Studio.DeploymentApprover`, `Studio.Administrator`), add a web redirect URI `https://<host>/api/v1/auth/entra/callback`, create a client secret, and assign roles to people. Prefer requiring multi-factor authentication through Conditional Access for this application.
2. On the server: set `STUDIO_AUTH_MODE=entra`, `STUDIO_ENTRA_TENANT_ID`, `STUDIO_ENTRA_CLIENT_ID`, `STUDIO_ENTRA_CLIENT_SECRET_FILE`, `STUDIO_ENTRA_REDIRECT_URI`, `STUDIO_SIGNING_KEY_FILE` (an Ed25519 private key in PEM, outside the repository), and `STUDIO_ACCESS_POLICY_SHA256` (the hash of the reviewed policy).
3. In `harness/policy/access-policy.json` (by reviewed pull request): set `authentication.tenantId`, replace the bootstrap entry with `entra:<tenant id>:<object id>` enrollments, enroll at least two Administrators, a second Architecture Owner, and a Security Reviewer, and set designations in `ownership`. Keep `approvalProviders: ["entra"]`.
4. Review `/access` and record the attestation.

## Verification

Run on this machine, in this session:

- Studio unit and service checks (`npm run test:unit` in `apps/architecture-studio`): **240 passed, 0 failed**; 77 of them in `checks/access.check.ts`.
- Root harness tests (`npm test`): **1085 passed, 0 failed**. `npm run validate`: OK.
- Type check and production build: clean.
- Browser tests (Playwright, Microsoft Edge, 179 tests): `e2e/access.spec.ts` (23 tests, Entra mode against the stand-in IdP) passed in every run. The full suite was run end to end several times while the tests were being migrated to the new model; the **last single end-to-end pass had 173 passed, 1 failed, 1 skipped, 4 not run** (the failure was a test-data assumption in `work-queue.spec.ts`, fixed). After the fix `review.spec.ts`, `work-queue.spec.ts` and `shell.spec.ts` were re-run together: 51 passed. **No single run after the last edit covered all 179 tests**, so treat the full browser suite as passing by union of runs, not by one clean run.
- One review test needed a retry on `ECONNRESET` for an anonymous POST when it runs after `access.spec.ts`; the cause was not found (see `e2e/review.spec.ts`).

None of this verifies behaviour against a real identity provider.