# Executable content requirements

The optional `@aihq/catalog/release-executable-content.json` release supplies a
Catalog-authored companion for Claude, Kiro IDE and Copilot VS Code. Existing
Anthropic, ECC, Superpowers, Matt and Extensions material remains byte-identical.
The companion uses ordinary producer declaration 3.1 and Core recipe 1.0 file
operations. Apply delivers bytes only; it installs no runtimes or dependencies.

Read `producer/executable-content/source/SKILL.md` for commands. Each original
member of the preserved 113-asset executable inventory has a path, size, SHA-256,
workflow and requirements in `requirements.json`. This is the fixed inventory
at introduction, not a promise that future upstream refreshes contain 113 files.
The release generator verifies those original bytes before compiling the new
companion. Per-workflow client capabilities remain `unknown`; selecting this
companion does not replace an upstream skill or make its execution ready.

Python evaluator MCP 2.3.0, skill authoring, EvalView and PyYAML paths use isolated
3.14.10 environments. Image/browser/document workflows select 3.15.2. Optional
workflows keep separate closures. Exact Python package artifact identities are
recorded from official version-specific PyPI metadata; those hashes are metadata
claims, not downloaded-wheel or interpreter verification. Hash-bearing Linux x64
resolution files are separate from the original version-only projections.
`lock-status.json` records the Manim resolution failure rather than substituting
a compiler or changing the selected version. All six OS/architecture cells retain
explicit blockers. WSL2 does not count as native Windows.

The authored fixtures cover MCP result data and the verified delivered evaluator
XML parser without a backend call, the delivered skill validator's success and
refusal plus eval-viewer discovery, EvalView import, two-frame GIF, a one-slide PPTX and separate
ReportLab PDF, and one real loopback page through Playwright-managed Chromium.
The browser fixture closes its server/browser in `finally`; Windows process-tree
cleanup remains unqualified and is refused. Exact interpreter versions, virtual
environments and every resolved dependency version are checked before outputs.
Absent/incorrect runtimes and existing outputs refuse. Failures preserve their
new output directory for diagnosis. No fixture claims upstream behavior parity.

The browser metadata binds Playwright 1.64.1's browser revisions and separately
records Chrome for Testing 156.0.8078.47. Neither route has been activated here.
Package wheels alone do not include browser/OS-library readiness. Windows arm64
Chrome for Testing remains blocked. Remotion 4.0.539 has its own exact npm lock
and two-frame source fixture; native browser/font/render proof and FFmpeg 9.0.2
distributor/codec provenance remain required before encoded media claims.

Swift 6.4.1/AppKit, Graphviz 16.1, WezTerm stable
20240203-110809-5046fc22 and optional wizard gh 2.103.3 remain explicit optional
requirements. Shell utility capabilities come from actual OS-package observations,
not a blanket pinned host-tool bundle. `argv` emits a dry-run version-probe plan
with shell execution disabled and a deadline. It never launches terminals,
observers, guardians or visual companions. Display, PowerShell/pwsh and native
lifetime qualification remain separate. Text output is the unavailable-display
fallback; observer heuristics never establish safe inactivity.

## Verification and remaining gates

Run `node tools/generate-executable-content-release.mjs --check` after building.
The active `tests/release/executable-content-packed.test.ts` packs exact bytes,
uses public readers/configuration/selection, checks all 113 dispositions, absent
runtime refusal, dry-run argv and tamper refusal. The outside consumer accepts an
exact Core archive for Prepare/review/Apply and absent-approval refusal:

```
node tools/verify-executable-content-consumer.mjs <core.tgz> [catalog.tgz] --evidence <new-directory>
```

`--without-core` checks byte extraction only. Explicit
`AIH_EXECUTABLE_<WORKFLOW>_PYTHON` variables (uppercase, hyphens changed to
underscores) enable separately acquired exact fixture environments. Ordinary
tests never acquire interpreters, install browsers or make paid requests.

Pending acceptance includes actual exact interpreter artifacts and installed
closures; executed Python/browser/image/document/media outputs and hashes;
unavailable dependency and process lifetime proofs; native OS/font/codec/terminal
cells; and client loading. Source/fixture preparation, merge and publication are
different outcomes. Catalog #177 must remain open while these gates are unmet.
Product 0.1.0 is unreleased/not-ready, publication remains blocked, and hosted CI
is owner-paused. No schemas, package-support declarations or exported contract
fixtures change. The public release inventory gains one content entry; exact-head
X1 evidence is retained for that additive registry change before integration.
