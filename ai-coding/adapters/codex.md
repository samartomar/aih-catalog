# Codex adapter

Codex reads `AGENTS.md`, then `ai-coding/RULE_ROUTER.md`. `npm run repo:init`
uses the native Codex plugin lifecycle and writes the ignored project-local
`.codex/config.toml` with narrow MCP allowlists. Never run an installed
aih-supported against this checkout.
