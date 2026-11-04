# Changelog

## 0.1.0 (unreleased)

The first version of the source-to-plan library. It replaces the earlier release model, which
registry versions 0.1.3 and 0.2.0 carried; nothing of that model remains, and 0.1.0 is not
compatible with them.

- Five entry points: `/source`, `/node`, `/producer`, `/reader` and `/contracts`.
- Sources: your own folder, a Git repository or subfolder pinned to a commit, or an npm
  package pinned to an exact version. Pasted links and installer commands are parsed as text
  and never run; fetching disables Git hooks, checkout and npm lifecycle scripts.
- Items: skills (with commands as user-only skills), agents, rules, hooks, MCP servers
  (Registry `server.json`), documents and AI setups, one item per piece of content, with
  upstream client editions, notices, runtime bundles and recorded plugin folders. Content,
  behaviour and Scan identities for every item.
- Nine tool profiles: Claude Code, Codex, GitHub Copilot, Kiro, Antigravity, OpenCode,
  Cursor, Kimi and dsh.
- Deterministic plans for project and user scope: copies, rendered files, shared user-scope
  versions and links, keyed merges, pinned native plugins, local plugins, approval-requiring
  upstream setup, upstream fetches for content that may not be redistributed, and qualified AI
  setup acquisition and settings. Clashes, built-ins, duplicates across frameworks,
  references, scope fallbacks and missing dependencies are reported, never resolved silently.
- Recipes as Git plugins that pin the Catalog data commit they were written against.
- Qualification records tied to exact artifacts and platform cells.
- Five JSON Schemas, ten fixtures and the nine tool profiles published from `/contracts`.
- Candidate data for thirteen frameworks under `data/`, with a port report that gives every
  earlier Catalog item one disposition.
