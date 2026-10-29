# Architecture Decision Studio (read-only)

A local web viewer over the decisions, tasks, approvals, assumptions and evidence recorded in this repository. It reads committed git content and shows it. **It writes nothing**: no repository file, no GitHub state, no approval. Write-back is not implemented in this stage.

This is **not** the bunkering platform. It is part of the engineering and governance control plane, and no business logic of the Green-Fuel Bunkering Certification Platform lives here.

> Governance status: the Studio was built on the owner's explicit instruction. Its authorising ADR does not exist yet and no approver is enrolled, so the build is unsigned. See [UI-READONLY-REPORT](../../docs/architecture-studio/UI-READONLY-REPORT.md) section 7 and owner TODO T61.

## Run it

Needs Node 22.18 or later and git. From this folder:

```powershell
npm ci --ignore-scripts
npm run build
npm start          # http://localhost:3100, loopback only
```

`npm run dev` runs the development server on the same address. Open `http://localhost:3100`.

| Variable | Default | Meaning |
|---|---|---|
| `STUDIO_REPO_ROOT` | the git repository containing the working directory | Repository to read |
| `STUDIO_REF` | `HEAD` | Branch, tag or commit to read. Only plain ref names are accepted |
| `STUDIO_ALLOWED_HOSTS` | none | Extra `Host` header values to accept, comma separated. Leave unset |
| `STUDIO_E2E_DELAY_MS` | `0` | Test only: delays repository reads so loading states can be shown |

## What it shows

| Page | Source of truth it reads |
|---|---|
| Overview | Every figure is derived; each carries its definition |
| Decision Register | `docs/adr/*.md` (20 ADRs) and `docs/context/DECISION-REGISTER.md` (37 open entries) |
| Work Queue | `docs/state/TODO.md` (owner tasks) and `docs/harness/IMPLEMENTATION-ROADMAP.md` |
| Approvals | `harness/policy/approvers.json`, `docs/approvals/`, Proposed ADRs and design reviews |
| Architecture & Evidence | design reviews, requirements and traceability, risks, assumptions, evidence records, documents |
| Presentation Studio | `docs/capstone/presentation/` |

Counting and status rules are in [DATA-MAPPING](../../docs/architecture-studio/DATA-MAPPING.md). A test compares the Studio's counts with the independent discovery snapshot.

## How it is built

```
git objects at one commit ──► GitRepositoryAdapter (read-only allowlist)
                              ──► parsers (src/lib/repo/parse.ts)
                              ──► StudioModel (src/lib/repo/build.ts)
                              ──► server components and /api/v1/* (read-only)
                              ──► React UI (Next.js App Router, Tailwind, Radix primitives, lucide icons)
```

- **One commit, no drift.** The adapter resolves `HEAD` (or `STUDIO_REF`) once and reads blobs from that commit. Uncommitted edits are never shown; the sync popover reports how many exist.
- **Read-only by construction.** `git.ts` runs only `rev-parse`, `ls-tree`, `cat-file`, `rev-list`, `for-each-ref`, `log`, `config --get`, `remote get-url`, `status`, `symbolic-ref` and `merge-base`, with `--no-optional-locks`. Any other subcommand throws. There is no method that writes. Tests prove HEAD, refs, the index and `git status` are unchanged after a full tour.
- **Traceable to GitHub, honestly.** A record links to a GitHub permalink only when a pushed commit holds a byte-identical copy of the file, so the link shows exactly what the Studio read. Otherwise the record is labelled **Local only**.
- **Derived data is labelled.** The design-gate result and the `validate-approvals` output come from `docs/architecture-studio/inventory.snapshot.json`, a generated file. The Studio shows them as derived and does not re-run the gate.

## API (all read-only, JSON, `Cache-Control: no-store`)

| Method and path | Returns |
|---|---|
| `GET /api/v1/repository` | repository facts, metrics, blockers, attention items |
| `GET /api/v1/decisions?status=&type=&milestone=` | decisions |
| `GET /api/v1/decisions/{id}` | one decision, or a 404 problem |
| `GET /api/v1/tasks?status=&blocked=` | tasks |
| `GET /api/v1/approvals` | approval authority, pending approvals, reviews |
| `GET /api/v1/search?q=&kind=` | search hits |
| `GET /api/v1/history?path=` | last five commits touching a tracked file |
| `POST /api/v1/refresh` | discards the Studio's 5 second cache and re-reads. Does not fetch or write |

Errors are `application/problem+json`. Write methods on the data routes return 405.

## Security

- Binds to `localhost` and rejects any request whose `Host` header is not loopback (DNS-rebinding defence; `src/proxy.ts`).
- Strict Content-Security-Policy (`default-src 'self'`, `frame-ancestors 'none'`), `nosniff`, `no-referrer`, no `X-Powered-By`. No third-party request is made by any page: no web fonts, analytics or CDN.
- There is no sign-in. **Do not expose the port.** The identity menu shows the local git identity and says it is not authenticated.
- Refs are validated (no leading `-`, no `..`), file paths for history must exist in the commit's tree, and no absolute path is sent to the browser.
- Dependencies are pinned by the lockfile and were installed with `--ignore-scripts`. `npm audit` reported 0 vulnerabilities (see the report).

## Tests

```powershell
npm run typecheck     # tsc --noEmit
npm run test:unit     # adapter, parsers, read-only guarantee, count agreement (node --test)
npm run build
npm run test:e2e      # Playwright on Microsoft Edge; starts its own servers on 3100, 3101, 3102
```

The end-to-end run also regenerates the screenshots in `docs/architecture-studio/screenshots/`. The unit checks live in `checks/` and the browser tests in `e2e/` so the repository-wide `node --test` does not collect them.

## Known limits

- "Blocked tasks" is rule-based on the task's own wording, not a recorded field. The rule is shown wherever the number appears.
- Roadmap items record no status, so none is shown.
- The Studio does not recompute the design gate or verify approval signatures. It shows what the files say and what the derived snapshot recorded.
- Tested on Microsoft Edge (Chromium) only, with automated accessibility checks. No manual screen-reader review has been done.
- Write-back (proposals as branches and pull requests) is designed in [INTEGRATION-DESIGN](../../docs/architecture-studio/INTEGRATION-DESIGN.md) and is **not** built.
