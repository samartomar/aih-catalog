# Catalog Scan coverage

**630 of 1,069 Catalog versions have a published scan. 439 await one.**

This snapshot covers 960 items across 14 families, including client editions, runtime bundles and plugin folders. See the [sources and refresh instructions](#sources-and-refresh).

- **Published scans** show the scan's risk rating and whether inspection was complete or partial for its selected tools. Read the findings and limits before deciding whether to install.
- **No published scan yet** means this snapshot found no public report for that version.
- **See qualifications** points to platform-specific evidence for an AI setup.

## Families

Items and editions that share the same files, paths and modes count as one version. The overall row counts versions shared across families once.

| Family | Items | Versions | Published | Pending | AI setups with qualifications |
| --- | ---: | ---: | ---: | ---: | ---: |
| **All families** | 960 | 1,069 | 630 | 439 | 3 |
| [Anthropic skills](#family-anthropic) | 18 | 24 | 14 | 10 | 0 |
| [codebase-memory-mcp](#family-cbm) | 2 | 1 | 1 | 0 | 1 |
| [code-review-graph](#family-crg) | 9 | 8 | 8 | 0 | 1 |
| [ECC](#family-ecc) | 698 | 775 | 517 | 258 | 0 |
| [Elephant-Goldfish Model](#family-egm) | 18 | 21 | 8 | 13 | 0 |
| [AIH Extensions](#family-extensions) | 66 | 67 | 37 | 30 | 0 |
| [gstack](#family-gstack) | 61 | 61 | 0 | 61 | 0 |
| [AIH Guide](#family-guide) | 2 | 4 | 4 | 0 | 0 |
| [Google Chrome Modern Web Guidance](#family-modern-web-guidance) | 2 | 2 | 0 | 2 | 0 |
| [Project basics](#family-project-basics) | 3 | 3 | 3 | 0 | 0 |
| [pstack](#family-pstack) | 61 | 83 | 29 | 54 | 0 |
| [Serena](#family-serena) | 2 | 1 | 1 | 0 | 1 |
| [Superpowers](#family-superpowers) | 17 | 18 | 8 | 10 | 0 |
| [Web artifacts](#family-web-artifacts) | 1 | 1 | 0 | 1 | 0 |

## Look up an item or edition

Choose a family and search for the item's name. Each date links to the release for the latest scan of that type. To find the summary and findings, use the [exact Catalog and Scan identifiers](scan-coverage.csv) and look up the Scan key in the release's `index.json`. The entry gives the archive name and the summary's path inside it.

<a name="family-anthropic"></a>

### Anthropic skills

| Name | Type | Published scans |
| --- | --- | --- |
| academy-guide | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| algorithmic-art | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| brand-guidelines | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| canvas-design | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| discernment-nudge | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| doc-coauthoring · upstream-only | Skill | No published scan yet |
| docx | Skill | No published scan yet |
| frontend-design | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| internal-comms | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| mcp-builder | Skill | No published scan yet |
| pdf | Skill | No published scan yet |
| pptx | Skill | No published scan yet |
| skill-creator | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1]) |
| slack-gif-creator | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| theme-factory | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| web-artifacts-builder | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| webapp-testing | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · DO NOT INSTALL · Complete ([Nov 25, 2026][release-2]) |
| xlsx | Skill | No published scan yet |
| academy-guide | Plugin | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| academy-guide | Full plugin folder | No published scan yet |
| claude-api | Plugin | No published scan yet |
| claude-api | Full plugin folder | No published scan yet |
| discernment-nudge | Plugin | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| discernment-nudge | Full plugin folder | No published scan yet |
| document-skills | Plugin | No published scan yet |
| document-skills | Full plugin folder | No published scan yet |
| example-skills | Plugin | No published scan yet |
| example-skills | Full plugin folder | No published scan yet |

<a name="family-cbm"></a>

### codebase-memory-mcp

| Name | Type | Published scans |
| --- | --- | --- |
| codebase-memory-mcp | AI setup | [See qualifications](../README.md#data) |
| codebase-memory-mcp | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |

<a name="family-crg"></a>

### code-review-graph

| Name | Type | Published scans |
| --- | --- | --- |
| code-review-graph | AI setup | [See qualifications](../README.md#data) |
| code-review-graph | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| build-graph | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| debug-issue | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| explore-codebase | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| refactor-safely | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| review-changes | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| review-delta | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| review-pr | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |

<a name="family-ecc"></a>

### ECC

| Name | Type | Published scans |
| --- | --- | --- |
| a11y-architect | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| agent-evaluator | Agent | No published scan yet |
| architect | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| architect | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| bengali-reviewer | Agent | No published scan yet |
| build-error-resolver | Agent | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| build-error-resolver | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| chief-of-staff | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| chief-of-staff | Kiro edition | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| code-architect | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| code-explorer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| code-reviewer | Agent | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| code-reviewer | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| code-simplifier | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| comment-analyzer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| commit-reviewer | Agent | No published scan yet |
| conversation-analyzer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cpp-build-resolver | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cpp-build-resolver | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cpp-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cpp-reviewer | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| csharp-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| dart-build-resolver | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| database-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| database-reviewer | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| django-build-resolver | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| django-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| django-reviewer | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| doc-updater | Agent | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| doc-updater | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| docs-lookup | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| e2e-runner | Agent | No published scan yet |
| e2e-runner | Kiro edition | No published scan yet |
| fastapi-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| flutter-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| fsharp-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| fsharp-reviewer | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| gan-evaluator | Agent | No published scan yet |
| gan-generator | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| gan-planner | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| gdscript-reviewer | Agent | No published scan yet |
| go-build-resolver | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| go-build-resolver | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| go-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| go-reviewer | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| harmonyos-app-resolver | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| harness-optimizer | Agent | No published scan yet |
| harness-optimizer | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| healthcare-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| homelab-architect | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| java-build-resolver | Agent | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| java-build-resolver | Kiro edition | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · DO NOT INSTALL · Complete ([Nov 25, 2026][release-2]) |
| java-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| java-reviewer | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| kotlin-build-resolver | Agent | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| kotlin-build-resolver | Kiro edition | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · DO NOT INSTALL · Complete ([Nov 25, 2026][release-2]) |
| kotlin-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| kotlin-reviewer | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| loop-operator | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| loop-operator | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| marketing-agent | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| mle-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| mle-reviewer | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| network-architect | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| network-config-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| network-troubleshooter | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| opensource-forker | Agent | No published scan yet |
| opensource-packager | Agent | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| opensource-sanitizer | Agent | No published scan yet |
| performance-optimizer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| performance-optimizer | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| php-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| planner | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| planner | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| pr-test-analyzer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| python-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| python-reviewer | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| pytorch-build-resolver | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| pytorch-build-resolver | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rag-pipeline-reviewer | Agent | No published scan yet |
| react-build-resolver | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| react-build-resolver | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| react-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| react-reviewer | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| refactor-cleaner | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| refactor-cleaner | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ruby-reviewer | Agent | No published scan yet |
| rust-build-resolver | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-build-resolver | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-reviewer | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security-reviewer | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| seo-specialist | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| silent-failure-hunter | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| spec-miner | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| swift-build-resolver | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| swift-reviewer | Agent | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| swift-reviewer | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| tdd-guide | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| tdd-guide | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| type-design-analyzer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| typescript-reviewer | Agent | No published scan yet |
| typescript-reviewer | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| vue-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| auto-format | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| auto-format | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| code-review-on-write | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| code-review-on-write | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| console-log-check | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| console-log-check | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| doc-file-warning | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| doc-file-warning | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| extract-patterns | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| extract-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| git-push-review | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| git-push-review | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| post-dispatcher-async | Hook | No published scan yet |
| post-dispatcher-async | Claude Code edition | No published scan yet |
| post-dispatcher-sync | Hook | No published scan yet |
| post-dispatcher-sync | Claude Code edition | No published scan yet |
| post-mcp-health-check | Hook | No published scan yet |
| post-mcp-health-check | Claude Code edition | No published scan yet |
| post-skill-track | Hook | No published scan yet |
| post-skill-track | Claude Code edition | No published scan yet |
| pre-bash-dispatcher | Hook | No published scan yet |
| pre-bash-dispatcher | Claude Code edition | No published scan yet |
| pre-compact | Hook | No published scan yet |
| pre-compact | Claude Code edition | No published scan yet |
| pre-config-protection | Hook | No published scan yet |
| pre-config-protection | Claude Code edition | No published scan yet |
| pre-edit-write-gateguard-fact-force | Hook | No published scan yet |
| pre-edit-write-gateguard-fact-force | Claude Code edition | No published scan yet |
| pre-edit-write-suggest-compact | Hook | No published scan yet |
| pre-edit-write-suggest-compact | Claude Code edition | No published scan yet |
| pre-governance-capture | Hook | No published scan yet |
| pre-governance-capture | Claude Code edition | No published scan yet |
| pre-hookify-runtime | Hook | No published scan yet |
| pre-hookify-runtime | Claude Code edition | No published scan yet |
| pre-mcp-health-check | Hook | No published scan yet |
| pre-mcp-health-check | Claude Code edition | No published scan yet |
| pre-observe-continuous-learning | Hook | No published scan yet |
| pre-observe-continuous-learning | Claude Code edition | No published scan yet |
| pre-powershell-gateguard-fact-force | Hook | No published scan yet |
| pre-powershell-gateguard-fact-force | Claude Code edition | No published scan yet |
| pre-write-doc-file-warning | Hook | No published scan yet |
| pre-write-doc-file-warning | Claude Code edition | No published scan yet |
| prompt-hookify-runtime | Hook | No published scan yet |
| prompt-hookify-runtime | Claude Code edition | No published scan yet |
| python-lint-on-edit | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| python-lint-on-edit | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| quality-gate | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| quality-gate | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-check-on-edit | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-check-on-edit | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security-check-on-create | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security-check-on-create | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| session-end-marker | Hook | No published scan yet |
| session-end-marker | Claude Code edition | No published scan yet |
| session-start | Hook | No published scan yet |
| session-start | Claude Code edition | No published scan yet |
| session-start | Codex edition | No published scan yet |
| session-start-plan-canvas-sessions | Hook | No published scan yet |
| session-start-plan-canvas-sessions | Claude Code edition | No published scan yet |
| session-summary | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| session-summary | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| stop-check-console-log | Hook | No published scan yet |
| stop-check-console-log | Claude Code edition | No published scan yet |
| stop-cost-tracker | Hook | No published scan yet |
| stop-cost-tracker | Claude Code edition | No published scan yet |
| stop-desktop-notify | Hook | No published scan yet |
| stop-desktop-notify | Claude Code edition | No published scan yet |
| stop-evaluate-session | Hook | No published scan yet |
| stop-evaluate-session | Claude Code edition | No published scan yet |
| stop-format-typecheck | Hook | No published scan yet |
| stop-format-typecheck | Claude Code edition | No published scan yet |
| stop-hookify-runtime | Hook | No published scan yet |
| stop-hookify-runtime | Claude Code edition | No published scan yet |
| stop-plan-canvas-pending | Hook | No published scan yet |
| stop-plan-canvas-pending | Claude Code edition | No published scan yet |
| stop-session-end | Hook | No published scan yet |
| stop-session-end | Claude Code edition | No published scan yet |
| tdd-reminder | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| tdd-reminder | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| typecheck-on-edit | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| typecheck-on-edit | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| user-prompt-context-gate | Hook | No published scan yet |
| user-prompt-context-gate | Claude Code edition | No published scan yet |
| arcmira | MCP server | No published scan yet |
| browser-use | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| clickhouse | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cloudflare-docs | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cloudflare-observability | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cloudflare-workers-bindings | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cloudflare-workers-builds | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| codescene | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| confluence | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| context7 | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| deja-vu | MCP server | No published scan yet |
| devfleet | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| exa-web-search | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| fal-ai | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| filesystem | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| firecrawl | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| jira | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| laraplugins | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| magic | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| memory | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| memxus | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| mnemosyne-os | MCP server | No published scan yet |
| omega-memory | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| parallel-search | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| playwright | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| sequential-thinking | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| supabase | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| vercel | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · angular | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| hooks · angular | Rule | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| patterns · angular | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · angular | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · angular | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · arkts | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · arkts | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| patterns · arkts | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| security · arkts | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · arkts | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| agents | Rule | No published scan yet |
| code-review | Rule | No published scan yet |
| coding-style · common | Rule | No published scan yet |
| development-workflow · common | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| git-workflow · common | Rule | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| hooks · common | Rule | No published scan yet |
| patterns · common | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| performance · common | Rule | No published scan yet |
| security · common | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · common | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · cpp | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · cpp | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| patterns · cpp | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · cpp | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · cpp | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · csharp | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · csharp | Rule | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| patterns · csharp | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · csharp | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · csharp | Rule | No published scan yet |
| coding-style · dart | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · dart | Rule | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| patterns · dart | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · dart | Rule | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| testing · dart | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · fsharp | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · fsharp | Rule | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| patterns · fsharp | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · fsharp | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · fsharp | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · golang | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · golang | Rule | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| patterns · golang | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · golang | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · golang | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · java | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · java | Rule | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| patterns · java | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · java | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · java | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · kotlin | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · kotlin | Rule | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| patterns · kotlin | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · kotlin | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · kotlin | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · nuxt | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · nuxt | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| patterns · nuxt | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · nuxt | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · nuxt | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · perl | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · perl | Rule | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| patterns · perl | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · perl | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · perl | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · php | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · php | Rule | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| patterns · php | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · php | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · php | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · python | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| fastapi | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · python | Rule | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| patterns · python | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · python | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · python | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| accessibility | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · react-native | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · react-native | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| patterns · react-native | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| performance · react-native | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| production-readiness | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · react-native | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · react-native | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · react | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| hooks · react | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| patterns · react | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · react | Rule | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| testing · react | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · ruby | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · ruby | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| patterns · ruby | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · ruby | Rule | No published scan yet |
| testing · ruby | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · rust | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · rust | Rule | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| patterns · rust | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · rust | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · rust | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · steering | Rule | No published scan yet |
| coding-style · steering | Kiro edition | No published scan yet |
| cpp-patterns | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cpp-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| dev-mode | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| dev-mode | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| development-workflow · steering | Rule | No published scan yet |
| development-workflow · steering | Kiro edition | No published scan yet |
| git-workflow · steering | Rule | No published scan yet |
| git-workflow · steering | Kiro edition | No published scan yet |
| golang-patterns | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| golang-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| java-patterns | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| java-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| kotlin-patterns | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| kotlin-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| lessons-learned | Rule | No published scan yet |
| lessons-learned | Kiro edition | No published scan yet |
| patterns · steering | Rule | No published scan yet |
| patterns · steering | Kiro edition | No published scan yet |
| performance · steering | Rule | No published scan yet |
| performance · steering | Kiro edition | No published scan yet |
| php-patterns | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| php-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| python-patterns | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| python-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| research-mode | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| research-mode | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| review-mode | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| review-mode | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ruby-patterns | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ruby-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-patterns | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · steering | Rule | No published scan yet |
| security · steering | Kiro edition | No published scan yet |
| swift-patterns | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| swift-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · steering | Rule | No published scan yet |
| testing · steering | Kiro edition | No published scan yet |
| typescript-patterns | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| typescript-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| typescript-security | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| typescript-security | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| coding-style · swift | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · swift | Rule | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| patterns · swift | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · swift | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · swift | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · typescript | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| hooks · typescript | Rule | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| patterns · typescript | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · typescript | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · typescript | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · vue | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · vue | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| patterns · vue | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · vue | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · vue | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · web | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| design-quality | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · web | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| patterns · web | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| performance · web | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · web | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · web | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| accessibility | Skill | No published scan yet |
| agent-architecture-audit | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| agent-eval | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| agent-harness-construction | Skill | No published scan yet |
| agent-introspection-debugging | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| agent-payment-x402 | Skill | No published scan yet |
| agent-runtime-gateway-smoke-test | Skill | No published scan yet |
| agent-security-hardening | Skill | No published scan yet |
| agent-self-evaluation | Skill | No published scan yet |
| agent-sort | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| agentic-engineering | Skill | No published scan yet |
| agentic-engineering | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| agentic-os | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| ai-first-engineering | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ai-regression-testing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| android-clean-architecture | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| angular-developer | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1]) |
| api-connector-builder | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| api-design | Skill | No published scan yet |
| api-design | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| architecture-decision-records | Skill | No published scan yet |
| article-writing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| aside | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| astra-review | Skill | No published scan yet |
| auto-update | Skill | No published scan yet |
| automation-audit-ops | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| autonomous-agent-harness | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| autonomous-loops | Skill | No published scan yet |
| autonomous-loops | Kiro edition | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| backend-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| backend-patterns | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| benchmark | Skill | No published scan yet |
| benchmark-methodology | Skill | No published scan yet |
| benchmark-optimization-loop | Skill | No published scan yet |
| bengali-nlp | Skill | No published scan yet |
| blender-motion-state-inspection | Skill | No published scan yet |
| blueprint | Skill | No published scan yet |
| brand-discovery | Skill | No published scan yet |
| brand-voice | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| brownfield-retrospective | Skill | No published scan yet |
| browser-qa | Skill | No published scan yet |
| build-fix | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| bun-runtime | Skill | No published scan yet |
| canary-watch | Skill | No published scan yet |
| carrier-relationship-management · upstream-only | Skill | No published scan yet |
| change-impact | Skill | No published scan yet |
| checkpoint | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cisco-ios-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ck | Skill | No published scan yet |
| click-path-audit | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| clickhouse-io | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| code-review | Skill | No published scan yet |
| code-tour | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| codebase-onboarding | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| codehealth-mcp | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-standards | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-standards | Kiro edition | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| competitive-platform-analysis | Skill | No published scan yet |
| competitive-report-structure | Skill | No published scan yet |
| compose-multiplatform-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| config-gc | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| config-health | Skill | No published scan yet |
| configure-ecc | Skill | No published scan yet |
| connections-optimizer | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| content-engine | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| content-hash-cache-pattern | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| content-hash-cache-pattern | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| context-and-decisions | Skill | No published scan yet |
| context-budget | Skill | No published scan yet |
| continuous-agent-loop | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| continuous-learning | Skill | No published scan yet |
| continuous-learning-v2 | Skill | No published scan yet |
| contract-first | Skill | No published scan yet |
| conventional-commit-review | Skill | No published scan yet |
| cost-aware-llm-pipeline | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cost-report | Skill | No published scan yet |
| cost-tracking | Skill | No published scan yet |
| council | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| council-multi-model | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| counterparty-channel-discipline | Skill | No published scan yet |
| cpp-build | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| cpp-coding-standards | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cpp-coding-standards | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cpp-review | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cpp-test | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cpp-testing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cpp-testing | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| crosspost | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| csharp-testing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| customer-billing-ops | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| customs-trade-compliance · upstream-only | Skill | No published scan yet |
| dart-flutter-patterns | Skill | No published scan yet |
| dashboard-builder | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| data-scraper-agent | Skill | No published scan yet |
| data-throughput-accelerator | Skill | No published scan yet |
| database-migrations | Skill | No published scan yet |
| database-migrations | Kiro edition | No published scan yet |
| deep-research | Skill | No published scan yet |
| deep-research | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| deepseek-harness-setup | Skill | No published scan yet |
| defi-amm-security | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| delivery-gate | Skill | No published scan yet |
| deployment-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| deployment-patterns | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| design-system | Skill | No published scan yet |
| dev-team | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| devfleet | Skill | No published scan yet |
| django-celery | Skill | No published scan yet |
| django-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| django-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| django-security | Skill | No published scan yet |
| django-security | Kiro edition | No published scan yet |
| django-tdd | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| django-verification | Skill | No published scan yet |
| dmux-workflows | Skill | No published scan yet |
| docker-patterns | Skill | No published scan yet |
| docker-patterns | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| docs-governance | Skill | No published scan yet |
| documentation-lookup | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| dotnet-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| dynamic-workflow-mode | Skill | No published scan yet |
| e2e-testing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| e2e-testing | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ecc-contribution-review | Skill | No published scan yet |
| ecc-guide | Skill | No published scan yet |
| ecc-recipes | Skill | No published scan yet |
| ecc-tools-cost-audit | Skill | No published scan yet |
| email-ops | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| energy-procurement · upstream-only | Skill | No published scan yet |
| enterprise-agent-ops | Skill | No published scan yet |
| epic-claim | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| epic-decompose | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| epic-publish | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| epic-review | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| epic-sync | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| epic-unblock | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| epic-validate | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| error-handling | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| esign-field-placement | Skill | No published scan yet |
| eval-harness | Skill | No published scan yet |
| evm-token-decimals | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| evolve | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| exa-search | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| fal-ai-media | Skill | No published scan yet |
| fastapi-patterns | Skill | No published scan yet |
| fastapi-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| fastapi-review | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| feature-dev | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| finance-billing-ops | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| flox-environments | Skill | No published scan yet |
| flutter-build | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| flutter-dart-code-review | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| flutter-review | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| flutter-test | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| foundation-models-on-device | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| frontend-a11y | Skill | No published scan yet |
| frontend-design-direction | Skill | No published scan yet |
| frontend-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| frontend-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| frontend-slides | Skill | No published scan yet |
| fsharp-testing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| gan-build | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| gan-design | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| gan-style-harness | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · DO NOT INSTALL · Complete ([Nov 25, 2026][release-2]) |
| gateguard | Skill | No published scan yet |
| generating-python-installer | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| git-workflow | Skill | No published scan yet |
| github-ops | Skill | No published scan yet |
| go-build | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| go-review | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| go-test | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| godot-patterns | Skill | No published scan yet |
| godot-testing | Skill | No published scan yet |
| golang-patterns | Skill | No published scan yet |
| golang-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| golang-testing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| golang-testing | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| google-workspace-ops | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| gradle-build | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| growth-log | Skill | No published scan yet |
| harness-audit | Skill | No published scan yet |
| healthcare-cdss-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| healthcare-emr-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| healthcare-eval-harness | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| healthcare-phi-compliance | Skill | No published scan yet |
| hermes-imports | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hexagonal-architecture | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hipaa-compliance | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| homelab-network-readiness | Skill | No published scan yet |
| homelab-network-setup | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| homelab-pihole-dns | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · DO NOT INSTALL · Complete ([Nov 25, 2026][release-2]) |
| homelab-vlan-segmentation | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| homelab-wireguard-vpn | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1]) |
| hookify | Skill | No published scan yet |
| hookify-configure | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| hookify-help | Skill | No published scan yet |
| hookify-list | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| hookify-rules | Skill | No published scan yet |
| i18n-sync | Skill | No published scan yet |
| inherit-legacy-style | Skill | No published scan yet |
| instinct-export | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| instinct-import | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| instinct-status | Skill | No published scan yet |
| intent-driven-development | Skill | No published scan yet |
| inventory-demand-planning · upstream-only | Skill | No published scan yet |
| investor-materials | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| investor-outreach | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ios-icon-gen | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| issue-review | Skill | No published scan yet |
| iterative-retrieval | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ito-baskets | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1]) |
| ito-compute | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ito-inference | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ito-training | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| java-coding-standards | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| java-coding-standards | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| jira | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| jira-integration | Skill | No published scan yet |
| jpa-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| jpa-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| knowledge-ops | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| kotlin-build | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| kotlin-coroutines-flows | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| kotlin-exposed-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| kotlin-ktor-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| kotlin-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| kotlin-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| kotlin-review | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| kotlin-test | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| kotlin-testing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| kotlin-testing | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| kubernetes-patterns | Skill | No published scan yet |
| laravel-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| laravel-plugin-discovery | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| laravel-security | Skill | No published scan yet |
| laravel-tdd | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| laravel-verification | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| latency-critical-systems | Skill | No published scan yet |
| lead-intelligence | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| leanrea | Skill | No published scan yet |
| learn | Skill | No published scan yet |
| learn-eval | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| liquid-glass-design | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| living-docs-governance | Skill | No published scan yet |
| llm-trading-agent-security | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| logistics-exception-management · upstream-only | Skill | No published scan yet |
| loop-design-check | Skill | No published scan yet |
| loop-start | Skill | No published scan yet |
| loop-status | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| mailtrap-email-integration | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| make-interfaces-feel-better | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| manim-video | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| market-research | Skill | No published scan yet |
| marketing-campaign | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| master-agreement-generator | Skill | No published scan yet |
| mcp-dependency-review | Skill | No published scan yet |
| mcp-server-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| messages-ops | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ml-adoption-playbook | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| mle-workflow | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| mle-workflow | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| model-route | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| module-governance | Skill | No published scan yet |
| module-regression | Skill | No published scan yet |
| motion-advanced | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| motion-foundations | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| motion-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| multi-backend | Skill | No published scan yet |
| multi-execute | Skill | No published scan yet |
| multi-frontend | Skill | No published scan yet |
| multi-plan | Skill | No published scan yet |
| multi-workflow | Skill | No published scan yet |
| mybatis-patterns | Skill | No published scan yet |
| mysql-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| nanoclaw-repl | Skill | No published scan yet |
| nasiko-control-plane | Skill | No published scan yet |
| nestjs-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| nestjs-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| netmiko-ssh-automation | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| network-bgp-diagnostics | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| network-config-validation | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| network-interface-health | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| nextjs-turbopack | Skill | No published scan yet |
| nextjs-turbopack | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| nodejs-keccak256 | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| nutrient-document-processing | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| nuxt4-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| openclaw-persona-forge | Skill | No published scan yet |
| opensource-pipeline | Skill | No published scan yet |
| operator-approval-loop | Skill | No published scan yet |
| orch-add-feature | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| orch-build-mvp | Skill | No published scan yet |
| orch-change-feature | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| orch-fix-defect | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| orch-pipeline | Skill | No published scan yet |
| orch-refine-code | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| orch-review | Skill | No published scan yet |
| osint-investigation | Skill | No published scan yet |
| parallel-execution-optimizer | Skill | No published scan yet |
| perl-patterns | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| perl-security | Skill | No published scan yet |
| perl-testing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| plan | Skill | No published scan yet |
| plan-canvas | Skill | No published scan yet |
| plan-orchestrate | Skill | No published scan yet |
| plan-prd | Skill | No published scan yet |
| plankton-code-quality | Skill | No published scan yet |
| platform-factory | Skill | No published scan yet |
| pm2 | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| postgres-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| postgres-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| pr | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| prediction-market-oracle-research | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| prediction-market-risk-review | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| prisma-patterns | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| product-capability | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| product-lens | Skill | No published scan yet |
| production-audit | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| production-scheduling · upstream-only | Skill | No published scan yet |
| project-flow-ops | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| project-init | Skill | No published scan yet |
| projects | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| promote | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| prompt-caching-strategy | Skill | No published scan yet |
| prompt-optimizer | Skill | No published scan yet |
| prp-commit | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| prp-implement | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| prp-plan | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| prp-pr | Skill | No published scan yet |
| prp-prd | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| prune | Skill | No published scan yet |
| python-patterns | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| python-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| python-review | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| python-testing | Skill | No published scan yet |
| python-testing | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| pytorch-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| pytorch-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| quality-gate | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| quality-nonconformance · upstream-only | Skill | No published scan yet |
| quarkus-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| quarkus-security | Skill | No published scan yet |
| quarkus-tdd | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| quarkus-verification | Skill | No published scan yet |
| rails-patterns | Skill | No published scan yet |
| rails-security | Skill | No published scan yet |
| ralphinho-rfc-pipeline | Skill | No published scan yet |
| react-build | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| react-native-patterns | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| react-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| react-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| react-performance | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| react-review | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| react-test | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| react-testing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| react-testing | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| recsys-pipeline-architect | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| recursive-decision-ledger | Skill | No published scan yet |
| redis-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| refactor-clean | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| regex-vs-llm-structured-text | Skill | No published scan yet |
| remotion-video-creation | Skill | No published scan yet |
| repo-scan | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| research-ops | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| resume-session | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| returns-reverse-logistics · upstream-only | Skill | No published scan yet |
| review-pr | Skill | No published scan yet |
| roundhouse-x402 | Skill | No published scan yet |
| rules-distill | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-build | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| rust-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-review | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| rust-test | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-testing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-testing | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| safety-guard | Skill | No published scan yet |
| santa-loop | Skill | No published scan yet |
| santa-method | Skill | No published scan yet |
| save-session | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| scientific-db-openalex-database | Skill | No published scan yet |
| scientific-db-pubmed-database | Skill | No published scan yet |
| scientific-db-uspto-database | Skill | No published scan yet |
| scientific-pkg-gget | Skill | No published scan yet |
| scientific-thinking-literature-review | Skill | No published scan yet |
| scientific-thinking-scholar-evaluation | Skill | No published scan yet |
| search-first | Skill | No published scan yet |
| search-first | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security-bounty-hunter | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security-review | Skill | No published scan yet |
| security-review | Kiro edition | No published scan yet |
| security-scan | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| seo | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| sessions | Skill | No published scan yet |
| setup-pm | Skill | No published scan yet |
| short-video-distribution | Skill | No published scan yet |
| skill-comply | Skill | No published scan yet |
| skill-create | Skill | No published scan yet |
| skill-health | Skill | No published scan yet |
| skill-host-compat | Skill | No published scan yet |
| skill-scout | Skill | No published scan yet |
| skill-stocktake | Skill | No published scan yet |
| social-graph-ranker | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| social-publisher | Skill | No published scan yet |
| springboot-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| springboot-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| springboot-security | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| springboot-security | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| springboot-tdd | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| springboot-verification | Skill | No published scan yet |
| story-lifecycle | Skill | No published scan yet |
| strategic-compact | Skill | No published scan yet |
| strategic-compact | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| swift-actor-persistence | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| swift-actor-persistence | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| swift-concurrency-6-2 | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| swift-protocol-di-testing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| swift-protocol-di-testing | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| swiftui-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| taste | Skill | No published scan yet |
| taste-application | Skill | No published scan yet |
| taste-distillation | Skill | No published scan yet |
| tasteforge-video | Skill | No published scan yet |
| tdd-workflow | Skill | No published scan yet |
| tdd-workflow | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| team-agent-orchestration | Skill | No published scan yet |
| team-builder | Skill | No published scan yet |
| terminal-opener | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| terminal-ops | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| terraform-patterns | Skill | No published scan yet |
| test-collaboration | Skill | No published scan yet |
| test-coverage | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| tinystruct-patterns | Skill | No published scan yet |
| token-budget-advisor | Skill | No published scan yet |
| token-card | Skill | No published scan yet |
| typescript-patterns | Skill | No published scan yet |
| ui-canvas | Skill | No published scan yet |
| ui-demo | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| ui-to-vue | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| uncloud | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| unified-memory | Skill | No published scan yet |
| unified-notifications-ops | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| update-codemaps | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| update-docs | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| verification-loop | Skill | No published scan yet |
| verification-loop | Kiro edition | No published scan yet |
| video-editing | Skill | No published scan yet |
| videodb | Skill | No published scan yet |
| visa-doc-translate | Skill | No published scan yet |
| vite-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| vue-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| vue-review | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| web-perimeter-owasp-2025-audit | Skill | No published scan yet |
| windows-desktop-e2e | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| workspace-surface-audit | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| x-api | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| yoruba-localization-testing | Skill | No published scan yet |

<a name="family-egm"></a>

### Elephant-Goldfish Model

| Name | Type | Published scans |
| --- | --- | --- |
| egm-bootstrap-orchestrator | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| egm-codebase-details | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| egm-comprehension | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| egm-design | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| egm-implementation-readiness | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| egm-inventive-catalyst | Agent | No published scan yet |
| egm-structural | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| egm-style | Agent | No published scan yet |
| egm-synthesizer | Agent | No published scan yet |
| egm-zoom-out | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| egm-bootstrap | Skill | No published scan yet |
| egm-brainstorm | Skill | No published scan yet |
| egm-draft | Skill | No published scan yet |
| egm-drift-report | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| egm-lite | Skill | No published scan yet |
| egm-resolve | Skill | No published scan yet |
| egm-review | Skill | No published scan yet |
| egm-review-loop | Skill | No published scan yet |
| egm.runtime | Runtime bundle | No published scan yet |
| / | Plugin | No published scan yet |
| / | Full plugin folder | No published scan yet |

<a name="family-extensions"></a>

### AIH Extensions

| Name | Type | Published scans |
| --- | --- | --- |
| code-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security-auditor | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| test-engineer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| web-performance-auditor | Agent | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| git-guard | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| git-guard | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| lanes-card | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| lanes-card | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| skill-guard | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| skill-guard | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| api-and-interface-design | Skill | No published scan yet |
| ask-sam | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| browser-testing-with-devtools | Skill | No published scan yet |
| ci-cd-and-automation | Skill | No published scan yet |
| code-simplification | Skill | No published scan yet |
| constraint-driven-development | Skill | No published scan yet |
| deprecation-and-migration | Skill | No published scan yet |
| documentation-and-adrs | Skill | No published scan yet |
| doubt-driven-development | Skill | No published scan yet |
| ask-matt | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| code-review | Skill | No published scan yet |
| codebase-design | Skill | No published scan yet |
| diagnosing-bugs | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| domain-modeling | Skill | No published scan yet |
| grill-with-docs | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| implement | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| implement-spec | Skill | No published scan yet |
| improve-codebase-architecture | Skill | No published scan yet |
| pr | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| prototype | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| research | Skill | No published scan yet |
| retro | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| setup-matt-pocock-skills | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| tdd | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| to-spec | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| to-tickets | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| triage | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| wayfinder | Skill | No published scan yet |
| wizard | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| frontend-ui-engineering | Skill | No published scan yet |
| git-workflow-and-versioning | Skill | No published scan yet |
| idea-refine | Skill | No published scan yet |
| chief-of-staff | Skill | No published scan yet |
| claude-handoff | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| loop-me | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| setup-ts-deep-modules | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| software-factory | Skill | No published scan yet |
| writing-beats | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| writing-fragments | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| writing-shape | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| install-commit-gate | Skill | No published scan yet |
| git-guardrails-claude-code | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · DO NOT INSTALL · Complete ([Nov 25, 2026][release-2]) |
| migrate-to-shoehorn | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| scaffold-exercises | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| observability-and-instrumentation | Skill | No published scan yet |
| performance-optimization | Skill | No published scan yet |
| grill-me | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| grilling | Skill | No published scan yet |
| handoff | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| teach | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| to-questionnaire | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| wait-what | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| writing-for-agents | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security-and-hardening | Skill | No published scan yet |
| setup-pre-commit | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ship | Skill | No published scan yet |
| shipping-and-launch | Skill | No published scan yet |
| source-driven-development | Skill | No published scan yet |
| webperf | Skill | No published scan yet |
| extensions.references | Runtime bundle | No published scan yet |

<a name="family-gstack"></a>

### gstack

| Name | Type | Published scans |
| --- | --- | --- |
| autoplan | Skill | No published scan yet |
| benchmark | Skill | No published scan yet |
| benchmark-models | Skill | No published scan yet |
| browse | Skill | No published scan yet |
| build-check | Skill | No published scan yet |
| canary | Skill | No published scan yet |
| captain | Skill | No published scan yet |
| careful | Skill | No published scan yet |
| codex | Skill | No published scan yet |
| context-restore | Skill | No published scan yet |
| context-save | Skill | No published scan yet |
| design-consultation | Skill | No published scan yet |
| design-html | Skill | No published scan yet |
| design-motion | Skill | No published scan yet |
| design-review | Skill | No published scan yet |
| design-shotgun | Skill | No published scan yet |
| deslop-shared-libs | Skill | No published scan yet |
| devex-review | Skill | No published scan yet |
| diagram | Skill | No published scan yet |
| document-generate | Skill | No published scan yet |
| document-release | Skill | No published scan yet |
| eval-plan | Skill | No published scan yet |
| freeze | Skill | No published scan yet |
| gstack-upgrade | Skill | No published scan yet |
| guard | Skill | No published scan yet |
| health | Skill | No published scan yet |
| ios-clean | Skill | No published scan yet |
| ios-design-review | Skill | No published scan yet |
| ios-fix | Skill | No published scan yet |
| ios-qa | Skill | No published scan yet |
| ios-sync | Skill | No published scan yet |
| land-and-deploy | Skill | No published scan yet |
| landing-report | Skill | No published scan yet |
| learn | Skill | No published scan yet |
| make-pdf | Skill | No published scan yet |
| modernize | Skill | No published scan yet |
| office-hours | Skill | No published scan yet |
| open-gstack-browser | Skill | No published scan yet |
| pair-agent | Skill | No published scan yet |
| plan-ceo-review | Skill | No published scan yet |
| plan-design-review | Skill | No published scan yet |
| plan-devex-review | Skill | No published scan yet |
| plan-eng-review | Skill | No published scan yet |
| plan-tune | Skill | No published scan yet |
| qa | Skill | No published scan yet |
| qa-only | Skill | No published scan yet |
| retro | Skill | No published scan yet |
| review | Skill | No published scan yet |
| runaway-stopper | Skill | No published scan yet |
| scrape | Skill | No published scan yet |
| setup-browser-cookies | Skill | No published scan yet |
| setup-deploy | Skill | No published scan yet |
| setup-gbrain | Skill | No published scan yet |
| gstack-ship | Skill | No published scan yet |
| skillify | Skill | No published scan yet |
| spec | Skill | No published scan yet |
| sync-gbrain | Skill | No published scan yet |
| test-audit | Skill | No published scan yet |
| ubicloud | Skill | No published scan yet |
| unfreeze | Skill | No published scan yet |
| write-skill | Skill | No published scan yet |

<a name="family-guide"></a>

### AIH Guide

| Name | Type | Published scans |
| --- | --- | --- |
| aih-guide | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| aih-guide | Kimi edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| aih-guide | OpenCode edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| manual | Document | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |

<a name="family-modern-web-guidance"></a>

### Google Chrome Modern Web Guidance

| Name | Type | Published scans |
| --- | --- | --- |
| chrome-extensions | Skill | No published scan yet |
| modern-web-guidance | Skill | No published scan yet |

<a name="family-project-basics"></a>

### Project basics

| Name | Type | Published scans |
| --- | --- | --- |
| rule-router | Document | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| agent-behavior-core | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| shared-block | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |

<a name="family-pstack"></a>

### pstack

| Name | Type | Published scans |
| --- | --- | --- |
| comment-sicko | Agent | No published scan yet |
| comment-sicko | Claude Code edition | No published scan yet |
| poteto-agent | Agent | No published scan yet |
| poteto-agent | Claude Code edition | No published scan yet |
| architect | Skill | No published scan yet |
| architect | Claude Code edition | No published scan yet |
| arena | Skill | No published scan yet |
| arena | Claude Code edition | No published scan yet |
| automate-me | Skill | No published scan yet |
| automate-me | Claude Code edition | No published scan yet |
| benchmark-checklist | Skill | No published scan yet |
| benchmark-checklist | Claude Code edition | No published scan yet |
| blast-radius | Skill | No published scan yet |
| blast-radius | Claude Code edition | No published scan yet |
| bro | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| bro | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| correct | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| correct | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| create-formal-verification-skill | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| create-formal-verification-skill | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| create-verification-skill | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| create-verification-skill | Claude Code edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| figure-it-out | Skill | No published scan yet |
| figure-it-out | Claude Code edition | No published scan yet |
| how | Skill | No published scan yet |
| how | Claude Code edition | No published scan yet |
| in-your-own-words | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| in-your-own-words | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| interrogate | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| interrogate | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ketchup | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ketchup | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ketchup-video | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ketchup-video | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| maintain-formal-verification-skill | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| maintain-formal-verification-skill | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| maintain-verification-skill | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| maintain-verification-skill | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| make-bot-ui | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · DO NOT INSTALL · Complete ([Nov 25, 2026][release-2]) |
| make-bot-ui | Claude Code edition | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · DO NOT INSTALL · Complete ([Nov 25, 2026][release-2]) |
| no-comments | Skill | No published scan yet |
| no-comments | Claude Code edition | No published scan yet |
| poteto-help | Skill | No published scan yet |
| poteto-help | Claude Code edition | No published scan yet |
| poteto-mode | Skill | No published scan yet |
| poteto-mode | Claude Code edition | No published scan yet |
| principle-attack-the-premise | Skill | No published scan yet |
| principle-attack-the-premise | Claude Code edition | No published scan yet |
| principle-boundary-discipline | Skill | No published scan yet |
| principle-boundary-discipline | Claude Code edition | No published scan yet |
| principle-build-the-lever | Skill | No published scan yet |
| principle-build-the-lever | Claude Code edition | No published scan yet |
| principle-encode-lessons-in-structure | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-encode-lessons-in-structure | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-exhaust-the-design-space | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-exhaust-the-design-space | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-experience-first | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-experience-first | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-explain-the-number | Skill | No published scan yet |
| principle-explain-the-number | Claude Code edition | No published scan yet |
| principle-fix-root-causes | Skill | No published scan yet |
| principle-fix-root-causes | Claude Code edition | No published scan yet |
| principle-foundational-thinking | Skill | No published scan yet |
| principle-foundational-thinking | Claude Code edition | No published scan yet |
| principle-guard-the-context-window | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-guard-the-context-window | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-laziness-protocol | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-laziness-protocol | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-make-operations-idempotent | Skill | No published scan yet |
| principle-make-operations-idempotent | Claude Code edition | No published scan yet |
| principle-migrate-callers-then-delete-legacy-apis | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-migrate-callers-then-delete-legacy-apis | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-minimize-reader-load | Skill | No published scan yet |
| principle-minimize-reader-load | Claude Code edition | No published scan yet |
| principle-model-the-domain | Skill | No published scan yet |
| principle-model-the-domain | Claude Code edition | No published scan yet |
| principle-never-block-on-the-human | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-never-block-on-the-human | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-outcome-oriented-execution | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-outcome-oriented-execution | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-prove-it-works | Skill | No published scan yet |
| principle-prove-it-works | Claude Code edition | No published scan yet |
| principle-redesign-from-first-principles | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-redesign-from-first-principles | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-separate-before-serializing-shared-state | Skill | No published scan yet |
| principle-separate-before-serializing-shared-state | Claude Code edition | No published scan yet |
| principle-sequence-verifiable-units | Skill | No published scan yet |
| principle-sequence-verifiable-units | Claude Code edition | No published scan yet |
| principle-subtract-before-you-add | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-subtract-before-you-add | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-test-behavior-not-implementation | Skill | No published scan yet |
| principle-test-behavior-not-implementation | Claude Code edition | No published scan yet |
| principle-type-system-discipline | Skill | No published scan yet |
| principle-type-system-discipline | Claude Code edition | No published scan yet |
| recall | Skill | No published scan yet |
| recall | Claude Code edition | No published scan yet |
| reflect | Skill | No published scan yet |
| reflect | Claude Code edition | No published scan yet |
| reframe | Skill | No published scan yet |
| reframe | Claude Code edition | No published scan yet |
| setup-pstack | Skill | No published scan yet |
| setup-pstack | Claude Code edition | No published scan yet |
| sharpen | Skill | No published scan yet |
| sharpen | Claude Code edition | No published scan yet |
| show-me-your-work | Skill | No published scan yet |
| show-me-your-work | Claude Code edition | No published scan yet |
| statechart | Skill | No published scan yet |
| statechart | Claude Code edition | No published scan yet |
| swarm | Skill | No published scan yet |
| swarm | Claude Code edition | No published scan yet |
| tdd | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| tdd | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| teach | Skill | No published scan yet |
| teach | Claude Code edition | No published scan yet |
| technical-writing | Skill | No published scan yet |
| technical-writing | Claude Code edition | No published scan yet |
| typescript-best-practices | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| typescript-best-practices | Claude Code edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| unslop | Skill | No published scan yet |
| unslop | Claude Code edition | No published scan yet |
| why | Skill | No published scan yet |
| why | Claude Code edition | No published scan yet |

<a name="family-serena"></a>

### Serena

| Name | Type | Published scans |
| --- | --- | --- |
| serena | AI setup | [See qualifications](../README.md#data) |
| serena | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |

<a name="family-superpowers"></a>

### Superpowers

| Name | Type | Published scans |
| --- | --- | --- |
| session-start | Hook | No published scan yet |
| session-start | Claude Code edition | No published scan yet |
| session-bootstrap | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| brainstorming | Skill | No published scan yet |
| diagnosing-superpowers | Skill | No published scan yet |
| dispatching-parallel-agents | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| executing-plans | Skill | No published scan yet |
| finishing-a-development-branch | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| receiving-code-review | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| requesting-code-review | Skill | No published scan yet |
| subagent-driven-development | Skill | No published scan yet |
| systematic-debugging | Skill | No published scan yet |
| test-driven-development | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| using-git-worktrees | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| using-superpowers | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · DO NOT INSTALL · Complete ([Nov 25, 2026][release-2]) |
| verification-before-completion | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| writing-plans | Skill | No published scan yet |
| writing-skills | Skill | No published scan yet |
| / | Plugin | No published scan yet |

<a name="family-web-artifacts"></a>

### Web artifacts

| Name | Type | Published scans |
| --- | --- | --- |
| web-artifacts-builder-modern | Skill | No published scan yet |

## Sources and refresh

- Catalog data revision [`3c1d0dbc5058`](https://github.com/samartomar/aih-catalog/tree/3c1d0dbc50581bee0a682acb1c2183df94f7a2b8/data).
- [Nov 4, 2026][release-1] (`scan-catalog-results-20261104-e935f39b9f3148a5`). Index SHA-256 `8f26f56299fdcb8ab449f5f045a81e8d445a5bc7cb4a1e5ac7fc1ee23192eb27`.
- [Nov 25, 2026][release-2] (`scan-catalog-results-20261125-static-r2-4c41927d737cbb61`). Index SHA-256 `3dbccb92bfc9a8d66c4d5162cb612750cf784da5690cc49ff6b2dc2865b3787f`.

The generator checks SHA-256 for each downloaded index, archive and summary. It matches summaries by exact Scan key and shows the newest revision for each scan type. For signature verification and more on what a rating or completeness means, see [Scan's instructions](https://github.com/samartomar/aih-scan#signing-and-verification).

From a current Catalog checkout with Git, Node.js 26 and an authenticated GitHub CLI (`gh`), run the commands below. The generator reads the committed Catalog data and public Scan releases. Review the regenerated report and lookup CSV before committing them.

```sh
npm ci --ignore-scripts
npm run build:dist
node tools/catalog-scan-coverage.mjs --write
```

To reproduce this snapshot, run the same generator with the exact revision and release tags. It prints the Markdown to standard output. Add `--csv` to print the lookup instead.

```sh
node tools/catalog-scan-coverage.mjs --catalog 3c1d0dbc50581bee0a682acb1c2183df94f7a2b8 \
  --release scan-catalog-results-20261104-e935f39b9f3148a5 \
  --release scan-catalog-results-20261125-static-r2-4c41927d737cbb61
```

[release-1]: https://github.com/samartomar/aih-scan/releases/tag/scan-catalog-results-20261104-e935f39b9f3148a5
[release-2]: https://github.com/samartomar/aih-scan/releases/tag/scan-catalog-results-20261125-static-r2-4c41927d737cbb61
