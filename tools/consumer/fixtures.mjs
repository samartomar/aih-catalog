/**
 * Synthetic folders the journeys write themselves. They are fixtures: they establish package
 * behaviour only, never native client behaviour.
 */

/** Journey 1: your own folder, with material Catalog must list but never run. */
export const OWN_FOLDER = {
  LICENSE: "MIT Licence\n",
  "package.json":
    '{"name":"my-skills","version":"1.0.0","scripts":{"postinstall":"node -e \\"require(\'fs\').writeFileSync(\'RAN-postinstall\',\'\')\\""}}\n',
  "skills/revise/SKILL.md":
    "---\nname: revise\ndescription: Review the current change.\n---\n\nReview carefully against references/checklist.md.\n",
  "skills/revise/references/checklist.md": "- tests\n",
  "skills/revise/scripts/check.sh": { text: "#!/bin/sh\ntouch RAN-check\n", executable: true },
  "skills/ship/SKILL.md":
    "---\nname: ship\ndescription: Ship the change.\ndisable-model-invocation: true\n---\n\nShip $ARGUMENTS now.\n",
  "rules/style.md": "# Style\n\nUse two spaces.\n",
  "hooks/hooks.json":
    '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"touch RAN-hook"}]}]}}\n',
  "notes/ideas.txt": "Unsorted notes.\n",
};

/**
 * Journey 13: a skill with its own Claude edition and a runtime bundle, so the item, the
 * edition and the bundle each get a scan key. `prepare.mjs` computes Git's own tree hash of
 * each folder with `git write-tree`, independently of Scan and of Catalog.
 */
export const SCAN_FOLDER = {
  LICENSE: "Apache-2.0 placeholder notice for the fixture.\n",
  "skills/audit/SKILL.md":
    "---\nname: audit\ndescription: Audit the change.\n---\n\nAudit using agents/auditor.md and the steps in steps.md.\n",
  "skills/audit/steps.md": "1. Read.\n2. Check.\n",
  "skills/audit/run.sh": { text: "#!/bin/sh\necho audit\n", executable: true },
  "agents/auditor.md": "You audit changes.\n",
  "claude/skills/audit/SKILL.md":
    "---\nname: audit\ndescription: Audit the change.\nallowed-tools: Read\n---\n\nAudit using agents/auditor.md and the steps in steps.md.\n",
  "claude/skills/audit/steps.md": "1. Read.\n2. Check.\n",
};

/** The folders whose Git tree hashes journey 13 compares, as install-relative file sets. */
export const SCAN_TREES = {
  item: { "SKILL.md": "skills/audit/SKILL.md", "steps.md": "skills/audit/steps.md", "run.sh": "skills/audit/run.sh" },
  edition: { "SKILL.md": "claude/skills/audit/SKILL.md", "steps.md": "claude/skills/audit/steps.md" },
  bundle: { "agents/auditor.md": "agents/auditor.md" },
};
