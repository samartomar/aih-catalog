# Catalog contracts

This document describes what `@aihq/catalog` 0.1.0 reads, records and returns. The
`/contracts` entry point publishes one JSON Schema (draft 2020-12) per format as `schemas`,
one valid and one invalid document per schema as `fixtures`, and the nine shipped tool
profiles as `toolProfiles`. A schema describes shape. The format's reader is the authority:
it also recomputes digests, checks ordering and uniqueness, resolves references between
fields and requires canonical bytes, so a document can conform to its schema and still read
`invalid`.

## Formats

Every document names its format in `schema` with a URN of the form
`urn:aihq:catalog:<name>:0.1.0`. A reader returns `unsupported-version` for another version of
its own format and `invalid` for anything else. There are no aliases for earlier names.

| Format | `schema` | Reader | Canonical bytes |
| --- | --- | --- | --- |
| Source-link result | `urn:aihq:catalog:source-link:0.1.0` | returned by `parseSourceLink` | no |
| Content | `urn:aihq:catalog:content:0.1.0` | `readContent`, `readContentFile` | yes |
| Tool profile | `urn:aihq:catalog:tool-profile:0.1.0` | `readToolProfile` | yes |
| Recipe | `urn:aihq:catalog:recipe:0.1.0` | `readRecipe(pluginJson, recipeJson)` | yes |
| Qualification | `urn:aihq:catalog:qualification:0.1.0` | `readQualification` | yes |

Canonical bytes are JSON with keys sorted by code unit, two-space indentation and exactly
one final line feed. A document's identity is the sha256 of those bytes. Plans are results,
not a stored format.

### Source-link result

`parseSourceLink(text)` reads pasted text as data and never fetches or runs it. A
`recognised` result carries one candidate: `{ kind: "local", path }`, `{ kind: "git",
repository, ref?, subpath? }` or `{ kind: "npm", package, version? | range? }`. Text that names
no source is `unrecognised` with a reason; text over the published limit is `refused`.
`fetchSource` turns a candidate into a source at an exact commit or version.

### Content

One framework's content: `framework {id, name}`, `sources`, `items`, and optionally `bundles`
and `plugins`.

- **Sources** are `git` (repository and exact commit, optional subpath), `npm` (package and
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
- **Files** are `{ sourceId, sourcePath, sha256, bytes, executable, role }`, with `cli` on an
  edition-only file and `derivedFrom { sourcePath, pointer }` on an entry Catalog cut out of a
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
prompt file); how arguments are passed; the agent file format; rule scopes; hook events; the
MCP entry fields and tool restrictions; native input-reference syntax per surface; plugin
installs and their pin behaviour; local-plugin folders and registration; bundle roots; the
built-ins the client already provides and how one is switched off; and `checkedWith`, the
client versions and dates the facts were checked against. A kind the client cannot take is
listed in `unsupported` with its reason. A section the client lacks is left out, and a plan
then reports the pair as `unavailable` (`not-described`), never invented. Any change to a
profile's rendered output increases its `version`.

### Recipe

A recipe is a Git plugin: an Agent Plugins `plugin.json` (name, version, description, author,
licence, keywords) beside a canonical `recipe.json`. A recipe is a `base` or `add-on` for one
framework (an add-on lists the recipes it `requires`) or a `combination` of frameworks. It
records the upstream `content` pin, a `route` per client (clients it does not name use
`items`), the `plugins` and `setup` programs those routes need, the kinds each items route
installs (`clis`), `members` and choice `options`, `namePrefix`, built-in `overrides`, AI setup
changes, combination `qualifications` per cell, and the Catalog `data` commit it was written
against. `planRecipe` refuses any other data commit (`data-mismatch`) and content at any other
pin (`content-mismatch`).

### Qualification

A qualification records one run: its `subject` (an AI setup version on a platform cell, or a
combination recipe on a cell), what it `observed` (the artifact's file or URL, sha256 and
bytes, archive members, the hash-locked binary-only wheel closure and the interpreter, or for
a combination the member qualifications) and its `result` (`qualified`, `blocked` with a
reason, or `unknown`, plus the sha256 of the run's own record and the date). A closure holds
wheels only. Records are referenced by sha256 from the AI setup item; adding one changes no
item digest.

## Plans

`planInstall(selection, contents, profiles, options)` and `planRecipe(recipe, contents,
profiles, choices, options)` return a plan:

| Field | Holds |
| --- | --- |
| `status` | `ok`, or `incomplete` when anything the choices require is missing, unavailable, clashing or unresolved |
| `recipe` | a recipe plan's origin: id, sha256 of its canonical bytes, repository and commit |
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
| `link` | links a client folder to a shared user-scope version folder |
| `merge` | sets one keyed entry in a structured file (JSON, TOML or a Markdown block), keeping the rest |
| `plugin` | installs a native plugin at the recorded commit with the client's own commands |
| `upstream-setup` | runs an upstream setup program, only after the user approves it |
| `tool-command` | runs an AI setup's settings command after approval, then its readback |
| `upstream-installer` | runs an upstream installer the user explicitly chose instead of a managed setup |

Steps that place unscanned bytes say `scanned: false`. Declared inputs are bound to typed
destinations (a file placeholder, an MCP argument, environment variable or header) without
values; a secret never has a value in content or a plan.

### Checks

- **Completeness.** A missing dependency, an unavailable selected item, a clash or a blocking
  path reference makes the plan `incomplete`. Explicitly skipping an optional recipe item does
  not.
- **Built-ins.** A placed name that a client already provides is a `built-in` clash unless a
  recipe override, a prefix, a caller-chosen name or leaving the item out resolves it.
- **Clashes.** Two different placements at one path or key are a clash; the plan drops the
  conflicting steps and lists them. A merge into a nested key, a write over a merged file or
  a placement under a link, and a file over a client's size limit, are clashes too.
- **Duplicates.** When a plan mixes frameworks, items sharing an install name or a content
  identity are listed as facts, with no winner chosen. The plan places Catalog's authored
  `aih-duplicate-resolver` agent where clients take agents and writes `.aihq/duplicates.json`.
- **References.** A plugin-namespaced name no placed item provides is a warning. A source file
  an item names that no placed bundle or sibling provides is blocking.
- **Scope.** A route a client cannot honour at the chosen scope falls back to `local-plugin` or
  `items` with a warning; the scope never changes.
- **AI setups.** A selected AI setup needs a platform `cell` and a supplied, matching
  `qualified` record; otherwise it is `unavailable` (`no-qualification` or `not-qualified` with
  the cause).

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
