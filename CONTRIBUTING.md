# Contributing

Start with [AGENTS.md](AGENTS.md) for issue ownership and repository boundaries. Accepted
bugs and enhancements use the owning Catalog issue; link the pull request and the verified
outcome there. Keep private planning and reproductions out of public text.

## Setup and checks

Use Node 26.12.1 or a later 26.x. Install with `npm ci --ignore-scripts`, then run
`npm run verify` before requesting review. It builds `dist/catalog`, checks that the embedded
tool profiles match `profiles/`, typechecks, lints, runs every test once and checks that
workflow actions are pinned. CI runs the same command, then `npm audit --audit-level=high`
and `git diff --check`.

`@aihq/scan` is the one dependency Catalog adds. The package depends on the exact version
`0.1.0`. Until Scan is on the npm registry, this repository installs that version from
`vendor/aihq-scan-0.1.0.tgz` (sha256
`52f040b1e09dd4015d5c88b9b98b59d177626bf449f1e819448411552de59bcd`): the development
dependency of the same name points at the tarball, npm prefers it inside this repository, and
the lockfile records its integrity. The sha256 is written in three places: here, in
[README.md](README.md#install) and as `SCAN_SHA256` in `tests/catalog/package.test.ts`, which
checks the tarball against it and fails when either document quotes another value. Replacing
the tarball means updating all three (and `npm install` for the lockfile);
`validation/packed-consumer.json` records the tarball's sha256 itself. Only
`@aihq/scan/contracts` may be imported.

## Tests

`npm test` runs `vitest.config.ts`: every `tests/**/*.test.ts`. While working on one
behaviour, run only its file, for example `npx vitest run tests/catalog/own-folder.test.ts`.

- Tests call the public functions of `src/catalog` against disposable folders, local Git
  repositories and a local npm registry. They never mock internal modules and never use the
  network. The fetching tests need `git` and `npm` on `PATH`.
- `tests/catalog/contracts.test.ts` checks the published schemas, fixtures and profiles, and
  that every committed content file, qualification and drafted recipe conforms.
- `tests/catalog/package.test.ts` checks the five exports, the dependency on Scan and the
  packed file list (it needs a build, which `npm run verify` makes first), and that nothing of
  the earlier release model remains.
- Tests over committed data use the pinned upstream files in `tests/fixtures/`, whose Git blob
  ids are checked against the upstream trees.
- `tests/publication-guard.test.ts`, `tests/self-hosting` and `tests/bootstrap` check the
  publication refusal, the repository instructions and the optional helper tooling.

Write tests first, one behaviour at a time, against the public entry points.

### The packed public consumer

`npm run check:consumer` builds and packs this checkout with `npm pack`, installs the exact
tarball and the vendored Scan tarball offline into a disposable consumer outside the
repository, and replays the fifteen acceptance journeys and the consumer regressions there
through the five exports only (`tools/check-consumer.mjs`, scenarios in `tools/consumer/`).
Its inputs come through the package's own `fetchSource` from this repository's Git history at
the packed commit, so commit first. The journeys run under Node's permission model with no
child process, worker or network, and the browser-safe entry points are loaded without any
Node built-in. It takes a few seconds and CI runs it after `npm run verify`.

Each row is `passed`, `failed`, `open` (a recorded gap against the journey's expected
result, with its reason) or `pending` (proof the replay cannot give, such as a real
qualification), and so is each of its checks except `pending`: an open check is never
recorded as passed, and names its basis: a fixture, the committed candidate data or, with
`-- --network`, the real upstream bytes at their pins. `-- --write` records the results for a
clean checkout in [validation/packed-consumer.json](validation/packed-consumer.json),
identified by source commit and tarball sha256. None of these results shows native client
support, a real qualification or accepted production data.

## Formats, schemas and profiles

A format change updates its reader, its schema in `src/catalog/internal/schemas.ts`, its two
fixtures in `src/catalog/internal/fixtures.ts` and [CONTRACTS.md](CONTRACTS.md) together.
Tool profiles live in `profiles/<id>.json` as canonical JSON. After changing one, run
`npm run generate:profiles` to refresh the copy `/contracts` embeds, and increase the
profile's `version` when its rendered output changes.

## Data and the port report

Framework content, AI setups and qualifications live under `data/`. The port tools rebuild
them from exact upstream pins with `fetchSource` (network, no hooks, no lifecycle scripts, no
checkout), and `-- --check` compares instead of writing:

| Command | Writes |
| --- | --- |
| `npm run port:maintained` | `data/{ecc,superpowers,extensions,project-basics}`, `port-report/maintained.json` |
| `npm run port:remaining` | `data/{anthropic,web-artifacts,guide,pstack,gstack,egm}`, `port-report/remaining.json` |
| `npm run port:ai-setup` | `data/{crg,cbm,serena}`, `data/qualifications/`, `port-report/ai-setup.json` |
| `npm run port:report` | `port-report/report.json`, from the three section reports and the data (offline) |

Each section report carries the earlier Catalog items it disposes, so the tools check against
it. A new qualification is a new `data/qualifications/<sha256>.json` referenced by its AI
setup item, with the status its recorded run gave; it never needs a package release. Never
commit upstream bytes whose licence forbids redistribution: record their identity and mark
the item `fetch: "upstream"`.

## Commits and pull requests

Keep commits focused, with conventional messages. Every pull request carries exactly one
`semver:` label ([VERSIONING.md](VERSIONING.md)). Publication is refused
([RELEASING.md](RELEASING.md)).
