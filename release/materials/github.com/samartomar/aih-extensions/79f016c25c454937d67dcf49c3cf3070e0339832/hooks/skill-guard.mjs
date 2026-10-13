#!/usr/bin/env node
// PreToolUse (Skill): Matt's `code-review` starts its own parallel sub-agents
// and `grilling` interviews the user; neither can work inside a sub-agent
// (for example one of /ship's reviewers). Refuse there and say what to do.
import fs from 'node:fs';

let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '')); } catch { process.exit(0); }
const full = String(input?.tool_input?.skill ?? '');
const name = full.slice(full.lastIndexOf(':') + 1);

if (input.agent_id && (name === 'code-review' || name === 'grilling')) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: `aih-extensions skill-guard: \`${name}\` ${name === 'grilling' ? 'interviews the user' : 'starts its own sub-agents'}, which a sub-agent cannot do. Finish your task and recommend \`${name}\` in your report so the main session runs it.` } }));
}
process.exit(0);
