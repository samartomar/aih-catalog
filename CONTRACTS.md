# Catalog contracts

This document describes what `@aihq/catalog` 0.1.0 reads, records and returns. The
`/contracts` entry point publishes one JSON Schema (draft 2020-12) per format as `schemas`,
one valid and one invalid document per schema as `fixtures`, and the nine shipped tool
profiles as `toolProfiles`. A schema describes shape. The format's reader is the authority:
it also recomputes digests, checks ordering and uniqueness and resolves references between
fields, so a document can conform to its schema and still read `invalid`.

## Formats

Every document names its format in `schema` with a URN of the form
`urn:aihq:catalog:<name>:0.1.0`. A reader returns `unsupported-version` for another version of
its own format and `invalid` for anything else. There are no aliases for earlier names.

| Format | `schema` | Reader | Accepted bytes |
| --- | --- | --- | --- |
| Source-link result | `urn:aihq:catalog:source-link:0.1.0` | returned by `parseSourceLink` | not read |
| Content | `urn:aihq:catalog:content:0.1.0` | `readContent`, `readContentFile` | strict JSON |
| Tool profile | `urn:aihq:catalog:tool-profile:0.1.0` | `readToolProfile` | strict JSON |
| Recipe | `urn:aihq:catalog:recipe:0.1.0` | `readRecipe(pluginJson, recipeJson)` | strict JSON |
| Qualification | `urn:aihq:catalog:qualification:0.1.0` | `readQualification` | canonical only |

Strict JSON is UTF-8 JSON text without a byte-order mark or duplicate keys, with well-formed
NFC strings and safe integers, in any spelling, so you can write your own content, profiles
and recipes by hand. Canonical bytes are JSON with keys sorted by code unit, two-space
indentation and exactly one final line feed; Catalog writes every document it generates in
that form. A document's identity is the sha256 of its canonical form, whatever spelling it
was read from. A qualification is named by the sha256 of its exact bytes, so it is read only
in canonical form. Plans are results, not a stored format.

### Source-link result

`parseSourceLink(text)` reads pasted text as data and never fetches or runs it. A
`recognised` result carries one candidate: `{ kind: "local", path }`, `{ kind: "git",
repository, ref?, subpath? }` or `{ kind: "npm", package, version? | range? }`. Text that names
no source is `unrecognised` with a reason; text over the published limit is `refused`.
`fetchSource` turns a candidate into a source at an exact commit or version. A local
candidate, or a Git candidate on this machine, is read only when the caller marks it as typed
by the user (`fromUser`). Local, Git and npm sources share one Git metadata rule: a `.git`
path segment in any case is skipped in a local folder and refused in a Git tree or npm
tarball. An npm fetch reads no ambient npm configuration; a private registry is reached only
through an npm config file the caller names (`npmConfig`), whose registries must be https or
loopback http.

### Content

One framework's content: `framework {id, name}`, `sources`, `items`, and optionally `bundles`
and `plugins`.

- **Sources** are `git` (an https repository address such as `https://<host>/<owner>/<repo>`,
  with no credentials, query or fragment; exact commit; optional subpath), `npm` (package and
  exact version), `local` (no machine path is recorded) or `authored` (files Catalog or you
  wrote). Each source lists its `notices` (licence and notice files, with the folder each
  covers) and may restrict them to some items with `noticesFor`.
- **Items** have an `id` of the form `<framework>.<kind>.<path>`, an install `name`
  (kebab-case, at most 64 characters), a `description` (at most 1024 characters), `files`,
  `contentSha256` (over file paths, sha256 and executable bits) and `behaviourSha256` (over
  the files plus the kind's fields, requirements, dependencies, editions and bundle files).
  Items with files carry a `scanKey`: the Git tree id of the item folder, as Scan's
  `scanKeyOf` computes it.
- **Kind fields.** A skill records `userOnly` and `arguments`; a rule its `scope` (`always`,
  `on-request`, `{ paths }` or `{ byDescription: true }`) and optional `language`; an agent its
  `agent` record (`prompt` file, optional `tools`, `model`, `color`, `background`); a hook its
  neutral `event`, optional `matcher` and `handler`; an MCP item its Registry `server`
  (`server.json`) and optional settings (`enabledTools`, `disabledTools`, `startupSeconds`,
  `callSeconds`, non-secret `env`); a document its `purpose`; an AI setup its `aiSetup` record.
- **Optional item facts.** `editions` (per client: the upstream's own files and their scan
  key), `requirements.inputs` (each declared input's description, whether it is required or
  secret, an optional non-secret default and an optional placeholder marker), `dependencies`,
  `references` (plugin-namespaced names such as `ecc:plan` and the files that mention them),
  `bundle` (the runtime bundle the item reads), `pathReferences` (source files the item's text
  names outside its own files), `fetch: "upstream"` (the files may not be redistributed, so a
  plan fetches them from the pinned source) and `supersedes`.
- **Files** are `{ sourceId, sourcePath, sha256, bytes, executable, role }`, with `cli` on a
  file only one client uses (Codex's `agents/openai.yaml`, placed for Codex alone even in a
  folder other clients share) and `derivedFrom { sourcePath, pointer }` on an entry Catalog cut out of a
  shared upstream file (one hook group or one MCP server becomes its own file).
- **Bundles** are root files a framework's items read at run time, chosen by the upstream's
  runtime allowlist: `{ id, sourceId, layout, files, scanKey }`.
- **Plugins** record an upstream plugin folder at the source's pin, so a plugin route can be
  checked and a local-plugin route copied as one unit: `{ sourceId, path, include?, plugin?,
  files, scanKey, folderScanKey? }`. `include` is the upstream's runtime allowlist when only
  part of the folder ships: `scanKey` then keys the allowlisted files a local-plugin route
  copies, and `folderScanKey` keys every file under `path`, which is what a client's own
  plugin install clones and so the key a `plugin` step names.

Content written with `buildContent` is recorded from the bytes, and `checkContent` rebuilds
every recorded fact from the files and reports any difference. Given `scannedKeys`, it also
lists the scan keys that have no matching scan: every item's, every edition's, every
bundle's and both keys of every recorded plugin folder, since one scan never covers another
(upstream-only items are left out for now).

### Tool profile

A profile describes one client: `places` for each kind and scope (`project`, `user`), with
`<name>` templates; how user-only skills are flagged (`userOnly`, or a fallback such as a
prompt file; a skill with a bundle keeps its folder, under the client's `bundleRoot` where it
has one, and its fallback files become one-line launchers; skills without a bundle are
unchanged); how arguments are passed; the agent file format; rule scopes; hook events; the
MCP entry fields and tool restrictions; native input-reference syntax per surface; plugin
installs and their pin behaviour; local-plugin folders and registration; bundle roots; the
configuration files and folders (entries ending in `/`) it reads or loads code from that no
other section names (`configFiles`); the
built-ins the client already provides and how one is switched off; and `checkedWith`, the
client versions and dates the facts were checked against. A kind the client cannot take is
listed in `unsupported` with its reason. A section the client lacks is left out, and a plan
then reports the pair as `unavailable` (`not-described`), never invented. Any change to a
profile's rendered output increases its `version`.

Where the reader takes a client, it takes that client's tool profile. `listItems(content, { kind?, cli? })`
keeps the contract's option name `cli`, and its value is a tool profile as `readToolProfile`
returns it, not a client id.

### Recipe

A recipe is a Git plugin: an Agent Plugins `plugin.json` (name, version, description, author,
licence, keywords) beside a `recipe.json`. A recipe is a `base` or `add-on` for one
framework (an add-on lists the recipes it `requires`) or a `combination` of frameworks. It
records the upstream `content` pin, a `route` per client (clients it does not name use
`items`), the `plugins` and `setup` programs those routes need (a `plugin` route on a client
that installs `<plugin>@<marketplace-name>` from a marketplace it adds, such as Codex, also names the
`marketplaceName` its marketplace declares, which the `plugin` step carries), the kinds each
items route installs (`clis`), `members` and choice `options`, `namePrefix`, built-in `overrides`, AI setup
changes, combination `qualifications` per cell, and the Catalog `data` commit it was written
against. `planRecipe` refuses any other data commit (`data-mismatch`) and content at any other
pin (`content-mismatch`). Every pin (content, setup and data) names an https repository
address, as a Git source does. A `plugin` route's `marketplace` is an https URL or
`owner/repo`; a `local-plugin` route's is the kebab-case name its copied folder declares.

### Qualification

A qualification records one run: its `subject` (an AI setup version on a platform cell, or a
combination recipe on a cell), what it `observed` (the artifact's file or URL, sha256 and
bytes, archive members, the hash-locked wheel closure and the interpreter, or for
a combination the member qualifications) and its `result` (`qualified`, `blocked` with a
reason, or `unknown`, plus the sha256 of the run's own record and the date). A closure holds
wheels only. A dependency built from source when a prebuilt package is unavailable carries
optional `build` provenance: `source` (archive file, HTTPS URL, sha256 and bytes), the exact
build `interpreter`, pinned and hashed build-dependency wheels in `dependencies`, observed
non-Python `tools` (name, version and executable sha256), and `isolated: true`. Empty `tools`
means no non-Python tool was used. Source archives cannot appear directly in the runtime
closure, and build dependencies cannot carry another nested build.

The wheel's own sha256 always identifies the resulting artifact that actually ran. Callers
must supply or acquire those exact wheel bytes, including source-built wheels retained by the
qualification runner; the source URL is provenance, not a claim that PyPI hosts the resulting
wheel. Plans preserve this provenance without executing a build or promising reproducibility
on another interpreter or host. Installed compatible Python is tried first; the qualification's
interpreter is the fallback after a real failure. Records are referenced by sha256 from the AI
setup item; adding one changes no item digest. Synthetic examples establish format behavior
only, never a real qualification.

## Plans

`planInstall(selection, contents, profiles, options)` and `planRecipe(recipe, contents,
profiles, choices, options)` return a plan:

| Field | Holds |
| --- | --- |
| `status` | `ok`, or `incomplete` when anything the choices require is missing, unavailable, clashing or unresolved |
| `recipe` | a recipe plan's origin: id, sha256 of its canonical form, repository and commit |
| `data` | the Catalog data commit the plan used, or `null` for your own content only |
| `profiles` | the id and version of each profile used |
| `plan` | the ordered steps |
| `missing`, `unavailable` | what could not be placed, with reasons |
| `clashes`, `duplicates`, `references`, `warnings` | what the checks found |

Steps never name an absolute path. Each names a root (`project` or `user`), its items or
framework and the clients it serves, so an installer can keep shared files that another
choice still uses.

| Step | What the installer does |
| --- | --- |
| `fetch` | fetches one upstream file at the recorded pin and checks its sha256 |
| `acquire` | acquires a qualified AI setup artifact (and its interpreter or closure) at user scope |
| `write` | writes a file: a copy of the recorded source file, or the bytes `renderStep` gives for its `render` |
| `link` | links a client folder to a shared user-scope version folder; skills whose relative paths reach a sibling skill are copied in place instead, with a `copied-for-references` warning, since a linked folder resolves `..` inside its version folder |
| `merge` | sets one keyed entry in a structured file (JSON, TOML or a Markdown block), keeping the rest |
| `plugin` | installs a native plugin at the recorded commit with the client's own commands. Where a client adds a marketplace at its current head (Claude Code, Copilot CLI), the plan first writes its own marketplace with the plugin pinned by commit and the step names it as `{ root, path }`; a step that can still install another commit says `pin: "unverified"` |
| `upstream-setup` | runs an upstream setup program, only after the user approves it |
| `tool-command` | runs an AI setup's settings command after approval, then its readback. The installer runs the readback first and keeps its output as the prior value; removal runs `restore` with that value in place of `<prior>` and checks the readback shows it again |
| `upstream-installer` | runs an upstream installer the user explicitly chose instead of a managed setup |

Steps that place unscanned bytes say `scanned: false`. Declared inputs are bound to typed
destinations (a file placeholder, an MCP argument, environment variable or header) without
values; a secret never has a value in content or a plan.

### Checks

- **Completeness.** A missing dependency, an unavailable selected item, a clash or a blocking
  path reference makes the plan `incomplete`. Explicitly skipping an optional recipe item does
  not. A recipe forces only the clients it gives a route: on another client (one the upstream
  does not install on) an item the recipe chose, rather than the user, is listed as
  `unavailable` without blocking. An item the user picked always blocks where it is
  unavailable.
- **Built-ins.** A placed name that a client already provides is a `built-in` clash unless a
  recipe override, a prefix, a caller-chosen name or leaving the item out resolves it.
- **Clashes.** Two different placements at one path or key are a clash; the plan drops the
  conflicting steps and lists them. Paths that differ only in case or Unicode form are one path. A merge into a nested key, a write over a merged file or
  a placement under a link, and a file over a client's size limit, are clashes too.
- **Duplicates.** When a plan mixes frameworks, items sharing an install name or a content
  identity are listed as facts, with no winner chosen. The plan places Catalog's authored
  `aih-duplicate-resolver` agent where clients take agents and writes `.aihq/duplicates.json`.
- **References.** A plugin-namespaced name no placed item provides is a warning. A source file
  an item names that no placed bundle or sibling provides is blocking. A name counts as a path
  when it is explicit (`./`, `../`, `${CLAUDE_PLUGIN_ROOT}/`) or, bare, in configuration text;
  in Markdown a bare path counts only as a link target or a code span that does not merely say
  where a file lives, and never in program source. An edition's files are checked for the
  client that takes the edition.
- **Settings a client cannot carry.** An agent's tool list that a client's own agent file
  cannot express (no tool field, or no evidenced native name for a tool) is dropped from that
  client's file, never silently: the plan warns `agent-tools-unrestricted` with the agents.
  MCP tool lists and timeouts a client cannot express warn the same way.
- **Scope.** A route a client cannot honour at the chosen scope falls back to `local-plugin` or
  `items` with a warning; the scope never changes.
- **AI setups.** A selected AI setup needs a platform `cell` and a supplied, matching
  `qualified` record; otherwise it is `unavailable` (`no-qualification` or `not-qualified` with
  the cause). Its MCP item is then `unavailable` (`no-qualification`) for each client too: an
  MCP entry never names a program the plan does not acquire. Neither its launch nor a
  settings command (its own or a recipe's) may start an installer it lists under `doNotRun`,
  and its settings files are written only under `.aihq/ai-setup/<name>/settings/`. A
  `tool-command` carries the `qualification` that ran it; one from a recipe's replacement
  settings carries none.
- **MCP entries.** A package starts only through its registry's runner (`npx` for npm,
  `uvx` for PyPI), `npx` taking only `-y`/`--yes` and `uvx` no runner argument, and its
  identifier follows the registry's package-name grammar. A remote is https unless it runs on
  this machine. No literal in an entry holds `${`, `{env:`, `{file:` or the client's own
  reference syntax, every
  input marker names a declared input, and `env` (an item's, a recipe's or a server input)
  never sets a variable that changes how the runtime loads code, such as `NODE_OPTIONS`,
  `LD_PRELOAD`, `PYTHONPATH`, `PATH` or package-manager configuration. Such an entry is
  `unavailable` (`unsupported-server`) or the content is `invalid`.
- **Bundles.** A bundle's root is a folder of a client's own (the parent of a client's skills
  folder, or its `bundleRoot`), never the project or home root or a shared folder such as
  `.config/` or `.github/`. A bundle file never lands on a file or folder any shipped client
  reads as configuration, at either scope (its MCP file, `configFiles`, settings, shared
  rule file, a `hooks` folder, `.github/workflows/` or a `.git` folder). Otherwise the
  bundle's items are `unavailable` there (`no-bundle-place`).
- **Catalog's own content.** The `aih` framework and source belong to the library: supplied
  content that claims them, or two supplied contents of one framework, are `invalid`.
- **Shared user-only folders.** Clients that flag user-only skills and share one skill folder
  take one combined render with every client's flag. A client with no user-only flag cannot
  share that folder; it is `unavailable` there (`user-only-shared-place`), launchers included.

## Limits

Published in `/contracts` as `limits`. Exceeding one gives `refused` with code `limit` and the
limit's name, never a partial result.

| Limit | Value |
| --- | --- |
| `sourceLinkCharacters` | 2,048 |
| `contentFileBytes` | 64 MiB |
| `sourceFileBytes` | 16 MiB |
| `sourceBytes`, `sourceFiles`, `sourceEntries` | 256 MiB, 65,536 files, 100,000 entries |
| `refusalQuoteCharacters` | 128 |
| `documentDepth` | 64 |
| `toolProfileBytes`, `recipeBytes`, `qualificationBytes` | 1 MiB each |

## Exports beyond the contract

Each entry point exports the functions and data above, plus these additions:

| Entry point | Export | What it is |
| --- | --- | --- |
| `/source` | `isNoticePath`, `noticeCovers` | Whether a source path is a licence or notice file, and the folder it covers |
| `/reader` | `aihContent` | Catalog's own authored content (source `aih`): the duplicate resolver agent a mixing plan adds |
| `/contracts` | `formats` | The five format URNs, by format name |
| `/contracts` | `toolProfiles` | The nine shipped tool profiles, as exact document text for `readToolProfile` |
| `/contracts` | `leftOverReasons` | The reasons `findItems` gives a file it leaves over |
| `/contracts` | `limits.documentDepth`, `limits.toolProfileBytes`, `limits.recipeBytes`, `limits.qualificationBytes` | Limits on the formats Catalog reads, beside the source and content limits |

## What Catalog does not do

Catalog does not install, remove or update anything, resolve real root folders, ask for
approval, run setup programs, hooks or lifecycle scripts, or decide what a user should choose.
It does not scan content: it records scan keys, and Scan computes and stores the scans. A
fixture or test result shows that a plan is right, not that a client loads it or that an AI
setup is qualified.
