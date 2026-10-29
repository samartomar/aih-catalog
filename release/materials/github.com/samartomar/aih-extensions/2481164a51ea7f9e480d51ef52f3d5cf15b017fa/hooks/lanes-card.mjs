#!/usr/bin/env node
// SessionStart (startup|clear|compact): inject the short routing note.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const text = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'lanes.md'), 'utf8').trim();
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
