# Isolated execution environment

**Status: configured and statically validated. NOT built, NOT started, NOT probed.** Docker Desktop was not running on this machine (the Docker CLI reports no engine on the Linux pipe), and starting it and pulling an image is a host change that was not made. Everything below describes what the configuration is written to do. Treat it as unverified until the owner builds it and the in-container self-check passes (steps at the end).

Hooks are defence in depth. They see Copilot tool calls only, run as the developer's user, and can be disabled by an untrusted folder. An agent that has the developer's credentials and file access is not contained by a hook. The only boundary this harness can offer for a default or compromised session is a different execution environment with nothing in reach worth stealing and nothing writable worth tampering with.

## What the configuration does

Files: [.devcontainer/devcontainer.json](../../.devcontainer/devcontainer.json), [Dockerfile](../../.devcontainer/Dockerfile), [init-firewall.sh](../../.devcontainer/init-firewall.sh), [allowed-hosts.txt](../../.devcontainer/allowed-hosts.txt), [pre-push-deny](../../.devcontainer/pre-push-deny).

| Concern | Design | Checked by |
|---|---|---|
| Host credentials | No mount of `.azure`, `.ssh`, `.config/gh`, `.gnupg`, `.kube`, `.docker`, `.aws`, npm or Git credential files. `GH_TOKEN`, `GITHUB_TOKEN`, Azure client variables and `SSH_AUTH_SOCK` are blanked; `AZURE_CONFIG_DIR`, `AZD_CONFIG_DIR` and `GH_CONFIG_DIR` point at a non-existent path. No `${localEnv:...}` anywhere | `validate-isolation.mjs` (static); self-check (runtime) |
| Docker socket | Not mounted; no Docker-in-Docker or Docker-outside-of-Docker feature; no `--privileged`; no host network, PID or IPC | static |
| Privilege | `--cap-drop=ALL` with only `NET_ADMIN` and `NET_RAW` added for the firewall; `no-new-privileges`; passwordless sudo removed from the base image; the attached user is the non-root `node`; memory and process limits | static |
| Network | The entrypoint (as root, once) installs a default-deny firewall: only HTTPS to the hosts in `allowed-hosts.txt`, plus the container's DNS servers. IPv6 closed. It refuses to start with an empty allowlist and self-checks that an unlisted host is unreachable. GitHub, the GitHub API, the Azure control plane and package registries are deliberately **not** allowed | static; the firewall itself has not run |
| Policy engine, hooks, workflows, tests | Bind-mounted **read-only** over the writable workspace: `harness`, `tests`, `evaluation`, `.github`, `.vscode`, `.devcontainer`, `package.json`, `.mcp.json`, `.git/hooks`, `.git/config`. Code running in the container, including a test or an agent, cannot rewrite the policy engine, a hook, the CI gate or a test assertion. Changing them is a host-side, reviewed commit | static; runtime self-check probes write access |
| Detecting tampering anyway | `harness/scripts/guarded-run.mjs -- node --test` hashes the protected paths before and after a run and exits 4 if any file was modified, added or removed, even when the tests pass. It accepts only test and validator commands | 6 tests with real child processes |
| Pushing | No remote credentials, a firewall without GitHub, and a system-wide pre-push hook that always refuses | static |
| Lifecycle | Nothing runs on create. The only start command is the read-only self-check | static |

## Independent review of this stage

A read-only model review (not a human) found three issues. (1) The CI control-plane guard is report-only: **accepted and disclosed**, it stays so until the owner enrolls and enables it (T43); the review's remedy (committed enforcing policy plus a required check) needs an enrolled owner and branch protection. (2) Evidence records measured tree cleanliness only before the command: **fixed**, they now also record `treeCleanAfter`, `headAfter` and `headUnchanged`; a claim is still free text. (3) The container left `docs/evidence`, `docs/approvals`, `docs/adr`, `memory`, `.gitignore` and `.gitattributes` writable: **fixed**, they are now read-only mounts and required by the validator (so evidence is recorded on the host, not inside the container).

## What it does not do

- **Host Git credential and SSH forwarding are features of the Dev Containers extension, not of this file.** The extension copies the local Git config, reuses the host credential helper and forwards a running SSH agent by default. Per the VS Code documentation this is automatic. Setting `SSH_AUTH_SOCK` empty and blocking GitHub at the firewall narrows it, but the **owner must also turn forwarding off in the VS Code user settings** (the extension's Git credential helper and Git config copy options; the setting names are in the Dev Containers settings reference and were not verified in this session). Treat this as a required human step. Until then, "no host credentials" is not established.
- A read-only bind mount stops writes through the container; it does nothing about a host process or a person editing the same folder.
- The workspace is bind-mounted, so an agent can still modify unprotected files (documents, source) and `.git` objects and refs, and can commit locally. A fresh clone in a container volume is stronger and costs the convenience of editing on the host.
- The firewall resolves host names once at start. A CDN address that changes will be blocked until restart. The Copilot service hosts in `allowed-hosts.txt` are what the client is documented to need; none was observed here and they must be confirmed on the first real run (blocked traffic is logged with the prefix `harness-egress-denied`). If Copilot cannot reach its service the container is unusable for agent work, which is the fail-closed direction.
- The base image is pinned by tag, not by digest. Pin by digest after the first reviewed pull.
- Hook timeouts still fail open in the current Copilot CLI; the container, not the hook, is the answer.
- A kernel or container-runtime escape is out of scope.

## Owner steps to turn this from "configured" into "verified"

1. Start Docker Desktop. Install the Dev Containers extension.
2. In VS Code **user** settings, disable Git credential helper sharing and Git config copying for dev containers, and make sure no SSH agent is running or no key is loaded (`ssh-add -D`).
3. Run **Dev Containers: Reopen in Container**. The start command prints the self-check; every line must say `ok` and the last line must say all probes passed. If it says NOT RUNNING IN THE ISOLATED ENVIRONMENT, nothing is isolated.
4. In the container terminal confirm by hand: `git push` is refused, `curl https://github.com` fails, `curl https://example.com` fails, writing to `harness/` fails with a read-only filesystem error, `gh auth status` reports no login.
5. Run `node harness/scripts/guarded-run.mjs -- node --test` and record it with the evidence recorder. Record the host and Docker versions with it.
6. Only then change the isolation row in the acceptance report from NOT VERIFIED.

## Tests

[tests/isolation.test.mjs](../../tests/isolation.test.mjs) (42 tests): the real configuration validates; 33 mutations (dropping a capability drop, adding `--privileged`, mounting the Docker socket, the Azure profile or SSH keys, Docker-in-Docker, a forwarded environment variable, running as root, making `harness`, `tests` or `.git/hooks` writable, leaving a token set, a create-time command, keeping sudo, opening the firewall, allowing GitHub, the GitHub API, the Azure control plane, a wildcard or a raw IP, and a pre-push hook that succeeds) are each rejected; the runtime self-check reports honestly outside a container; the integrity guard detects an edit to the policy engine or a test assertion, an added file and a removed file; and the wrapper refuses every command that is not a test or validator. **These prove the configuration says the right things and the guard detects changes. They do not prove a container built from it enforces them.**
