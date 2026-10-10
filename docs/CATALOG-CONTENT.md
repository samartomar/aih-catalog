# Catalog content release interface

Catalog content describes selectable work. Consumers deliberately select an exact release and item, supply ordinary configuration, validate their whole selected set, then hand Core a generic recipe reference. Catalog reading and configuration grant no execution approval or organization authority.

## Public entries

`@aihq/catalog/contracts` declares support and public data types. `@aihq/catalog/reader` reads supplied bytes and validates choices without filesystem or network access. `@aihq/catalog/node` reads explicit installed roots and resolves reviewed archives or exact registry versions without installing packages, executing lifecycle scripts or importing package code. Its `prepareProjectContext` writes the shared project context for a chosen instruction directory as a derived release in caller-owned staging output ([context content](CONTEXT-CONTENT.md#instruction-directory)). `@aihq/catalog/release.json` is the release inventory; its structural schema is `@aihq/catalog/schemas/release/1.0.0.json`. `@aihq/catalog/release-1.1.json` is the separate release of Core recipe 1.1 items ([client hook items](#client-hook-items-release-11)).

The canonical release document uses format `urn:aihq:catalog:release:1.0.0`, strict UTF-8 JSON, one LF terminator, a 16 MiB ceiling including that terminator, and a 32-level depth ceiling. It contains exact package identity, pinned upstream source provenance and sorted unique item records. Its own identity is the SHA-256 of its exact bytes. An item identity hashes its canonical record without the LF. A recipe identity binds exact recipe bytes and named material identities; moving the acquisition locator or changing unrelated items does not change those bytes.

Descriptors use lowercase bare SHA-256 and safe byte lengths. Material paths are canonical package-relative POSIX paths. Archive references use the fixed `package/` prefix; local roots remain package-relative. Symlinks, traversal, duplicate/ambiguous members, hash/length mismatch and unsupported formats are refused.

## Selection and configuration

Use `readRelease(bytes,{expectedSha256})` with a caller-held integrity pin, then `listItems` or `getItem`. `configureItem` accepts an already resolved shared material source and ordinary values. Its result contains a generic Core recipe reference, configuration, descriptive provenance and the item's dependency declarations. It neither acquires material nor binds operation effects.

Input definitions use Core's scalar string/boolean/integer/number grammar. Omitted values stay omitted in authored configuration, allowing Core to distinguish a default from an explicit value. Unknown names, wrong types, invalid constraints and unsupported input forms produce diagnostics. Sensitive values cannot appear in portable defaults/configuration and must be supplied through Core's host `controls.privateInputs`.

Call `validateSelectionSet({releases,selections})` with exact validated release views, selected item identities, configuration and caller-assigned policy selection IDs. Explicitly select required items and supply their configuration. On success, copy `requiresBySelectionId` arrays into policy `requires`. Missing, ambiguous, cyclic or conflicting choices are diagnosed; optional suggestions remain unselected. Core enforces the policy relationships it receives. A caller that omits Catalog declarations cannot claim that Core authenticated or enforced the omitted Catalog rules.

## Executing selected material

For a local source, bind the chosen name through host `controls.materialRoots`; do not serialize an actual path/handle into a portable policy. For an archive, retain the exact source SHA-256 and byte length returned by acquisition. Build an ordinary execution policy with explicit selection ID, stable management ID, scope and dependency mapping. Prepare on the selected host, review the concrete effects and apply only with approval matching the returned review digest.

Plain content reading and execution require no qualification receipt, Scan, Workbench enrollment or promotion. Integrity checks establish the offered byte identities; neither self-described provenance nor a URL authenticates the publisher. Assessment-shaped donor metadata is transformed into ordinary source/material provenance in the carried item and is not a runtime admission gate.

The consumer verification command accepts an explicit reviewed Core tarball, packs the current Catalog bytes and installs those exact two artifacts with scripts disabled in a disposable root. It exercises public portable/host entries and Core's public prepare/apply handoff. It chooses no moving registry release and makes no publication claim.

The Node adapter admits strict recipe JSON within Core's byte/depth limits, rejects
duplicate decoded keys and validates structure against a pinned copy of Core's
recipe schema. It compares every item's advertised inputs and material closure,
including items sharing recipe bytes. Core retains authoritative execution semantics
at Prepare. Ordinary configuration follows the same strict scalar profile, and
dependency mapping emits unique policy selection IDs.

Publication remains blocked until the remaining producer and release completion criteria are met. The maintainer owns candidate allocation and release activation; this interface delivery does not allocate a new per-ticket version or run signing/publication.

## Carried content

The 27 Matt Pocock skills carry complete executable recipes with pinned upstream material and 23 declared support files. Mandatory composition has explicit required selections; see [the refresh record](MATTPOCOCK-REFRESH.md). The `aihq.project-context` family carries the shared project AI context (`ai-coding/` router, shared canonical block and behavior core), seven native client entry pointers and eleven per-client adapter notes as ordinary selectable items with explicit `requires` dependencies — see [the context content contract](CONTEXT-CONTENT.md) for the item model, deselection/preservation semantics, the delivery-versus-loading boundary and the donor migration mapping.

## Client hook items (release 1.1)

A client hook registers one group inside a shared client settings array, such as Claude Code's `hooks.PreToolUse`, next to groups the user or other tools own. Core's generic `hook.group` operation (Core recipe `urn:aihq:core:recipe:1.1.0`, execution policy `urn:aihq:core:execution-policy:1.1.0`) adds, updates and removes only that group. Catalog delivers the client-specific parts as ordinary content: the settings path, event, matcher, handler, a separately owned wrapper script and the selector that locates the group.

Hook items live in a separate release, `@aihq/catalog/release-1.1.json` (format `urn:aihq:catalog:release:1.1.0`, schema `@aihq/catalog/schemas/release/1.1.0.json`). The 1.0 release, its schema export and every 1.0 item identity are unchanged. The 1.1 format admits Core recipe 1.0 and 1.1 items, so a release may mix them. A reader that supports only 1.0 refuses a 1.1 document as a whole (`SCHEMA_UNSUPPORTED`); it never exposes a subset of its items. A reader that supports 1.1 still reads 1.0 releases. Read the 1.1 release explicitly, for example `readInstalledRelease({ root, release: "./release-1.1.json" })`; the default is always `./release.json` and 1.1 is never substituted for it. Select across both releases by supplying each checked release to `validateSelectionSet`.

A 1.1 item needs a Core that supports recipe and policy 1.1. A Core without it reports the item as unsupported and writes nothing; a 1.0 policy cannot carry a 1.1 recipe.

**Selector.** Core identifies a group by an author-chosen `groupId` kept in its own custody, never written into the client file, plus a selector: a path inside the group object and a fixed string found there. The selector must be a documented, stable scalar the client already reads. Claude Code's matcher groups have no documented ID field, so the carried item uses the fixed wrapper command (`hooks[0].command`). A client without such a field is unsupported here: no whole-event replacement and no invented ID field.

**Carried item.** `aihq.hook.claude.protect-env` is opt-in and project-scoped. It writes `.claude/hooks/aihq-protect-env.mjs` and registers a `PreToolUse` group for direct `Edit|Write` calls in `.claude/settings.json`. The Node script parses the client's JSON input and exits 2 for a local `.env` or `.env.<name>` target, matching file names case-insensitively so case variants such as `.ENV` are covered (not `.env.example`, `.env.sample` or `.env.template`). On Windows it classifies the base filename before a data-stream suffix, covering targets such as `.env::$DATA`. Its recipe declares `node` as an executable prerequisite. It does not intercept shell commands or other file-changing tools. Catalog does not claim a client's native loader runs the group; delivery and Core's group-scoped review are what the checks establish.

After changing the hook renderer, build it with `npm run build:dist`, then run `node tools/generate-release.mjs --hooks-only`. This updates only the authored 1.1 hook release, recipes and material, preserving the targeted 1.0 release. The command checks selector continuity against the committed baseline before writing. Run `npm run verify` and the affected packed consumer afterward. The full donor seed generation still refuses to replace an advanced upstream release.

**Authoring rules.** Changing a selector under the same item and `groupId` is refused by the producer against the previously committed `release/release-1.1.json`, and Core refuses it again at review (`hook-selector-changed`). A changed selector needs a new `groupId`; it replaces the old group in one run only when the new selector and group do not collide with the old group that is still present, otherwise remove the selection in one reviewed run and add the new one in another. Renaming only the item ID keeps Core's group identity, so it also needs that two-run removal. The check compares an item ID with the previous 1.1 release; it is not a history of every earlier group.

`node tools/verify-hook-consumer.mjs <core.tgz> [--legacy-core <older-core.tgz>]` packs this Catalog, installs it with the supplied Core artifacts in disposable roots and runs add, update (after a neighbor inserts a group and edits its own), remove, an unowned-selector conflict, a stale review, a 1.0 policy refusal and the packed CLI against a project that already holds a user-owned group. With `--legacy-core` it also shows a Core without recipe 1.1 refusing the item.

## Native graph fixture (test scope)

Two further 1.0 release documents, `@aihq/catalog/release-native-fixture.json` and `@aihq/catalog/release-native-bundles.json`, prepare one persistent Claude MCP configuration for later native verification. They use release format `urn:aihq:catalog:release:1.0.0` and Core recipe 1.0 with the existing `file.write`, `config.entries` and `text.block` operations. Read either explicitly, for example `readInstalledRelease({ root, release: "./release-native-fixture.json" })`; the default stays `./release.json`. The bundle cannot live in the document it pins, because it records the SHA-256 of that release and item, so it has its own document.

- `aihq.mcp.claude.graph-fixture` (kind `mcp-server`, project scope, prerequisite executable `node`) writes `.aihq/graph-fixture/graph-server.mjs`, its fixed `graph.json` and Core's stdio recorder program at `.aihq-native/recorder.mjs`, checks each file's hash, sets `mcpServers.aihq-graph-fixture` in the project `.mcp.json` to the `node` command that runs the server behind the recorder, and adds one owned `CLAUDE.md` block (`aihq-graph-fixture`, its own markers) that does not touch the shared context block.
- `aihq.native-bundle.claude.graph-fixture` (kind `native-verification-bundle`) ships the Core-owned `urn:aihq:core:native-verification-bundle:1.0.0` bundle `aihq.catalog.claude.graph-fixture.v1` (scope `test-configuration`, adapter `claude-stream-json.v1`) as ordinary declared material, with the two expected-output files that are derived rather than copied (`CLAUDE.md` and `.mcp.json`). Its recipe only places the bundle file under `.aihq-native/verification/`; the bundle selects nothing by itself. The recipe declares the two expected-output files as materials without writing them, because the bundle must find every pinned file in the package archive.

The bundle pins the release, item, recipe, empty inputs, an empty starting tree and the complete five-file output tree with both tree digests, one marker instruction, the exact server runtime closure, the recorder and the fixed query `aihq_graph_callees {symbol: "loadConfig"}` with the SHA-256 of its result and the expected answer `readFile`. The renderer computes every pin before any run. The expected `.mcp.json` and `CLAUDE.md` follow from Core's documented edit rules for an absent target; nothing is learned from a run. The marker in the instruction is a public diagnostic value, not a secret.

**What the server is.** `graph-server.mjs` is a read-only line-delimited JSON-RPC stdio server over a four-function call graph (`main` calls `parseArgs` and `loadConfig`, `loadConfig` calls `readFile`). It uses only Node built-ins, opens no network connection, writes nothing, starts no process and bounds message count and size. It answers `initialize`, `ping`, `tools/list` and `tools/call` for one tool with exactly `{symbol: string}`; an unknown symbol, wrong arguments, an unknown tool or an unknown method is a JSON-RPC error, never a fabricated success. It implements no attestation: Core's recorder adds that tool and records the session.

**What it is not.** This is a fixture at test scope. It is not a production graph server, and it proves nothing about a production graph server, about a client loading or approving the project server, or about persistence. The recorder program is the exact `aihq.stdio-recorder.v1` text of the selected Core artifact (`1.0.0-dev.33`), pinned in `src/release/native-recorder-pin.ts` and recorded in the item metadata. Core compares those bytes, so Catalog never edits them; a different Core recorder needs a new pin and a new Catalog release. Core is Apache-2.0, as is this package, and the pin keeps the origin and license in its header.

After changing the renderer, build it with `npm run build:dist`, then run `node tools/generate-release.mjs --native-only`. `npm run check:materials` fails if either document or any member is stale. The producer carries both documents and renders them again for a candidate's own package identity, because the bundle pins that identity.

`node tools/verify-native-bundle.mjs <core.tgz> [--evidence <file>] [--scenario-node <node>]` packs this Catalog, installs it with the supplied Core artifact in a disposable consumer with lifecycle scripts off, and checks the bundle with Core's portable validators (also showing that a mutated bundle is refused). It then checks the packed archive as Core's supplied-bundle reader would, resolves every named member by hash and length, recomputes both tree digests, compares the committed recorder with the supplied artifact's, and runs Core Prepare, review and Apply into an empty disposable project, comparing the complete output tree with the pinned one. It runs the delivered server once through plain `node` for the fixed query. It starts no client, calls no native verifier and publishes nothing. Core Prepare admits work only under Node 24.15 or newer 24.x, so a different starting Node needs `--scenario-node`. [The preparation record](evidence/claude-graph-fixture-preparation.json) holds the sanitized result.

## Explicit dependencies and Core handoff

The host supplies an explicitly chosen installed package root. Sensitive inputs,
when declared, travel through Core host controls rather than serialized policy.

```js
import { configureItem, validateSelectionSet } from "@aihq/catalog/reader";
import { readInstalledRelease } from "@aihq/catalog/node";
import { prepare, apply } from "@aihq/core";

const acquired = await readInstalledRelease({ root: installedCatalogRoot });
if (!acquired.valid) throw new Error(JSON.stringify(acquired.diagnostics));
const configured = ["mattpocock.grill-me", "mattpocock.grilling"].map(itemId =>
  configureItem({ release: acquired.release, itemId, configuration: {},
    materialSource: acquired.source }));
for (const choice of configured)
  if (!choice.valid) throw new Error(JSON.stringify(choice.diagnostics));

const selections = configured.map((choice, index) => ({
  id: index === 0 ? "chosen" : "required",
  item: { releaseSha256: choice.provenance.manifestSha256,
    itemId: choice.provenance.itemId, itemSha256: choice.provenance.itemSha256 },
  configuration: choice.selection.configuration,
}));
const validated = validateSelectionSet({
  releases: { [acquired.release.sha256]: acquired.release }, selections,
});
if (!validated.valid) throw new Error(JSON.stringify(validated.diagnostics));
// { chosen: ["required"], required: [] }
const policy = { schema: "urn:aihq:core:execution-policy:1.0.0", mode: "vibe",
  selections: configured.map((choice, index) => ({ ...choice.selection,
    id: selections[index].id, managementId: selections[index].id,
    scope: "project", requires: validated.requiresBySelectionId[selections[index].id],
  })),
};
const controls = { materialRoots: acquired.materialRoots };
const prepared = await prepare({ useCase: "policy", policy,
  target: { project: explicitlySelectedProject } }, controls);
if (prepared.status !== "ready") throw new Error(JSON.stringify(prepared.diagnostics));
// The host reviews prepared.review and obtains approval for this exact digest.
const completed = await apply(prepared.prepared, {
  approved: true, origin: "interactive", reviewDigest: prepared.review.reviewDigest,
}, controls);
```

For an archive, use the `release` and `source` returned by `resolveRelease` instead;
the recipe reference uses `package/` member paths and needs no local material root.
The exact recipe and named-material hashes remain equal across acquisition methods.
