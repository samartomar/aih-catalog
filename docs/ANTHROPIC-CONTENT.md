# Pinned Anthropic skills

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
