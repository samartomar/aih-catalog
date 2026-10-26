# Source links

`samartomar/aih-catalog#120` implements the specification's **Sources people and
organizations bring** link-parsing step. A person pastes a GitHub link, an
install command or an npm package name and sees what it refers to, with nothing
fetched, installed or run.

`parseSourceLink(text)` from `@aihq/catalog/source` is portable and
side-effect-free: pasted text is data, never an executable command. It returns

```ts
{
  status: "recognised" | "unrecognised",
  candidate?: { kind: "git" | "npm" | "local", repository?, ref?, package?, version? },
  diagnostics,
}
```

The consumer shows the result; it holds no parsing rules of its own. Parsing is
discovery, never permission to install.

## Published limit and named refusals

Input is at most **2,048 characters**, published as
`PARSE_SOURCE_LINK_MAX_CHARACTERS`. Longer input is a named refusal: status
`unrecognised`, diagnostic `input-too-long`, and no candidate. Unrecognised
input always reports `unrecognised` with a diagnostic and never a guessed
candidate — when the source identity cannot be derived from the pasted text
alone, nothing is invented.

## Recognised forms

Each form parses to the same candidate in every consumer:

- A GitHub repository, tree or permalink link, `https://github.com/<owner>/<repo>[/tree|/blob/<ref>[/path]]`.
- An npm package page, `https://www.npmjs.com/package/<name>[/v/<version>]`.
- An install command, `npx [-y] <package>[@<version>]` or
  `npx skills add <github-link> --skill <name>`.
- An npm package name, `<name>` or `@<scope>/<name>`, optionally `@<version>`.
- The MCP servers directory page, `https://github.com/modelcontextprotocol/servers[/tree/<ref>[/src/<entry>]]`.

Only an exact reference produces no `reference-not-exact` diagnostic: a full
40-character commit SHA for GitHub, or an exact version for npm. A branch, tag,
`latest`, an implied default branch, or a version range stays `recognised` but
carries an explicit `reference-not-exact` diagnostic; the parser never silently
resolves or pins it, and a range never yields a `version`.

## Discovery stays apart from the source

Discovery surfaces are reported as non-authoritative `discovery-note`
diagnostics and never change the candidate:

- The `--skill <name>` selector on `npx skills add` is a note; the candidate is
  the link's GitHub repository alone.
- The MCP servers directory is a discovery listing, not a source. A directory
  page parses to the directory's own repository identity derived from the URL;
  a listed server's upstream is never derived from the directory.

Resolution and acquisition (`resolveGitRef`, `acquireGitSnapshot`,
`acquireNpmSnapshot`) are separate, bounded contracts and are not part of this
step; see the parent specification (samartomar/aih-catalog#132).

## Consumer check

`node tools/verify-source-link-consumer.mjs [catalog.tgz]` installs the packed
package into a disposable consumer and exercises every accepted form, the
2,048-character boundary, the named refusals, exact-versus-mutable references
and the no-guess rule through the public `@aihq/catalog/source` export only.
Throwing guards on the process and network surfaces are armed before import,
so any fetch, execution or host discovery inside the parser fails the check.
