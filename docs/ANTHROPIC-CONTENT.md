# Pinned Anthropic skills

Permitted skill projections derive authored source facts through the shared
`agent-skills` profile; declarations contain no copied replacement purpose.
Profile diagnostics remain visible: the pinned `claude-api` description exceeds
the standard's 1,024-character bound, so its description is invalid and the
compact purpose stays empty. Its original source bytes remain available through
the normal material route. This does not rewrite source to claim conformance.
Runtime requirements stay in capabilities, activation and recipes. Supplemental
notices and the local testing template are explicit Catalog-owned delivery
overlays. The [public refresh route](PUBLIC-AUTHORING.md) preserves supplemental
notice pins and admission/rights limits; discovering restricted source never
admits its bytes. Reviewed newly required sibling support needs explicit closure
and recipe changes before staging.

`@aihq/catalog/release-anthropic.json` is an optional, unpublished local 0.1.0
release over `anthropics/skills@34040c9c568585f6929bedeaad110ad08f079624`.
Identify local builds by source commit and archive SHA-256, never version alone.
[Inventory](ANTHROPIC-INVENTORY.md) accounts for the complete 419-file Git tree,
all 19 donor skills and their 414-file union (413 skill files plus README).

## Distribution and ordinary material

14 skills have explicit Apache-2.0 item licenses. Their complete unchanged
subdirectories, including scripts, references, templates and assets, are carried.
Every recipe installs the item's own LICENSE.txt and THIRD_PARTY_NOTICES.md.
Canvas fonts retain adjacent OFL notices and embedded copyright/license name
records. IBM Plex Serif and Instrument Serif lack adjacent notice files: their
unchanged font name records carry specific copyrights and OFL declarations; the
full OFL text is included in THIRD_PARTY_NOTICES.md. The inventory records those
embedded notices and license paths per font. No font is renamed or sold separately.
Source metadata identifies the permitted skill source as Apache-2.0; it does not
relicense third-party fonts or external packages. The source license comes from
academy-guide/LICENSE.txt, which supplies a shared Apache notice without replacing any item-specific
license bytes, and is additionally delivered as SOURCE-LICENSE.txt where needed.
Root notices list external packages too; a notice is not a bundled executable.
The bundled shadcn-components.tar.gz lacks its MIT notice. Required per-client
`anthropic[.kiro|.copilot].notice.shadcn` items deliver the exact supplemental
shadcn-ui/ui LICENSE.md alongside web-artifacts-builder as SHADCN-LICENSE.md.
The distinct source pin and byte-matched component association are recorded in
inventory.supplementalNotices; the raw Anthropic archive remains unchanged.

The four document skills docx, pdf, pptx and xlsx have restrictive item notices:
[exact notice](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/docx/LICENSE.txt).
They forbid copying outside Anthropic Services, reproduction beyond authorized
temporary copies and distribution. Public Git visibility and README instructions
do not override those terms. Catalog ships their paths, identities and requirement
facts only; it ships no restricted source, executable recipe or local BYO-copy
workaround. Anthropic owns rights clarification; Catalog owns a future reviewed
declaration if permission changes. doc-coauthoring has no item license and remains
unsupported pending explicit permission. Existing historical donors are preserved
as review-only source and excluded from this package.

Permitted item prefixes project complete Agent Skills material into these layouts:

| Prefix | Destination | Client |
| --- | --- | --- |
| anthropic.skill.* | .claude/skills/<name>/ | Claude Code CLI |
| anthropic.kiro.skill.* | .kiro/skills/<name>/ | Kiro IDE |
| anthropic.copilot.skill.* | .github/skills/<name>/ | Copilot in VS Code |

These are ordinary material projections, consistent with
[Claude skills](https://code.claude.com/docs/en/skills),
[Kiro skills](https://kiro.dev/docs/skills/) and
[VS Code skills](https://code.visualstudio.com/docs/agent-customization/agent-skills).
Client loading, tool availability, execution and equivalent model behavior remain
unknown until observed. Open the project and explicitly select/read a skill.
Upstream Unix examples use /tmp and open; Windows callers must supply writable
temporary paths and their own browser opener. Literal Unix examples are preserved
as source, not a Windows path/launcher guarantee.
Invoke scripts through their interpreters; file material does not install a
runtime or preserve an executable bit on every platform. No home settings,
plugin install, model call or hook activation occurs during material Apply.

`anthropic.skill.mcp-builder` is a **skill**, not an MCP registration or service.
Evaluation helpers need operator-selected endpoints, transports and credentials;
test servers remain test-scope. No upstream production server is supplied.
The root marketplace manifest, README, spec pointer, template and ignore file have
explicit unsupported installation dispositions. A plugin registration is not
inferred from their presence. Empty conflicts mean no declared conflict edge.

## Tools and document limits

[Inventory itemFacts](../producer/anthropic/inventory.json) records permitted
skills' runtime, acquisition and host-owned environment prerequisites. The
representative bounded smoke runs `scripts/with_server.py --help` from the complete
installed webapp-testing closure using Python >=3.9, with no server or browser.
This checks a real script/interpreter path; it does not prove browser automation.
MCP evaluation uses scripts/evaluation.py and scripts/connections.py with
Python >=3.10, mcp>=1.1.0 and anthropic>=0.39.0. Skill-creator evaluation needs
Python >=3.10, Claude CLI and POSIX-compatible subprocess-pipe select semantics;
native Windows evaluation is unsupported without a suitable environment/port.
Its eval-viewer/generate_review.py starts a local server and opens a browser by
default; --static writes HTML without serving it. These tools remain unexecuted.

Actual web testing needs a compatible Python Playwright package, separately
acquired browser binaries and an approved local application/command. Python's
executable location is host-owned; Windows may use `py -3` or an identified Python
executable instead of a PATH `python3`. Catalog does not invent that path.

Restricted document requirements below are **inspection facts, not executable
support**. Upstream assumes preinstalled tools; Catalog makes no such assumption.
No exact package versions are pinned by these skills: acquire compatible versions
in a separately authorized environment and record resolved versions there.
Python 3.10+ is a conservative compatible baseline for office helpers' typing;
Node packages require a runtime compatible with their acquired package engines.

| Skill | Actual paths and closures | Runtime/packages/tools |
| --- | --- | --- |
| docx | scripts/comment.py, merge_runs.py, accept_changes.py; scripts/office/validate.py, soffice.py, helpers/, validators/ and schemas | Python 3.10+, defusedxml, lxml; Node with npm docx; pandoc; LibreOffice soffice; Poppler pdftoppm for rendering. Caller-owned document/temporary output paths. |
| pdf | scripts/check_fillable_fields.py, extract_form_field_info.py, fill_fillable_fields.py and sibling form/render helpers; FORMS.md and references | Python 3 with pypdf, pdfplumber, reportlab; Pillow/pdf2image for images with Poppler tools on PATH; pytesseract plus Tesseract for chosen OCR. Caller owns input/output and tool paths. |
| pptx | scripts/thumbnail.py, add_slide.py, clean.py; scripts/office/ helpers/validators/schemas and soffice.py | Python 3.10+, Pillow, defusedxml, lxml; LibreOffice/Poppler for thumbnails; markitdown; Node pptxgenjs, optional react-icons/react/react-dom/sharp for selected icon path. Caller owns deck/template paths. |
| xlsx | scripts/recalc.py; scripts/office/soffice.py and full office helper/validator/schema closure | Python 3.10+, openpyxl, pandas, markitdown; LibreOffice soffice, platform-dependent timeout behavior. recalc rewrites the supplied workbook; no external-link/future-function compatibility guarantee. Caller owns workbook and writable temporary/profile paths. |

These paths cannot be supplied locally under the selected notices. A SKILL.md-only
recipe would omit mandatory helpers and does not meet execution support. There is
no new installer, rights authorization transport or item-specific Core/UI engine.
The unsupported dispositions preserve the Anthropic framework through the 14
permitted skills; real document/native use requires separately resolved rights and
runtime ownership and remains outside this content ticket.

## Public consumer and expansion

```js
import { readInstalledRelease } from '@aihq/catalog/node';
import { configureItem, resolveSelections } from '@aihq/catalog/reader';
const installed = await readInstalledRelease({root, release:'./release-anthropic.json'});
if (!installed.valid) throw new Error(JSON.stringify(installed.diagnostics));
const resolved = resolveSelections({
  releases: {[installed.release.sha256]: installed.release},
  roots: [{releaseSha256:installed.release.sha256,
    itemId:'anthropic.template.local-web-testing',scope:'project',configuration:{}}],
  skips: [{releaseSha256:installed.release.sha256,
    itemId:'anthropic.skill.mcp-builder',scope:'project'}],
});
// Check status, validate final selections and configure each item with installed.source.
// Hand installed.materialRoots and configured recipes to generic Core Prepare/Apply.
```

The template is a labelled Catalog starting choice requiring webapp-testing and
optionally suggesting MCP authoring. Required skips refuse; optional skips persist
in resolver explanations. Declarations mirror recipe configuration exactly (empty
here); no host tool path or credentials are serialized. Source acquisition remains
caller-owned. Missing, changed or tampered material is refused.

`node tools/generate-anthropic-release.mjs [--check]` owns generation and checks
original commit/tree objects, raw blob identities, donor mapping, notices and v3
compilation. No upstream execution or fetch happens there.
`node tools/verify-anthropic-consumer.mjs --without-core` checks a packed outside
public-only compiler/reader/configuration/resolution and compatible data expansion.
Supply an exact reviewed Core archive to prove representative complete material
Prepare/Apply and a bounded harmless interpreter/script smoke. The final archive
can be passed as the second argument; `--evidence <directory>` retains identities.
Whole-package integrity and candidate refresh carry this release and all previous
releases. Native client/model/tool use and formal admission remain unexecuted.
Publication remains blocked; future changed published bytes need a new package
version owned by the release coordinator.

## Modern standalone artifact adaptation

Select `catalog.skill.web-artifacts-builder`, `catalog.kiro.skill.web-artifacts-builder`
or `catalog.copilot.skill.web-artifacts-builder` from `@aihq/catalog/release-web-artifacts.json`.
These install **web-artifacts-builder-modern** alongside the preserved upstream
skill. The source is explicitly Catalog-authored (`catalog-artifacts`, local
snapshot SHA-256); it is not attributed as unchanged Anthropic code. The new
Apache-2.0 notice and SKILL.md identify its inspiration. The original snapshot,
upstream recipes, component archive and supplemental shadcn notice are unchanged.

`node artifact.mjs init <new-project>` copies a minimal frozen React project;
`--components` selects the separate frozen lucide/CVA/clsx/tailwind-merge closure.
Neither command acquires software. Use exact **Node 26.12.1** and project-local
**pnpm 12.15.0**, verifying both the wrapper and platform-specific native binary.
No global pnpm, Corepack enablement, floating create-vite or ecosystem installer
is used. The default template has no optional component libraries. Runtime
range is >=26.12.1 <27. Package-manager identity, transitive integrity and peers
are recorded in the delivered manifest and pnpm lock. Dependency install uses
`--frozen-lockfile --ignore-scripts` and a caller-owned local store. Keep caches
and runtime locks local too; XDG_RUNTIME_DIR must be writable on sandboxed Linux.

The exact stack is Vite 8.3.5, React/react-dom 19.3.1, TypeScript 7.0.2,
@vitejs/plugin-react 6.1.2, Tailwind/@tailwindcss/vite 4.3.3 and React types
19.3.0. Tailwind 4's CSS import and source directive replace old v3 config.
Optional APIs are lucide-react 1.61.0 named icons, class-variance-authority 0.7.1,
clsx 2.1.1 and tailwind-merge 3.7.0. Other component APIs remain unqualified.

`pnpm run build` typechecks and uses Vite's in-memory single-entry output,
inlining emitted JS/CSS into `dist/artifact.html` and source-imported assets as
data URLs. Extra emitted chunks/assets refuse. Output refuses overwrite; move
or remove the prior artifact explicitly before rebuilding. This route replaces
Parcel only in the new authored adaptation. The upstream Parcel material stays
readable. Build trusted local code only; arbitrary plugins/scripts execute code.
Application-authored remote URLs/fetches still require a real offline browser
check; bundle success alone cannot certify offline behavior.

`node tools/verify-web-artifacts-consumer.mjs --without-core` checks packed
public configuration/resolution, all three material layouts, scaffold selection,
existing-project refusal and changed-material refusal without downloading tools.
Supply an exact Core tarball instead of `--without-core` for public Prepare/review/
Apply. Explicit `AIH_ARTIFACT_NODE`, `AIH_ARTIFACT_PNPM`, `AIH_ARTIFACT_STORE` and
`AIH_ARTIFACT_PLAYWRIGHT` select the separately acquired isolated build/browser
fixture. The consumer repeats frozen acquisition offline, builds representative
optional APIs and a local SVG, checks computed Tailwind styles and interaction,
and rejects any attempted network request while the browser is offline. Its
receipt names the archive/release/lock/HTML identities and actual browser. The
browser fixture is Playwright 1.64.1's explicitly managed Chromium 156.0.8078.4
(revision 1248), separate from the Chrome 156.0.8078.47 candidate. It grants no
native client, OS-wide or production admission. Set PLAYWRIGHT_BROWSERS_PATH to
the isolated fixture directory; normal npm tests never acquire a browser.

Linux x64 is the bounded local fixture target. Linux arm64, darwin x64/arm64 and
win32 x64/arm64 remain **unverified** for build/browser/native loading; lock
entries for platform packages are acquisition facts, not platform qualification.
Publication remains blocked and 0.1.0 remains unreleased/not-ready.
