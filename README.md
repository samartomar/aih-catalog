# @aihq/catalog

Catalog reads AI content, works out what pieces it holds, checks them and turns a choice into
an exact installation plan for each AI client. Catalog never installs anything and never runs
what it is given: it reads files and text, and an installer carries out the plan after asking
the user for any step that needs approval.

It knows nine clients through its tool profiles: Claude Code, Codex, GitHub Copilot, Kiro,
Antigravity, OpenCode, Cursor, Kimi and dsh.

**Status.** The package carries the temporary prerelease version 0.0.0-dev.1; 0.1.0 is
unreleased. It is not published to npm and refuses publication until a release path is
separately authorized ([RELEASING.md](RELEASING.md)). A passing test shows that Catalog plans
correctly. It does not show that a client loads the result. The content under `data/` is
candidate data, not yet admitted ([data](#data)).

## Terms

- **Source:** where files come from: a local folder, a Git repository or subfolder at an exact
  commit, or an npm package at an exact version.
- **Framework:** one upstream's body of content, such as ECC or Superpowers.
- **Item:** one piece of content with its files: a `skill`, `agent`, `rule`, `hook`, `mcp`
  server, `document` or `ai-setup`. An item id never names a client.
- **Edition:** the upstream's own version of an item for one client. Catalog uses an edition
  where one exists and otherwise renders the item from the client's tool profile.
- **Tool profile:** Catalog's description of one client: where each kind goes, how it is
  written, and which native mechanisms exist.
- **Route:** how a framework reaches a client: `plugin`, `local-plugin`, `setup` or `items`.
- **Recipe:** a one-click choice, shipped as a Git plugin, that pins the Catalog data it was
  written against.
- **Plan:** the steps an installation would take, plus what the checks found: clashes,
  duplicates, missing dependencies, references and warnings.
- **AI setup and qualification:** a tool Catalog pins per platform cell (such as
  codebase-memory-mcp), and the exact bytes a qualification run saw for it with the run's
  result.

## Entry points

The package exports exactly five entry points. Nothing else can be imported.

| Entry point | Runs in | Gives |
| --- | --- | --- |
| `@aihq/catalog/source` | browser or Node | `parseSourceLink(text)`, `findItems(files, { framework })` |
| `@aihq/catalog/node` | Node | `readLocalSource(path)`, `fetchSource(candidate, { outDir, fromUser?, registry?, npmConfig?, integrity? })`, `readContentFile(path)` |
| `@aihq/catalog/producer` | Node | `buildContent(source, files, items, { framework })`, `checkContent(content, files?, { scannedKeys? })` |
| `@aihq/catalog/reader` | browser or Node | `readContent`, `readToolProfile`, `readRecipe`, `readQualification`, `listItems`, `getItem`, `derive`, `availability`, `planInstall`, `planRecipe`, `renderStep` |
| `@aihq/catalog/contracts` | browser or Node | format identities, `schemas`, `fixtures`, `toolProfiles`, `kinds`, `limits`, refusal codes |

Functions that take outside input never throw on bad input. They return a result with a
`status`: `ok`, `invalid` with `problems`, `refused` with a `code` and `reason`, or
`unsupported-version`. A plan can also be `incomplete`, and then it lists why.
`parseSourceLink` returns `recognised`, `unrecognised` or `refused`. `listItems`, `derive` and
`availability` work on content already read and return plain values. The same input always
gives the same plan, byte for byte.

[CONTRACTS.md](CONTRACTS.md) describes the formats, plan steps and checks.

## Plan an installation from your own folder

```js
import { readFileSync } from "node:fs";
import { toolProfiles } from "@aihq/catalog/contracts";
import { readLocalSource } from "@aihq/catalog/node";
import { buildContent } from "@aihq/catalog/producer";
import { planInstall, readToolProfile, renderStep } from "@aihq/catalog/reader";
import { findItems } from "@aihq/catalog/source";

const read = readLocalSource("./my-skills");              // files, sha256, modes; links not followed
const found = findItems(read.files, { framework: "my-skills" }); // items plus what was left over
const built = await buildContent(read.source, read.files, found.items, { framework: "my-skills" });

const encode = (text) => new TextEncoder().encode(text);
const profiles = ["claude-code", "kiro", "antigravity"].map(
  (id) => readToolProfile(encode(toolProfiles[id])).profile,
);
const plan = planInstall(
  found.items.map((item) => item.id),
  [built.content],
  profiles,
  { scope: "project", data: null },
);
// plan.status is "ok" or "incomplete"; plan.plan lists write, link, merge and other steps,
// each naming its root ("project" or "user"), path, items and clients.
```

A `write` step that carries a `render` gets its bytes from `renderStep(step, contents,
profiles, files)`, so an installer never implements a render itself. A copied step names the
source file and sha256 to copy. Steps the installer must not take without the user's approval,
such as an upstream setup program or a tool command, say `approval: "required"`.

Sources other than a local folder start from text a user pastes: `parseSourceLink` reads a
folder path, a Git URL (with an optional branch, tag or subfolder), an npm specifier or a
known installer command, without fetching or running it. `fetchSource` then pins it to an
exact commit or version and reads it with Git hooks, checkout and lifecycle scripts disabled.

`fetchSource` runs `git` and `npm` from absolute `PATH` entries and never through a shell
(on Windows, npm's own script runs with node). Git runs without credential helpers,
password prompts or interactive SSH; a repository address carrying a password, or a user
other than on SSH, is refused. npm reads only the given registry (https, or plain http on a
loopback address; the public registry by default) and no global, project or environment
configuration. To use your own private registry, pass `npmConfig`: the path of an npm config
file you chose, holding its token. It is the only user configuration npm reads, every
registry it names must follow the same https rule, and its contents never appear in results
or refusals. Pass `integrity` to require a known tarball. A local folder, local Git path or `file:` URL is
read only with `fromUser: true`, for a source the user typed. Each fetch works in a new
folder inside `outDir`, removed afterwards, and is stopped after 10 minutes or once that
folder holds four times `sourceBytes`; `timeoutMs` and `diskBytes` may only lower these.
Refusals do not repeat local paths, the `outDir` or Git and npm output.

## Recipes and maintained content

Maintained frameworks are Catalog data, read from this repository's `data/` folder at a
pinned commit with `fetchSource` and checked against every recorded sha256. A recipe is a
separate Git plugin: its `plugin.json` plus a `recipe.json` naming its routes,
members, choice groups and the data commit it was written against. `readRecipe` reads it, and
`planRecipe` plans it through each client's route and records the recipe's exact origin.

## Data

`data/<framework>/content.json` holds the content of ECC, Superpowers, Extensions,
project-basics, Anthropic's skills, web-artifacts, the AIH guide, pstack, gstack, the
Elephant-Goldfish Model, code-review-graph, codebase-memory-mcp and Serena.
`data/qualifications/` holds the qualification records by sha256. A data change is a commit,
never a package release. All of this data is a candidate: none of its scan keys has been
scanned and admitted yet. [The port report](port-report/report.json) gives each earlier
Catalog item one disposition and lists the known limits.

## Install

Catalog needs Node `>=26.12.1 <27`. Its one runtime dependency besides `yaml` is
`@aihq/scan@0.0.0-dev.1`, which is not on the npm registry yet. Until it is, install the Scan
tarball kept in this repository (`vendor/aihq-scan-0.0.0-dev.1.tgz`, sha256
`4f1368c9b89d4055d71f6dc788d0838300f80e39603273cfd663ce1d7ff508c0`) together with a Catalog
tarball you built:

```sh
npm install --ignore-scripts ./aihq-scan-0.0.0-dev.1.tgz ./aihq-catalog-0.0.0-dev.1.tgz
```

Catalog uses only `scanKeyOf` from `@aihq/scan/contracts`, so content scan keys and Scan's
own keys are the same Git tree hash.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). [VERSIONING.md](VERSIONING.md) describes how changes
are classified and [docs/TRANSITION.md](docs/TRANSITION.md) records what replaced the earlier
release model.

## Licence

Apache-2.0. Content under `data/` keeps its upstream licences; each framework's notices are
recorded with its sources and copied with any item a plan installs.
