# Catalog Scan coverage

**990 of 1,069 Catalog versions have a published scan. 79 await one.**

This snapshot covers 960 items across 14 families, including client editions, runtime bundles and plugin folders. See the [sources and refresh instructions](#sources-and-refresh).

- **Published scans** show the scan's risk rating and whether inspection was complete or partial for its selected tools. Static scans use file-based checks. AI scans also use a model. The installation decision stays with you or your organization.
- **No published scan yet** means this snapshot found no public report for that version.
- **See qualifications** points to platform-specific evidence for an AI setup with no Scan key.

## Families

Items and editions that share the same files, paths and modes count as one version. The overall row counts versions shared across families once.

| Family | Items | Versions | Published | Pending | AI setups with qualifications |
| --- | ---: | ---: | ---: | ---: | ---: |
| **All families** | 960 | 1,069 | 990 | 79 | 3 |
| [Anthropic skills](#family-anthropic) | 18 | 24 | 17 | 7 | 0 |
| [codebase-memory-mcp](#family-cbm) | 2 | 1 | 1 | 0 | 1 |
| [code-review-graph](#family-crg) | 9 | 8 | 8 | 0 | 1 |
| [ECC](#family-ecc) | 698 | 775 | 746 | 29 | 0 |
| [Elephant-Goldfish Model](#family-egm) | 18 | 21 | 18 | 3 | 0 |
| [AIH Extensions](#family-extensions) | 66 | 67 | 61 | 6 | 0 |
| [gstack](#family-gstack) | 61 | 61 | 38 | 23 | 0 |
| [AIH Guide](#family-guide) | 2 | 4 | 4 | 0 | 0 |
| [Google Chrome Modern Web Guidance](#family-modern-web-guidance) | 2 | 2 | 0 | 2 | 0 |
| [Project basics](#family-project-basics) | 3 | 3 | 3 | 0 | 0 |
| [pstack](#family-pstack) | 61 | 83 | 80 | 3 | 0 |
| [Serena](#family-serena) | 2 | 1 | 1 | 0 | 1 |
| [Superpowers](#family-superpowers) | 17 | 18 | 12 | 6 | 0 |
| [Web artifacts](#family-web-artifacts) | 1 | 1 | 1 | 0 | 0 |

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
| doc-coauthoring · upstream-only | Skill | Static · SAFE · Complete ([Nov 26, 2026][release-5]) |
| docx | Skill | Static · DO NOT INSTALL · Complete ([Nov 27, 2026][release-6]) |
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
| xlsx | Skill | Static · CAUTION · Complete ([Nov 27, 2026][release-6]) |
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
| agent-evaluator | Agent | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| architect | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| architect | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| bengali-reviewer | Agent | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
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
| commit-reviewer | Agent | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
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
| e2e-runner | Agent | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| e2e-runner | Kiro edition | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| fastapi-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| flutter-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| fsharp-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| fsharp-reviewer | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| gan-evaluator | Agent | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| gan-generator | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| gan-planner | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| gdscript-reviewer | Agent | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| go-build-resolver | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| go-build-resolver | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| go-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| go-reviewer | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| harmonyos-app-resolver | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| harness-optimizer | Agent | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
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
| opensource-forker | Agent | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| opensource-packager | Agent | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| opensource-sanitizer | Agent | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
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
| rag-pipeline-reviewer | Agent | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| react-build-resolver | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| react-build-resolver | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| react-reviewer | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| react-reviewer | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| refactor-cleaner | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| refactor-cleaner | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ruby-reviewer | Agent | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
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
| typescript-reviewer | Agent | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
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
| post-dispatcher-async | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| post-dispatcher-async | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| post-dispatcher-sync | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| post-dispatcher-sync | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| post-mcp-health-check | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| post-mcp-health-check | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| post-skill-track | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| post-skill-track | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-bash-dispatcher | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-bash-dispatcher | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-compact | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-compact | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-config-protection | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-config-protection | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-edit-write-gateguard-fact-force | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-edit-write-gateguard-fact-force | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-edit-write-suggest-compact | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-edit-write-suggest-compact | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-governance-capture | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-governance-capture | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-hookify-runtime | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-hookify-runtime | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-mcp-health-check | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-mcp-health-check | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-observe-continuous-learning | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-observe-continuous-learning | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-powershell-gateguard-fact-force | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-powershell-gateguard-fact-force | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-write-doc-file-warning | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pre-write-doc-file-warning | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| prompt-hookify-runtime | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| prompt-hookify-runtime | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| python-lint-on-edit | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| python-lint-on-edit | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| quality-gate | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| quality-gate | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-check-on-edit | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-check-on-edit | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security-check-on-create | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security-check-on-create | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| session-end-marker | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| session-end-marker | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| session-start | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| session-start | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| session-start | Codex edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| session-start-plan-canvas-sessions | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| session-start-plan-canvas-sessions | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| session-summary | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| session-summary | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| stop-check-console-log | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| stop-check-console-log | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| stop-cost-tracker | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| stop-cost-tracker | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| stop-desktop-notify | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| stop-desktop-notify | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| stop-evaluate-session | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| stop-evaluate-session | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| stop-format-typecheck | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| stop-format-typecheck | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| stop-hookify-runtime | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| stop-hookify-runtime | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| stop-plan-canvas-pending | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| stop-plan-canvas-pending | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| stop-session-end | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| stop-session-end | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| tdd-reminder | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| tdd-reminder | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| typecheck-on-edit | Hook | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| typecheck-on-edit | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| user-prompt-context-gate | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| user-prompt-context-gate | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| arcmira | MCP server | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| browser-use | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| clickhouse | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cloudflare-docs | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cloudflare-observability | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cloudflare-workers-bindings | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cloudflare-workers-builds | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| codescene | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| confluence | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| context7 | MCP server | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| deja-vu | MCP server | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
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
| mnemosyne-os | MCP server | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
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
| agents | Rule | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| code-review | Rule | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| coding-style · common | Rule | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| development-workflow · common | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| git-workflow · common | Rule | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| hooks · common | Rule | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| patterns · common | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| performance · common | Rule | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
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
| testing · csharp | Rule | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
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
| security · ruby | Rule | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| testing · ruby | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · rust | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hooks · rust | Rule | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| patterns · rust | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security · rust | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · rust | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-style · steering | Rule | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| coding-style · steering | Kiro edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| cpp-patterns | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cpp-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| dev-mode | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| dev-mode | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| development-workflow · steering | Rule | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| development-workflow · steering | Kiro edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| git-workflow · steering | Rule | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| git-workflow · steering | Kiro edition | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| golang-patterns | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| golang-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| java-patterns | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| java-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| kotlin-patterns | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| kotlin-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| lessons-learned | Rule | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| lessons-learned | Kiro edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| patterns · steering | Rule | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| patterns · steering | Kiro edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| performance · steering | Rule | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| performance · steering | Kiro edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
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
| security · steering | Rule | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| security · steering | Kiro edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| swift-patterns | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| swift-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| testing · steering | Rule | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| testing · steering | Kiro edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
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
| accessibility | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| agent-architecture-audit | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| agent-eval | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| agent-harness-construction | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| agent-introspection-debugging | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| agent-payment-x402 | Skill | No published scan yet |
| agent-runtime-gateway-smoke-test | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| agent-security-hardening | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| agent-self-evaluation | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| agent-sort | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| agentic-engineering | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| agentic-engineering | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| agentic-os | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| ai-first-engineering | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ai-regression-testing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| android-clean-architecture | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| angular-developer | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1]) |
| api-connector-builder | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| api-design | Skill | No published scan yet |
| api-design | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| architecture-decision-records | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| article-writing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| aside | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| astra-review | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| auto-update | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| automation-audit-ops | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| autonomous-agent-harness | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| autonomous-loops | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| autonomous-loops | Kiro edition | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| backend-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| backend-patterns | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| benchmark | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| benchmark-methodology | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| benchmark-optimization-loop | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| bengali-nlp | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| blender-motion-state-inspection | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| blueprint | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| brand-discovery | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| brand-voice | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| brownfield-retrospective | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| browser-qa | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| build-fix | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| bun-runtime | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| canary-watch | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| carrier-relationship-management · upstream-only | Skill | Static · SAFE · Complete ([Nov 26, 2026][release-5]) |
| change-impact | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| checkpoint | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cisco-ios-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ck | Skill | No published scan yet |
| click-path-audit | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| clickhouse-io | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| code-review | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| code-tour | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| codebase-onboarding | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| codehealth-mcp | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-standards | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| coding-standards | Kiro edition | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| competitive-platform-analysis | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| competitive-report-structure | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| compose-multiplatform-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| config-gc | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| config-health | Skill | No published scan yet |
| configure-ecc | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| connections-optimizer | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| content-engine | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| content-hash-cache-pattern | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| content-hash-cache-pattern | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| context-and-decisions | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| context-budget | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| continuous-agent-loop | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| continuous-learning | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| continuous-learning-v2 | Skill | No published scan yet |
| contract-first | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| conventional-commit-review | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| cost-aware-llm-pipeline | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| cost-report | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| cost-tracking | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| council | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| council-multi-model | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| counterparty-channel-discipline | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
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
| customs-trade-compliance · upstream-only | Skill | Static · SAFE · Complete ([Nov 26, 2026][release-5]) |
| dart-flutter-patterns | Skill | No published scan yet |
| dashboard-builder | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| data-scraper-agent | Skill | No published scan yet |
| data-throughput-accelerator | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| database-migrations | Skill | No published scan yet |
| database-migrations | Kiro edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| deep-research | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| deep-research | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| deepseek-harness-setup | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| defi-amm-security | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| delivery-gate | Skill | Static · DO NOT INSTALL · Complete ([Nov 27, 2026][release-4]) |
| deployment-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| deployment-patterns | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| design-system | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| dev-team | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| devfleet | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| django-celery | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| django-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| django-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| django-security | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| django-security | Kiro edition | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| django-tdd | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| django-verification | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| dmux-workflows | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| docker-patterns | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| docker-patterns | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| docs-governance | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| documentation-lookup | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| dotnet-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| dynamic-workflow-mode | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| e2e-testing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| e2e-testing | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ecc-contribution-review | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| ecc-guide | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| ecc-recipes | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| ecc-tools-cost-audit | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| email-ops | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| energy-procurement · upstream-only | Skill | Static · SAFE · Complete ([Nov 26, 2026][release-5]) |
| enterprise-agent-ops | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| epic-claim | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| epic-decompose | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| epic-publish | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| epic-review | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| epic-sync | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| epic-unblock | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| epic-validate | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| error-handling | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| esign-field-placement | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| eval-harness | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| evm-token-decimals | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| evolve | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| exa-search | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| fal-ai-media | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
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
| frontend-a11y | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
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
| git-workflow | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| github-ops | Skill | No published scan yet |
| go-build | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| go-review | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| go-test | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| godot-patterns | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| godot-testing | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| golang-patterns | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| golang-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| golang-testing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| golang-testing | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| google-workspace-ops | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| gradle-build | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| growth-log | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| harness-audit | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| healthcare-cdss-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| healthcare-emr-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| healthcare-eval-harness | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| healthcare-phi-compliance | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| hermes-imports | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hexagonal-architecture | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| hipaa-compliance | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| homelab-network-readiness | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| homelab-network-setup | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| homelab-pihole-dns | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · DO NOT INSTALL · Complete ([Nov 25, 2026][release-2]) |
| homelab-vlan-segmentation | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| homelab-wireguard-vpn | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1]) |
| hookify | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| hookify-configure | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| hookify-help | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| hookify-list | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| hookify-rules | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| i18n-sync | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| inherit-legacy-style | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| instinct-export | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| instinct-import | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| instinct-status | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| intent-driven-development | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| inventory-demand-planning · upstream-only | Skill | Static · CAUTION · Complete ([Nov 26, 2026][release-5]) |
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
| kubernetes-patterns | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| laravel-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| laravel-plugin-discovery | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| laravel-security | Skill | No published scan yet |
| laravel-tdd | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| laravel-verification | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| latency-critical-systems | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| lead-intelligence | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| leanrea | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| learn | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| learn-eval | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| liquid-glass-design | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| living-docs-governance | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| llm-trading-agent-security | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| logistics-exception-management · upstream-only | Skill | Static · SAFE · Complete ([Nov 26, 2026][release-5]) |
| loop-design-check | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| loop-start | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| loop-status | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| mailtrap-email-integration | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| make-interfaces-feel-better | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| manim-video | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| market-research | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| marketing-campaign | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| master-agreement-generator | Skill | No published scan yet |
| mcp-dependency-review | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| mcp-server-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| messages-ops | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ml-adoption-playbook | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| mle-workflow | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| mle-workflow | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| model-route | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| module-governance | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| module-regression | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| motion-advanced | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| motion-foundations | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| motion-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| multi-backend | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| multi-execute | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| multi-frontend | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| multi-plan | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| multi-workflow | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| mybatis-patterns | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| mysql-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| nanoclaw-repl | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| nasiko-control-plane | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| nestjs-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| nestjs-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| netmiko-ssh-automation | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| network-bgp-diagnostics | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| network-config-validation | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| network-interface-health | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| nextjs-turbopack | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| nextjs-turbopack | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| nodejs-keccak256 | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| nutrient-document-processing | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| nuxt4-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| openclaw-persona-forge | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| opensource-pipeline | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| operator-approval-loop | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| orch-add-feature | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| orch-build-mvp | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| orch-change-feature | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| orch-fix-defect | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| orch-pipeline | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| orch-refine-code | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| orch-review | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| osint-investigation | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| parallel-execution-optimizer | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| perl-patterns | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| perl-security | Skill | No published scan yet |
| perl-testing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| plan | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| plan-canvas | Skill | No published scan yet |
| plan-orchestrate | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| plan-prd | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| plankton-code-quality | Skill | Static · SAFE · Complete ([Nov 27, 2026][release-4]) |
| platform-factory | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pm2 | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| postgres-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| postgres-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| pr | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| prediction-market-oracle-research | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| prediction-market-risk-review | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| prisma-patterns | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| product-capability | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| product-lens | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| production-audit | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| production-scheduling · upstream-only | Skill | Static · SAFE · Complete ([Nov 26, 2026][release-5]) |
| project-flow-ops | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| project-init | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| projects | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| promote | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| prompt-caching-strategy | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| prompt-optimizer | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| prp-commit | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| prp-implement | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| prp-plan | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| prp-pr | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| prp-prd | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| prune | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| python-patterns | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| python-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| python-review | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| python-testing | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| python-testing | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| pytorch-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| pytorch-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| quality-gate | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| quality-nonconformance · upstream-only | Skill | Static · SAFE · Complete ([Nov 26, 2026][release-5]) |
| quarkus-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| quarkus-security | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| quarkus-tdd | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| quarkus-verification | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| rails-patterns | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| rails-security | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| ralphinho-rfc-pipeline | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
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
| recursive-decision-ledger | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| redis-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| refactor-clean | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| regex-vs-llm-structured-text | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| remotion-video-creation | Skill | No published scan yet |
| repo-scan | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| research-ops | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| resume-session | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| returns-reverse-logistics · upstream-only | Skill | No published scan yet |
| review-pr | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| roundhouse-x402 | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| rules-distill | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-build | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| rust-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-review | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| rust-test | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-testing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| rust-testing | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| safety-guard | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| santa-loop | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| santa-method | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| save-session | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| scientific-db-openalex-database | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| scientific-db-pubmed-database | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| scientific-db-uspto-database | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| scientific-pkg-gget | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| scientific-thinking-literature-review | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| scientific-thinking-scholar-evaluation | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| search-first | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| search-first | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security-bounty-hunter | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security-review | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| security-review | Kiro edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| security-scan | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| seo | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| sessions | Skill | No published scan yet |
| setup-pm | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| short-video-distribution | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| skill-comply | Skill | No published scan yet |
| skill-create | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| skill-health | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| skill-host-compat | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| skill-scout | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| skill-stocktake | Skill | No published scan yet |
| social-graph-ranker | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| social-publisher | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| springboot-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| springboot-patterns | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| springboot-security | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| springboot-security | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| springboot-tdd | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| springboot-verification | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| story-lifecycle | Skill | No published scan yet |
| strategic-compact | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| strategic-compact | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| swift-actor-persistence | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| swift-actor-persistence | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| swift-concurrency-6-2 | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| swift-protocol-di-testing | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| swift-protocol-di-testing | Kiro edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| swiftui-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| taste | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| taste-application | Skill | No published scan yet |
| taste-distillation | Skill | Static · DO NOT INSTALL · Complete ([Nov 26, 2026][release-5]) |
| tasteforge-video | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| tdd-workflow | Skill | No published scan yet |
| tdd-workflow | Kiro edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| team-agent-orchestration | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| team-builder | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| terminal-opener | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| terminal-ops | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| terraform-patterns | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| test-collaboration | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| test-coverage | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| tinystruct-patterns | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| token-budget-advisor | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| token-card | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| typescript-patterns | Skill | No published scan yet |
| ui-canvas | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| ui-demo | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| ui-to-vue | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| uncloud | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| unified-memory | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| unified-notifications-ops | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| update-codemaps | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| update-docs | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| verification-loop | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| verification-loop | Kiro edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| video-editing | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| videodb | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| visa-doc-translate | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| vite-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1]) |
| vue-patterns | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| vue-review | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| web-perimeter-owasp-2025-audit | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| windows-desktop-e2e | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| workspace-surface-audit | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| x-api | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| yoruba-localization-testing | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |

<a name="family-egm"></a>

### Elephant-Goldfish Model

| Name | Type | Published scans |
| --- | --- | --- |
| egm-bootstrap-orchestrator | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| egm-codebase-details | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| egm-comprehension | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| egm-design | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| egm-implementation-readiness | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| egm-inventive-catalyst | Agent | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| egm-structural | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| egm-style | Agent | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| egm-synthesizer | Agent | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| egm-zoom-out | Agent | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| egm-bootstrap | Skill | No published scan yet |
| egm-brainstorm | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| egm-draft | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| egm-drift-report | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| egm-lite | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| egm-resolve | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| egm-review | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| egm-review-loop | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| egm.runtime | Runtime bundle | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
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
| browser-testing-with-devtools | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| ci-cd-and-automation | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| code-simplification | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| constraint-driven-development | Skill | No published scan yet |
| deprecation-and-migration | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| documentation-and-adrs | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| doubt-driven-development | Skill | No published scan yet |
| ask-matt | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| code-review | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| codebase-design | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| diagnosing-bugs | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| domain-modeling | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| grill-with-docs | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| implement | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| implement-spec | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| improve-codebase-architecture | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| pr | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| prototype | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| research | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| retro | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| setup-matt-pocock-skills | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| tdd | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| to-spec | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| to-tickets | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| triage | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| wayfinder | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| wizard | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · CAUTION · Complete ([Nov 25, 2026][release-2]) |
| frontend-ui-engineering | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| git-workflow-and-versioning | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| idea-refine | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| chief-of-staff | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| claude-handoff | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| loop-me | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| setup-ts-deep-modules | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| software-factory | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| writing-beats | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| writing-fragments | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| writing-shape | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| install-commit-gate | Skill | No published scan yet |
| git-guardrails-claude-code | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · DO NOT INSTALL · Complete ([Nov 25, 2026][release-2]) |
| migrate-to-shoehorn | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| scaffold-exercises | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| observability-and-instrumentation | Skill | No published scan yet |
| performance-optimization | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| grill-me | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| grilling | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| handoff | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| teach | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| to-questionnaire | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| wait-what | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| writing-for-agents | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| security-and-hardening | Skill | No published scan yet |
| setup-pre-commit | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| ship | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| shipping-and-launch | Skill | Static · CAUTION · Complete ([Nov 27, 2026][release-4]) |
| source-driven-development | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| webperf | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| extensions.references | Runtime bundle | Static · CAUTION · Complete ([Nov 27, 2026][release-4]) |

<a name="family-gstack"></a>

### gstack

| Name | Type | Published scans |
| --- | --- | --- |
| autoplan | Skill | No published scan yet |
| benchmark | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| benchmark-models | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| browse | Skill | No published scan yet |
| build-check | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| canary | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| captain | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| careful | Skill | No published scan yet |
| codex | Skill | No published scan yet |
| context-restore | Skill | No published scan yet |
| context-save | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| design-consultation | Skill | No published scan yet |
| design-html | Skill | No published scan yet |
| design-motion | Skill | Static · DO NOT INSTALL · Complete ([Nov 27, 2026][release-6]) |
| design-review | Skill | No published scan yet |
| design-shotgun | Skill | No published scan yet |
| deslop-shared-libs | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| devex-review | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| diagram | Skill | No published scan yet |
| document-generate | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| document-release | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| eval-plan | Skill | Static · DO NOT INSTALL · Complete ([Nov 27, 2026][release-6]) |
| freeze | Skill | No published scan yet |
| gstack-upgrade | Skill | No published scan yet |
| guard | Skill | Static · SAFE · Complete ([Nov 27, 2026][release-6]) |
| health | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| ios-clean | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| ios-design-review | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| ios-fix | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| ios-qa | Skill | No published scan yet |
| ios-sync | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| land-and-deploy | Skill | No published scan yet |
| landing-report | Skill | Static · DO NOT INSTALL · Complete ([Nov 27, 2026][release-6]) |
| learn | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| make-pdf | Skill | No published scan yet |
| modernize | Skill | Static · DO NOT INSTALL · Complete ([Nov 27, 2026][release-6]) |
| office-hours | Skill | Static · DO NOT INSTALL · Complete ([Nov 27, 2026][release-6]) |
| open-gstack-browser | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| pair-agent | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| plan-ceo-review | Skill | No published scan yet |
| plan-design-review | Skill | No published scan yet |
| plan-devex-review | Skill | Static · DO NOT INSTALL · Complete ([Nov 27, 2026][release-6]) |
| plan-eng-review | Skill | Static · DO NOT INSTALL · Complete ([Nov 27, 2026][release-6]) |
| plan-tune | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| qa | Skill | Static · DO NOT INSTALL · Complete ([Nov 27, 2026][release-6]) |
| qa-only | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| retro | Skill | Static · DO NOT INSTALL · Complete ([Nov 27, 2026][release-6]) |
| review | Skill | No published scan yet |
| runaway-stopper | Skill | No published scan yet |
| scrape | Skill | No published scan yet |
| setup-browser-cookies | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| setup-deploy | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| setup-gbrain | Skill | No published scan yet |
| gstack-ship | Skill | No published scan yet |
| skillify | Skill | Static · CAUTION · Complete ([Nov 27, 2026][release-6]) |
| spec | Skill | AI · DO NOT INSTALL · Complete ([Nov 26, 2026][release-3]) |
| sync-gbrain | Skill | No published scan yet |
| test-audit | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| ubicloud | Skill | Static · DO NOT INSTALL · Complete ([Nov 27, 2026][release-6]) |
| unfreeze | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| write-skill | Skill | Static · DO NOT INSTALL · Complete ([Nov 27, 2026][release-6]) |

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
| comment-sicko | Agent | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| comment-sicko | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| poteto-agent | Agent | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| poteto-agent | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| architect | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| architect | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| arena | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| arena | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| automate-me | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| automate-me | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| benchmark-checklist | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| benchmark-checklist | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| blast-radius | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| blast-radius | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| bro | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| bro | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| correct | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| correct | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| create-formal-verification-skill | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| create-formal-verification-skill | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| create-verification-skill | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| create-verification-skill | Claude Code edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| figure-it-out | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| figure-it-out | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| how | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| how | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
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
| no-comments | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| no-comments | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| poteto-help | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| poteto-help | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| poteto-mode | Skill | No published scan yet |
| poteto-mode | Claude Code edition | No published scan yet |
| principle-attack-the-premise | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-attack-the-premise | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-boundary-discipline | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-boundary-discipline | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-build-the-lever | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-build-the-lever | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-encode-lessons-in-structure | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-encode-lessons-in-structure | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-exhaust-the-design-space | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-exhaust-the-design-space | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-experience-first | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-experience-first | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-explain-the-number | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-explain-the-number | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-fix-root-causes | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-fix-root-causes | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-foundational-thinking | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-foundational-thinking | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-guard-the-context-window | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-guard-the-context-window | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-laziness-protocol | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-laziness-protocol | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-make-operations-idempotent | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-make-operations-idempotent | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-migrate-callers-then-delete-legacy-apis | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-migrate-callers-then-delete-legacy-apis | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-minimize-reader-load | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-minimize-reader-load | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-model-the-domain | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-model-the-domain | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-never-block-on-the-human | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-never-block-on-the-human | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-outcome-oriented-execution | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-outcome-oriented-execution | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-prove-it-works | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-prove-it-works | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-redesign-from-first-principles | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-redesign-from-first-principles | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-separate-before-serializing-shared-state | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-separate-before-serializing-shared-state | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-sequence-verifiable-units | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-sequence-verifiable-units | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-subtract-before-you-add | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-subtract-before-you-add | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| principle-test-behavior-not-implementation | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-test-behavior-not-implementation | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-type-system-discipline | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| principle-type-system-discipline | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| recall | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| recall | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| reflect | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| reflect | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| reframe | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| reframe | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| setup-pstack | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| setup-pstack | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| sharpen | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| sharpen | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| show-me-your-work | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| show-me-your-work | Claude Code edition | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| statechart | Skill | No published scan yet |
| statechart | Claude Code edition | No published scan yet |
| swarm | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| swarm | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| tdd | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| tdd | Claude Code edition | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| teach | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| teach | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| technical-writing | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| technical-writing | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| typescript-best-practices | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| typescript-best-practices | Claude Code edition | AI · CAUTION · Complete ([Nov 4, 2026][release-1]) |
| unslop | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| unslop | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| why | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| why | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |

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
| session-start | Hook | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| session-start | Claude Code edition | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| session-bootstrap | Rule | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| brainstorming | Skill | No published scan yet |
| diagnosing-superpowers | Skill | AI · CAUTION · Complete ([Nov 26, 2026][release-3]) |
| dispatching-parallel-agents | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| executing-plans | Skill | No published scan yet |
| finishing-a-development-branch | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| receiving-code-review | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| requesting-code-review | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| subagent-driven-development | Skill | No published scan yet |
| systematic-debugging | Skill | No published scan yet |
| test-driven-development | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| using-git-worktrees | Skill | AI · CAUTION · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| using-superpowers | Skill | AI · DO NOT INSTALL · Complete ([Nov 4, 2026][release-1])<br>Static · DO NOT INSTALL · Complete ([Nov 25, 2026][release-2]) |
| verification-before-completion | Skill | AI · SAFE · Complete ([Nov 4, 2026][release-1])<br>Static · SAFE · Complete ([Nov 25, 2026][release-2]) |
| writing-plans | Skill | AI · SAFE · Complete ([Nov 26, 2026][release-3]) |
| writing-skills | Skill | No published scan yet |
| / | Plugin | No published scan yet |

<a name="family-web-artifacts"></a>

### Web artifacts

| Name | Type | Published scans |
| --- | --- | --- |
| web-artifacts-builder-modern | Skill | Static · SAFE · Complete ([Nov 26, 2026][release-5]) |

## Sources and refresh

- Catalog data revision [`3c1d0dbc5058`](https://github.com/samartomar/aih-catalog/tree/3c1d0dbc50581bee0a682acb1c2183df94f7a2b8/data).
- [Nov 4, 2026][release-1] (`scan-catalog-results-20261104-e935f39b9f3148a5`). Index SHA-256 `8f26f56299fdcb8ab449f5f045a81e8d445a5bc7cb4a1e5ac7fc1ee23192eb27`.
- [Nov 25, 2026][release-2] (`scan-catalog-results-20261125-static-r2-4c41927d737cbb61`). Index SHA-256 `3dbccb92bfc9a8d66c4d5162cb612750cf784da5690cc49ff6b2dc2865b3787f`.
- [Nov 26, 2026][release-3] (`scan-catalog-results-20261126-ai-r1-d49d470d4176a239`). Index SHA-256 `5bb4c3f2370101db3f825942ee6f1aa8c8bd78d83db64e783867fb8780c0bb93`.
- [Nov 27, 2026][release-4] (`scan-catalog-results-20261126-static-r1-0fdb7e88c8fa3c9a`). Index SHA-256 `a23ddf8a0955feb3faca8812acfa81619cc8950fc25c64d06a104c80f650acbb`.
- [Nov 26, 2026][release-5] (`scan-catalog-results-20261126-static-r1-30f45461de2c9123`). Index SHA-256 `e00c040c52031d32d066554d542b5243abd333741237f67cb9b7048104128ea1`.
- [Nov 27, 2026][release-6] (`scan-catalog-results-20261126-static-r1-c59b6c6883bbab06`). Index SHA-256 `3c03f297ccedef6aad1e677c2af733696f74cc58a5e0f0fe96b6efcec44ad82e`.

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
  --release scan-catalog-results-20261125-static-r2-4c41927d737cbb61 \
  --release scan-catalog-results-20261126-ai-r1-d49d470d4176a239 \
  --release scan-catalog-results-20261126-static-r1-0fdb7e88c8fa3c9a \
  --release scan-catalog-results-20261126-static-r1-30f45461de2c9123 \
  --release scan-catalog-results-20261126-static-r1-c59b6c6883bbab06
```

[release-1]: https://github.com/samartomar/aih-scan/releases/tag/scan-catalog-results-20261104-e935f39b9f3148a5
[release-2]: https://github.com/samartomar/aih-scan/releases/tag/scan-catalog-results-20261125-static-r2-4c41927d737cbb61
[release-3]: https://github.com/samartomar/aih-scan/releases/tag/scan-catalog-results-20261126-ai-r1-d49d470d4176a239
[release-4]: https://github.com/samartomar/aih-scan/releases/tag/scan-catalog-results-20261126-static-r1-0fdb7e88c8fa3c9a
[release-5]: https://github.com/samartomar/aih-scan/releases/tag/scan-catalog-results-20261126-static-r1-30f45461de2c9123
[release-6]: https://github.com/samartomar/aih-scan/releases/tag/scan-catalog-results-20261126-static-r1-c59b6c6883bbab06
