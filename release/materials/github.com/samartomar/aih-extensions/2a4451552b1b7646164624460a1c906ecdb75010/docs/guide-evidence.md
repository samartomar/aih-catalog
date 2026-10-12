# Ask AIH Guide delivery evidence

Observed 2026-10-11, Windows 11 Pro x64 (10.0.26200), Node 24.18.0.
This records Extensions source integration for [delivery issue #8](https://github.com/samartomar/aih-extensions/issues/8).
It is not a release publication or a claim of real-user client/MCP recovery.

## Content and identity

The authored set is `guide/source.md`, `guide/metadata.json`, `guide/compass.svg`,
`scripts/guide.mjs` and the Extensions version in `package.json`. The build renders
one body into the standalone [manual](../guide/MANUAL.md) and native entries.
[The manifest](../guide/manifest.json) records the source-input commit, source-set
SHA-256 and exact artifact hashes. The SVG is original; the text uses a compass.
No client-specific icon rendering is claimed.

Native scenarios used development renders of Extensions **0.5.0**, explicitly
marked uncommitted. Reference-link/status corrections followed the first runs;
the recovery loop and manual-action rules were unchanged. Committing inputs and
regenerating changes the displayed source identity, not those tested rules.
The saved manual exercised below had SHA-256
`8055a09ab3d483d17cc077381a0d592f83fbd58449fae52f287169beb186921e`;
the installed Kimi profile used in the named-entry scenario had SHA-256
`521703caa27e92b019b8fbc3716914364b939bc68d439213058303fe4584f499`.
These development-render hashes identify the test subjects; use the current
manifest for the integrated artifacts, whose identity headers differ.

## Installation and deterministic checks

An actual pinned-Matt-source installation ran in a disposable home with all five
targets and `--no-git-guard`. It completed with 188 owned file entries, version
0.5.0 and guard disabled for Claude, Codex, Kimi and OpenCode (Cursor shares
Claude). No real user configuration or host package installation was changed.
The saved manual, icon and hash manifest were present alongside native entries.
Actual disposable uninstall then completed with the saved manual and Kimi guide
entry removed; the real user installation was never touched.

`tests/guide-install.test.mjs` covers installation, update, conflict refusal,
removal, lost-manifest hash-based cleanup, preservation of modified content,
legacy manifest migration, unrelated hooks/content, and all guard opt-outs,
including the legacy OpenCode wrapper. `tests/guide-build.test.mjs` covers
source-commit stability after a generated-output commit and stale-output rejection.
`tests/hooks-misc.test.mjs` checks disabled OpenCode guard with routing preserved.
The installer regression was first observed failing because the manual was absent,
then passed after integration.

Required local checks passed: `npm run vendor` (no vendored diff), **139 tests**,
`npm run guide:check`, both `claude plugin validate <manifest> --strict`
checks via `npm run validate`, and `git diff --check`. CI runs deterministic
checks on Windows and Linux; a CI pass is not a native Linux-session claim.

## Native entry scope

| Client / surface | Observation | Delivered limit and fallback |
| --- | --- | --- |
| Kimi Code 2.1.1, `kimi-code/k3`, Windows | Actual main-agent conversations using `--agent-file`, plus installed named `--agent aih-guide` after pinned-source setup | Verified for these bounded scenarios only. No real MCP/client repair, macOS/Linux/WSL admission or universal recovery claim. |
| Claude Code 2.1.296, Windows | Local help supports whole-session `--agent`; generated user profile was accepted when disposable user settings were enabled. Model startup returned OAuth revoked / HTTP 401 with zero API tokens | Conversation unverified. Empty `--setting-sources` suppresses user-agent discovery. Use the manual if profile loading or authentication fails. Plugin manifests passed strict validation; plugin-route conversation was not verified. |
| OpenCode 1.18.11, Windows | Standalone native `debug agent aih-guide --pure` loaded the authored prompt with `mode: primary` | This is parsing/discovery, not a conversation. A full installed-plugin debug startup exceeded a 30-second budget before agent output; no model conversation was run. Use manual fallback until the actual session is verified. |
| Codex CLI 0.162.1, Windows | Installed binary ran; local help has no named direct-agent selector | Explicit saved-manual fallback; existing subagent TOML support is not advertised as direct conversation. No Codex recovery conversation was tested. |
| Cursor editor 3.14.7 x64, Windows | Installed CLI version check ran in the disposable context | Explicit saved-manual fallback. Third-party subagent import does not prove direct conversation; no Cursor recovery conversation was tested. |

No macOS, Linux or WSL native guide session ran. Those target combinations retain
the manual fallback and require their own client/version/session evidence.

## Controlled conversational scenarios

The reproducible [fixture](../evals/guide-recovery/README.md) is deliberately small:
its original action exits 7 when integration is disabled, exits 0 when enabled,
and exits 9 if its unrelated owner value changes. This is a test checker, not a
repair engine or a substitute for client-native verification.

1. **Scoped manual recovery.** In a new Kimi main-agent session, AIH/Core was
   declared unavailable and the user explicitly authorized the smallest edit to
   the disposable developer-owned settings. The guide inspected both files,
   reproduced `INTEGRATION_DISABLED` / exit 7, preserved a recoverable copy,
   changed only the enabled field, inspected the difference and retried the
   original checker: `ORIGINAL_ACTION_OK` / exit 0. The unrelated-value guard
   passed. It did not request the same authorization again and its hand-back
   limited the result to the synthetic fixture.
2. **Fresh-session continuation.** A separate Kimi invocation, without session
   resume or setup reapplication, read the persisted settings and reran the
   original checker successfully (exit 0). It made no edits and retained the
   limitation that actual MCP/client loading was unverified. Host observation
   establishes that this was a fresh guide conversation; the recovery target
   itself remained a file-level fixture.
3. **Managed-policy handoff.** Both an explicit profile and the installed named
   guide entry received a scenario reporting managed authentication restrictions,
   no editable local target and no command authorization. They made no tool
   calls/changes, identified IT/admin ownership, requested a scoped policy or
   provisioning decision, and marked diagnostics/retry unperformed. The prompt's
   policy claim was supplied by the scenario, not independently diagnosed.
4. **Saved manual with native guide absent.** The manual was copied to a separate
   file, pasted into an ordinary Kimi prompt with **no `--agent` or `--agent-file`**,
   and the fixture was reset. No AIH, MCP or online reference was available.
   The session inspected local evidence, reproduced exit 7, made the single
   authorized edit, preserved unrelated content and verified exit 0 twice.
   The final answer expressly declined real-client/MCP recovery claims.

Each native invocation used normal existing authentication in disposable client
state, hidden processes, a 180-second wall-clock deadline, and no permission or
sandbox bypass. Prompt mode rejected `--yolo`; it was removed before a model call.
No persistent PATH, real user hooks, credentials, managed policy or system trust
was changed. Raw transcripts/configuration and credentials are not public evidence.
The public record allowlists fixture results, versions, artifact identities and
limits; it does not export raw logs or private host paths.

These scenarios do **not** exercise a supported Core repair/Apply, a real shadowed
AIH installation, sandboxed MCP discovery/query, administrator changes, or
connectivity/trust repair. Those branches remain guidance with installed-contract
checks and must not inherit this fixture's pass. No with-and-without effectiveness
or context-cost claim is made.

## Nuclei guidance integration

[Extensions #10](https://github.com/samartomar/aih-extensions/issues/10) adds
guidance to the authored body and broadens its discovery description for
Extensions **0.6.0**. The manual and three native entries remain renders of that
same body. The reviewed public consumer contract is Catalog source
`955754624f968b3823edddd2dcf1c9bacf33ccf4`: packaged
`workflows/nuclei/AUTHORING.md`, the three author exports and helper manifest.
The preparation manifest's per-file identity fields were checked against
`workflows/nuclei/bundle.go`. These are source observations, not a claim of
published Catalog or Extensions availability.

An isolated author-only check imported that exact Catalog `author.mjs` from Git
and selected each Linux/Windows x64 helper from its exact manifest. For both
platform options it authored preparation, assessment and reconciliation policies,
checked separate `prepare`/`run`/`reconcile` operations, exact helper pins and
bundle digest/length, accepted exit codes, and matching run/daemon/CLI/container/
network reconciliation identities. It also checked refusal of credential-bearing
targets, hosts outside the reviewed allowlist, mutable image tags and invalid
bundle digests. Only author functions ran: no helper, downloader, Docker, target,
provider or credential access occurred. The scratch checker was removed.

`npm run guide`, `npm run guide:check`, the focused Guide build/install tests
(2 passing tests) and `git diff --check` passed on the development render.
Fixture Git commits used a process-only signing override; machine Git settings
were preserved. Full repository validation passed: pinned vendor reproduction
(no vendored diff), all 139 tests, both strict plugin manifests, Guide freshness
and whitespace checks. Authored inputs are committed before final identity
regeneration; the integrated manifest identifies the clean source commit.

No fresh native Guide conversation or model-effectiveness measurement was run for
this added branch. The earlier native table and offline-manual observations above
retain their original scope and identities. Catalog's bounded synthetic HTTP
Linux/Windows findings, zero findings and cancellation/reconciliation evidence
does not establish Guide behavior, a user's Docker setup, TLS, macOS, ARM or WSL
support. The new text preserves Catalog's narrow zero-finding SARIF omission rule,
retained reports, explicit reconciliation, and the limits of cancellation and
bridge networking. No new execution helper or lifecycle owner is delivered here.

## Remaining delivery

The canonical Markdown becomes directly readable from merged public source and
can be saved or pasted without installing anything. Installer users receive a
saved copy; a web link alone does not establish an offline copy for other users.
Core's documentation pointer remains a separately tracked owning-channel task.
[Catalog distribution #64](https://github.com/samartomar/aih-catalog/issues/64)
remains unstarted. The maintainer owns any later Extensions release/marketplace
publication; version 0.6.0 here is the source artifact identity, not proof of
published availability. This does not complete the four-channel rollout.
