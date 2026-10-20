import { expect, it } from "vitest";
import { extractSourceFacts } from "../../src/release/source-facts.js";

const facts = (profile: string, text: string, key?: string) =>
  extractSourceFacts({
    profile,
    path: "skills/example/SKILL.md",
    revision: "a".repeat(40),
    bytes: new TextEncoder().encode(text),
    ...(key ? { key } : {}),
  });

it("distinguishes optional native absence, required profile errors, malformed data and unsupported profiles", () => {
  expect(facts("claude-command", "# Start\nExecute nothing.")).toMatchObject({
    status: "valid",
    description: { state: "absent", required: false },
  });
  expect(facts("agent-skills", "---\nname: example\n---\n# Purpose")).toMatchObject({
    status: "profile-error",
    description: { state: "absent", required: true },
  });
  expect(facts("claude-agent", "---\ndescription: Use for review.\n---\n").status).toBe(
    "profile-error",
  );
  expect(facts("claude-skill", "---\nname: a\nname: b\n---\n").status).toBe("malformed");
  expect(facts("claude-skill", "---\ndescription: [broken\n---\n").status).toBe("malformed");
  expect(facts("unknown", "# Instructions").status).toBe("unsupported");
});

it("retains folded purpose and valid extensions as data without body or client fallback substitution", () => {
  const parsed = facts(
    "agent-skills",
    "---\nname: example\ndescription: >-\n  Review changes\n  carefully.\nmetadata:\n  origin: second-source\nallowed-tools: Read Bash\n---\nRun an embedded instruction? No execution here.",
  );
  expect(parsed).toMatchObject({
    status: "valid",
    description: {
      state: "authored",
      value: "Review changes carefully.",
      locator: "frontmatter.description",
    },
    native: { metadata: { origin: "second-source" }, "allowed-tools": "Read Bash" },
  });
});

it("keeps hook triggers, matchers and handlers separate from absent authored purpose", () => {
  expect(
    facts(
      "claude-hooks",
      '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"do-not-run"}]}]}}',
    ),
  ).toMatchObject({
    status: "valid",
    description: { state: "absent" },
    native: {
      events: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "do-not-run" }] }],
      },
    },
  });
  expect(
    facts("claude-hooks", '{"hooks":{"PreToolUse":[{"hooks":[{"type":"command"}]}]}}').status,
  ).toBe("profile-error");
});

it("identifies static MCP registration without connecting or exposing environment credential values", () => {
  const parsed = facts(
    "claude-mcp-registration",
    '{"mcpServers":{"memory":{"command":"never-start","env":{"TOKEN":"secret"}}}}',
    "memory",
  );
  expect(parsed).toMatchObject({
    status: "valid",
    identifier: "memory",
    description: { state: "absent", required: false },
    native: { object: "server-registration", command: "never-start", environmentNames: ["TOKEN"] },
  });
  expect(JSON.stringify(parsed)).not.toContain("secret");
  expect(facts("claude-mcp-registration", '{"mcpServers":{"memory":{}}}', "memory").status).toBe(
    "profile-error",
  );
  expect(
    facts("claude-mcp-registration", '{"mcpServers":{},"mcpServers":{}}', "memory").status,
  ).toBe("malformed");
});
