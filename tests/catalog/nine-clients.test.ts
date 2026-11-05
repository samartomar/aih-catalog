import { describe, expect, it } from "vitest";
import { readLocalSource } from "../../src/catalog/node.js";
import { buildContent, checkContent } from "../../src/catalog/producer.js";
import {
  availability,
  type Item,
  type LinkStep,
  listItems,
  type MergeStep,
  type Plan,
  type PlanStep,
  planInstall,
  readToolProfile,
  renderStep,
  type ToolProfile,
  type WriteStep,
} from "../../src/catalog/reader.js";
import type { DiscoveredItem } from "../../src/catalog/source.js";
import { findItems } from "../../src/catalog/source.js";
import {
  FRAMEWORK,
  folder,
  ownContent,
  placements,
  profile,
  sha,
  type TreeEntry,
  writes,
} from "./helpers.js";

const id = (kind: string, path: string) => `${FRAMEWORK}.${kind}.${path}`;

// One small mixed-kind source: every distinct serialization form the nine profiles use.
const REVIEWER = [
  "---",
  "name: reviewer",
  "description: Reviews a change.",
  "model: sonnet",
  "---",
  "You review changes.",
  "Say what is wrong.",
  "",
].join("\n");
const HELPER =
  "---\nname: helper\ndescription: Answers questions.\ntools: Read, Grep\n---\nHelp.\n";
const DEPLOY = "---\ndescription: Deploy the current branch.\n---\nDeploy $ARGUMENTS now.\n";
const FOLDED =
  "---\nname: folded\ndescription: >-\n  A long description\n  over two lines.\n---\nFold me.\n";
const PLAIN = "---\nname: plain\ndescription: Plain skill.\n---\nPlain.\n";
const ALWAYS = "# Always\n\nBe kind.\n";
const PYTHON = '---\npaths:\n  - "**/*.py"\n---\n# Python\n\nUse types.\n';
const WEATHER = `${JSON.stringify(
  {
    name: "io.example/weather",
    description: "Weather lookups.",
    version: "1.0.0",
    packages: [
      {
        registryType: "npm",
        identifier: "@example/weather-mcp",
        version: "1.2.3",
        transport: { type: "stdio" },
        packageArguments: [{ type: "named", name: "--region", value: "{REGION}" }],
        environmentVariables: [
          { name: "WEATHER_KEY", description: "API key", isRequired: true, isSecret: true },
          { name: "REGION", description: "Region", default: "eu-west-9" },
        ],
      },
    ],
  },
  null,
  2,
)}\n`;
const DOCS = `${JSON.stringify(
  {
    name: "io.example/docs",
    description: "Hosted docs search.",
    remotes: [
      {
        type: "streamable-http",
        url: "https://docs.example/mcp",
        headers: [{ name: "Authorization", description: "Bearer token", isSecret: true }],
      },
    ],
  },
  null,
  2,
)}\n`;

const HOOK = `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] }] } }, null, 2)}\n`;
const KIRO_HOOK = `${JSON.stringify({ name: "guard", when: { type: "preToolUse" } })}\n`;
const COPILOT_HOOK = `${JSON.stringify({ version: 1, hooks: { preToolUse: [{ bash: "./guard.sh" }] } })}\n`;
const KIRO_REVIEWER = `${JSON.stringify({ name: "reviewer", prompt: "Kiro's own reviewer." })}\n`;
const GUIDE = "# Team guide\n\nRead this first.\n";

const TREE = {
  LICENSE: "MIT\n",
  "skills/plain/SKILL.md": PLAIN,
  "skills/plain/references/notes.md": "Notes.\n",
  "skills/folded/SKILL.md": FOLDED,
  "commands/deploy.md": DEPLOY,
  "commands/plain.md": "Shadowed by the skill.\n",
  "agents/reviewer.md": REVIEWER,
  "agents/helper.md": HELPER,
  "rules/always.md": ALWAYS,
  "rules/python.md": PYTHON,
  "mcp/weather/server.json": WEATHER,
  "mcp/docs/server.json": DOCS,
  "hooks/guard/hooks.json": HOOK,
  "hooks/guard/guard.sh": { text: "#!/bin/sh\nexit 0\n", executable: true },
  "editions/kiro/guard.kiro.hook": KIRO_HOOK,
  "editions/copilot/guard.json": COPILOT_HOOK,
  "editions/kiro/reviewer.json": KIRO_REVIEWER,
  "docs/guide/README.md": GUIDE,
};

/** The fixture through the public path: discovered items plus the authored hook and document. */
async function mixed(tree: Record<string, TreeEntry> = TREE) {
  const read = readLocalSource(folder(tree));
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  const found = findItems(read.files, { framework: FRAMEWORK });
  if (found.status !== "ok") throw new Error(JSON.stringify(found));
  const file = (path: string) => {
    const entry = read.files.find((candidate) => candidate.path === path);
    if (!entry) throw new Error(path);
    return {
      sourceId: FRAMEWORK,
      sourcePath: path,
      sha256: entry.sha256 as string,
      executable: entry.mode === "100755",
      role: "content" as const,
    };
  };
  const authored: DiscoveredItem[] = [
    {
      id: id("hook", "guard"),
      kind: "hook",
      files: [file("hooks/guard/guard.sh"), file("hooks/guard/hooks.json")],
      editions: {
        copilot: { files: [file("editions/copilot/guard.json")] },
        kiro: { files: [file("editions/kiro/guard.kiro.hook")] },
      },
    },
    {
      id: id("document", "guide"),
      kind: "document",
      purpose: "reference",
      files: [file("docs/guide/README.md")],
    },
  ];
  const items = found.items.map((item) =>
    item.id === id("agent", "reviewer")
      ? { ...item, editions: { kiro: { files: [file("editions/kiro/reviewer.json")] } } }
      : item,
  );
  const built = await buildContent(read.source, read.files, [...items, ...authored], {
    framework: FRAMEWORK,
  });
  if (built.status !== "ok") throw new Error(JSON.stringify(built));
  return { read, content: built.content };
}

describe("discovering every implemented kind", () => {
  it("finds agents, commands as user-only skills and MCP servers; a skill shadows its command", async () => {
    const read = readLocalSource(folder(TREE));
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework: FRAMEWORK });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    expect(found.items.map((item) => [item.id, item.kind, item.userOnly ?? false])).toEqual([
      [id("agent", "helper"), "agent", false],
      [id("agent", "reviewer"), "agent", false],
      [id("mcp", "docs"), "mcp", false],
      [id("mcp", "weather"), "mcp", false],
      [id("rule", "always"), "rule", false],
      [id("rule", "python"), "rule", false],
      [id("skill", "deploy"), "skill", true],
      [id("skill", "folded"), "skill", false],
      [id("skill", "plain"), "skill", false],
    ]);
    expect(found.leftOver).toEqual([
      { path: "commands/plain.md", reason: "shadowed-by-skill" },
      { path: "docs/guide/README.md", reason: "unrecognised" },
      { path: "editions/copilot/guard.json", reason: "unrecognised" },
      { path: "editions/kiro/guard.kiro.hook", reason: "unrecognised" },
      { path: "editions/kiro/reviewer.json", reason: "unrecognised" },
      { path: "hooks/guard/guard.sh", reason: "not-implemented", kind: "hook" },
      { path: "hooks/guard/hooks.json", reason: "not-implemented", kind: "hook" },
    ]);
  });

  it("reads agent, command and server fields from the bytes, and derives declared inputs", async () => {
    const { read, built } = await ownContent(folder(TREE));
    const byId = Object.fromEntries(built.content.items.map((item) => [item.id, item]));
    expect(byId[id("agent", "reviewer")]).toMatchObject({
      name: "reviewer",
      description: "Reviews a change.",
      agent: { prompt: "agents/reviewer.md", model: "sonnet" },
    });
    expect(byId[id("agent", "helper")]?.agent).toEqual({
      prompt: "agents/helper.md",
      tools: ["Read", "Grep"],
    });
    // A former command: its file name is its name, its first line its description, and only the user starts it.
    expect(byId[id("skill", "deploy")]).toMatchObject({
      name: "deploy",
      description: "Deploy the current branch.",
      userOnly: true,
      arguments: true,
    });
    expect(byId[id("skill", "folded")]?.description).toBe("A long description over two lines.");
    expect(byId[id("mcp", "weather")]).toMatchObject({
      name: "weather",
      description: "Weather lookups.",
      requirements: {
        inputs: {
          REGION: {
            description: "Region",
            isRequired: false,
            isSecret: false,
            default: "eu-west-9",
          },
          WEATHER_KEY: { description: "API key", isRequired: true, isSecret: true },
        },
      },
    });
    expect(byId[id("mcp", "docs")]?.requirements).toEqual({
      inputs: { Authorization: { description: "Bearer token", isRequired: false, isSecret: true } },
    });
    expect(JSON.stringify(built.content)).not.toContain("eu-secret");
    expect(await checkContent(built.content, read.files)).toEqual({ status: "ok", problems: [] });
    // The bytes own these fields: a record that disagrees with them is invalid.
    const changed = {
      ...built.content,
      items: built.content.items.map((item) =>
        item.id === id("agent", "reviewer")
          ? { ...item, agent: { prompt: "agents/reviewer.md", model: "opus" } }
          : item,
      ),
    };
    expect(await checkContent(changed, read.files)).toMatchObject({ status: "invalid" });
  });

  it("refuses a package range, an undeclared input marker and a secret with a value", async () => {
    type Weather = {
      packages: {
        version: string;
        packageArguments: unknown[];
        environmentVariables: [{ default?: string }, ...{ default?: string }[]];
      }[];
    };
    const server = (
      patch: (value: { packages: Weather["packages"] & [Weather["packages"][number]] }) => void,
    ) => {
      const value = JSON.parse(WEATHER);
      patch(value);
      return `${JSON.stringify(value)}\n`;
    };
    const cases = {
      range: server((value) => {
        value.packages[0].version = "^1.2.0";
      }),
      latest: server((value) => {
        value.packages[0].version = "latest";
      }),
      marker: server((value) => {
        value.packages[0].packageArguments = [{ type: "positional", value: "{UNDECLARED}" }];
      }),
      secret: server((value) => {
        value.packages[0].environmentVariables[0].default = "eu-secret";
      }),
    };
    for (const [name, text] of Object.entries(cases)) {
      const read = readLocalSource(folder({ [`mcp/${name}/server.json`]: text }));
      if (read.status !== "ok") throw new Error(JSON.stringify(read));
      const found = findItems(read.files, { framework: FRAMEWORK });
      if (found.status !== "ok") throw new Error(JSON.stringify(found));
      expect(
        await buildContent(read.source, read.files, found.items, { framework: FRAMEWORK }),
        name,
      ).toMatchObject({
        status: "invalid",
        problems: [{ path: expect.stringContaining(id("mcp", name)) }],
      });
    }
  });
});

const NINE = [
  "antigravity",
  "claude-code",
  "codex",
  "copilot",
  "cursor",
  "dsh",
  "kimi",
  "kiro",
  "opencode",
];
const nine = () => NINE.map((cli) => profile(cli));

const short = (value: string) => value.replace(`${FRAMEWORK}.`, "");
/** One line per step: operation, place, owner, clients and render, for review against the spec. */
function rows(plan: readonly PlanStep[]): string[] {
  return placements(plan).map((step) => {
    const owner = step.item
      ? short(step.item)
      : `(${(step.op !== "link" ? (step.items ?? []) : []).length} items)`;
    const clis = `[${step.clis.join(",")}]`;
    if (step.op === "link") return `link ${step.path} -> ${step.to} ${owner} ${clis}`;
    const render = step.render
      ? ` ${step.render.name}@${"profiles" in step.render ? step.render.profiles.map((entry) => entry.id).join("+") : "profile" in step.render ? step.render.profile : ""}`
      : "";
    if (step.op === "merge")
      return `merge ${step.file} ${step.key.replace(`${FRAMEWORK}.`, "")} ${owner} ${clis}${render}`;
    return `write ${step.path} ${owner} ${clis}${render}`;
  });
}
const bytesOf = (read: { files: readonly { path: string; bytes?: Uint8Array }[] }) =>
  read.files.flatMap((file) => (file.bytes ? [{ sourcePath: file.path, bytes: file.bytes }] : []));
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("placing the mixed fixture for all nine clients at project scope", () => {
  it("places every supported kind and reports every unsupported pair", async () => {
    const { content } = await mixed();
    const result = planInstall(
      content.items.map((item) => item.id),
      [content],
      nine(),
      { scope: "project", data: null },
    );
    if (result.status === "invalid" || result.status === "refused")
      throw new Error(JSON.stringify(result));
    expect(rows(result.plan)).toEqual([
      "write .agents/agents/helper.md agent.helper [antigravity,kimi] agent@antigravity",
      "write .agents/agents/reviewer.md agent.reviewer [antigravity,kimi] agent@antigravity",
      "write .agents/rules/always.md rule.always [antigravity] rule@antigravity",
      "write .agents/rules/python.md rule.python [antigravity] rule@antigravity",
      "write .agents/skills/folded/SKILL.md skill.folded [antigravity,codex,copilot,cursor,dsh,kimi,opencode]",
      "write .agents/skills/plain/SKILL.md skill.plain [antigravity,codex,copilot,cursor,dsh,kimi,opencode]",
      "write .agents/skills/plain/references/notes.md skill.plain [antigravity,codex,copilot,cursor,dsh,kimi,opencode]",
      "write .aihq/notices/local-my-skills/LICENSE (10 items) [antigravity,claude-code,codex,copilot,cursor,dsh,kimi,kiro,opencode]",
      "write .claude/agents/helper.md agent.helper [claude-code,copilot,cursor]",
      "write .claude/agents/reviewer.md agent.reviewer [claude-code,copilot,cursor]",
      "write .claude/rules/always.md rule.always [claude-code]",
      "write .claude/rules/python.md rule.python [claude-code] rule@claude-code",
      "write .claude/skills/deploy/SKILL.md skill.deploy [claude-code] skill@claude-code",
      "write .claude/skills/folded/SKILL.md skill.folded [claude-code]",
      "write .claude/skills/plain/SKILL.md skill.plain [claude-code]",
      "write .claude/skills/plain/references/notes.md skill.plain [claude-code]",
      "write .codex/agents/helper.toml agent.helper [codex] agent@codex",
      "write .codex/agents/reviewer.toml agent.reviewer [codex] agent@codex",
      "write .cursor/rules/always.mdc rule.always [cursor] rule@cursor",
      "write .cursor/rules/python.mdc rule.python [cursor] rule@cursor",
      "write .github/hooks/guard.json hook.guard [copilot]",
      "write .github/instructions/always.instructions.md rule.always [copilot] rule@copilot",
      "write .github/instructions/python.instructions.md rule.python [copilot] rule@copilot",
      "write .kiro/agents/helper.json agent.helper [kiro] agent@kiro",
      "write .kiro/agents/reviewer.json agent.reviewer [kiro]",
      "write .kiro/hooks/guard.kiro.hook hook.guard [kiro]",
      "write .kiro/prompts/deploy.md skill.deploy [kiro] user-only-fallback@kiro",
      "write .kiro/skills/folded/SKILL.md skill.folded [kiro] skill@kiro",
      "write .kiro/skills/plain/SKILL.md skill.plain [kiro] skill@kiro",
      "write .kiro/skills/plain/references/notes.md skill.plain [kiro]",
      "write .kiro/steering/always.md rule.always [kiro] rule@kiro",
      "write .kiro/steering/deploy.md skill.deploy [kiro] user-only-fallback@kiro",
      "write .kiro/steering/python.md rule.python [kiro] rule@kiro",
      "write .opencode/agents/helper.md agent.helper [opencode] agent@opencode",
      "write .opencode/agents/reviewer.md agent.reviewer [opencode] agent@opencode",
      "write .opencode/commands/deploy.md skill.deploy [opencode] user-only-fallback@opencode",
      "merge .agents/mcp_config.json /mcpServers/docs mcp.docs [antigravity]",
      "merge .agents/mcp_config.json /mcpServers/weather mcp.weather [antigravity]",
      "merge .codex/config.toml mcp_servers.docs mcp.docs [codex]",
      "merge .codex/config.toml mcp_servers.weather mcp.weather [codex]",
      "merge .cursor/mcp.json /mcpServers/docs mcp.docs [cursor]",
      "merge .cursor/mcp.json /mcpServers/weather mcp.weather [cursor]",
      "merge .github/mcp.json /mcpServers/docs mcp.docs [copilot]",
      "merge .github/mcp.json /mcpServers/weather mcp.weather [copilot]",
      "merge .kimi-code/mcp.json /mcpServers/docs mcp.docs [kimi]",
      "merge .kimi-code/mcp.json /mcpServers/weather mcp.weather [kimi]",
      "merge .kiro/settings/mcp.json /mcpServers/docs mcp.docs [kiro]",
      "merge .kiro/settings/mcp.json /mcpServers/weather mcp.weather [kiro]",
      "merge .mcp.json /mcpServers/docs mcp.docs [claude-code]",
      "merge .mcp.json /mcpServers/weather mcp.weather [claude-code]",
      "merge .vscode/settings.json /chat.agentSkillsLocations/.claude~1skills (3 items) [copilot]",
      "merge AGENTS.md rule.always rule.always [codex,dsh,kimi,opencode] rule-block@codex",
      "merge opencode.json /mcp/docs mcp.docs [opencode]",
      "merge opencode.json /mcp/weather mcp.weather [opencode]",
    ]);
    expect(
      result.unavailable.map((entry) => `${short(entry.item ?? "")} ${entry.cli} ${entry.reason}`),
    ).toEqual([
      "agent.helper dsh unsupported-kind",
      "agent.reviewer dsh unsupported-kind",
      ...NINE.map((cli) => `document.guide ${cli} not-described`),
      "hook.guard antigravity no-edition",
      "hook.guard claude-code no-edition",
      "hook.guard codex no-edition",
      "hook.guard cursor no-edition",
      "hook.guard dsh unsupported-kind",
      "hook.guard kimi no-edition",
      "hook.guard opencode no-edition",
      "mcp.docs dsh unsupported-kind",
      "mcp.weather dsh unsupported-kind",
      "rule.python codex no-path-scope",
      "rule.python dsh no-path-scope",
      "rule.python kimi no-path-scope",
      "rule.python opencode no-path-scope",
    ]);
    // The shared folder takes one combined user-only render, but Kimi keeps $ARGUMENTS where
    // the others reword it, so the plan reports the clash instead of picking one client's form.
    expect(result.clashes).toEqual([
      {
        root: "project",
        path: ".agents/skills/deploy",
        reason: "different-content",
        items: [id("skill", "deploy")],
        clis: ["antigravity", "codex", "copilot", "cursor", "dsh", "kimi"],
      },
    ]);
    // Copilot shares .agents/skills, and VS Code is told not to read .claude/skills too.
    // The helper's tool list (Read, Grep) is kept where the client reads Claude's agent file and
    // dropped, with a warning, where the client's own agent file cannot carry it.
    expect(
      result.warnings.map(
        (warning) => `${warning.code} ${warning.cli} ${(warning.items ?? []).map(short).join(",")}`,
      ),
    ).toEqual([
      "agent-tools-unrestricted antigravity agent.helper",
      "agent-tools-unrestricted codex agent.helper",
      "agent-tools-unrestricted kimi agent.helper",
      "agent-tools-unrestricted kiro agent.helper",
      "agent-tools-unrestricted opencode agent.helper",
      "copilot-ide-duplicate copilot skill.deploy,skill.folded,skill.plain",
      "vscode-hides-claude-skills copilot skill.deploy,skill.folded,skill.plain",
    ]);
    expect(result.status).toBe("incomplete");
    for (const step of placements(result.plan))
      if (step.op !== "link") expect(step.scanned).toBe(step.render ? false : undefined);
  });

  it("writes MCP entries per client with typed input destinations and no values", async () => {
    const { content } = await mixed();
    const result = planInstall([id("mcp", "weather"), id("mcp", "docs")], [content], nine(), {
      scope: "project",
      data: null,
    });
    if (result.status === "invalid" || result.status === "refused")
      throw new Error(JSON.stringify(result));
    const merge = (file: string, key: string) =>
      result.plan.find(
        (step) => step.op === "merge" && step.file === file && step.key === key,
      ) as MergeStep;
    const weather = id("mcp", "weather");
    const docs = id("mcp", "docs");
    expect(merge(".mcp.json", "/mcpServers/weather")).toEqual({
      op: "merge",
      root: "project",
      file: ".mcp.json",
      format: "json",
      key: "/mcpServers/weather",
      entry: {
        type: "stdio",
        command: "npx",
        args: ["@example/weather-mcp@1.2.3", "--region", "{REGION}"],
      },
      item: weather,
      clis: ["claude-code"],
      inputs: [
        { item: weather, input: "REGION", at: { argv: 3 } },
        { item: weather, input: "REGION", at: { pointer: "/env/REGION" } },
        { item: weather, input: "WEATHER_KEY", at: { pointer: "/env/WEATHER_KEY" } },
      ],
    });
    expect(merge(".codex/config.toml", "mcp_servers.docs")).toMatchObject({
      format: "toml",
      entry: { url: "https://docs.example/mcp" },
      inputs: [
        { item: docs, input: "Authorization", at: { pointer: "/http_headers/Authorization" } },
      ],
    });
    expect(merge("opencode.json", "/mcp/weather")).toMatchObject({
      entry: {
        type: "local",
        command: ["npx", "@example/weather-mcp@1.2.3", "--region", "{REGION}"],
      },
      inputs: [
        { input: "REGION", at: { argv: 3 } },
        { input: "REGION", at: { pointer: "/environment/REGION" } },
        { input: "WEATHER_KEY", at: { pointer: "/environment/WEATHER_KEY" } },
      ],
    });
    expect(merge(".agents/mcp_config.json", "/mcpServers/docs")).toMatchObject({
      entry: { serverUrl: "https://docs.example/mcp" },
    });
    // Only Claude documents a native reference syntax for these destinations.
    expect(profile("claude-code").inputReferences["mcp-env"]).toEqual({ syntax: "$" + "{<name>}" });
    expect(JSON.stringify(result)).not.toContain("eu-west-9");
  });

  it("renders each serialization form, keeping the upstream body or prompt", async () => {
    const { read, content } = await mixed();
    const profiles = nine();
    const result = planInstall(
      [
        id("agent", "reviewer"),
        id("agent", "helper"),
        id("rule", "always"),
        id("rule", "python"),
        id("skill", "folded"),
        id("skill", "deploy"),
      ],
      [content],
      profiles.filter((candidate) =>
        ["antigravity", "claude-code", "codex", "copilot", "cursor", "kiro", "opencode"].includes(
          candidate.id,
        ),
      ),
      { scope: "project", data: null },
    );
    if (result.status === "invalid" || result.status === "refused")
      throw new Error(JSON.stringify(result));
    const rendered = Object.fromEntries(
      placements(result.plan).flatMap((step) => {
        if (step.op === "link" || step.render === undefined) return [];
        const output = renderStep(step, [content], profiles, bytesOf(read));
        if (output.status !== "ok") throw new Error(JSON.stringify(output));
        return [[step.op === "merge" ? step.file : step.path, text(output.bytes)]];
      }),
    );
    const BODY = "You review changes.\nSay what is wrong.\n";
    expect(rendered[".codex/agents/reviewer.toml"]).toBe(
      'name = "reviewer"\ndescription = "Reviews a change."\ndeveloper_instructions = "You review changes.\\nSay what is wrong.\\n"\n',
    );
    expect(rendered[".agents/agents/reviewer.md"]).toBe(
      `---\nname: reviewer\ndescription: Reviews a change.\n---\n${BODY}`,
    );
    expect(rendered[".opencode/agents/reviewer.md"]).toBe(
      `---\ndescription: Reviews a change.\n---\n${BODY}`,
    );
    // An agent's tool list is dropped where the client's own file cannot carry it.
    expect(rendered[".codex/agents/helper.toml"]).toBe(
      'name = "helper"\ndescription = "Answers questions."\ndeveloper_instructions = "Help.\\n"\n',
    );
    expect(rendered[".agents/agents/helper.md"]).toBe(
      "---\nname: helper\ndescription: Answers questions.\n---\nHelp.\n",
    );
    expect(rendered[".claude/rules/python.md"]).toBe(
      '---\npaths: ["**/*.py"]\n---\n# Python\n\nUse types.\n',
    );
    expect(rendered[".github/instructions/python.instructions.md"]).toBe(
      '---\npaths:\n  - "**/*.py"\napplyTo: "**/*.py"\n---\n# Python\n\nUse types.\n',
    );
    expect(rendered[".github/instructions/always.instructions.md"]).toBe(
      '---\napplyTo: "**"\n---\n# Always\n\nBe kind.\n',
    );
    expect(rendered[".kiro/steering/python.md"]).toBe(
      '---\npaths:\n  - "**/*.py"\nfileMatchPattern: "**/*.py"\ninclusion: fileMatch\n---\n# Python\n\nUse types.\n',
    );
    expect(rendered[".cursor/rules/always.mdc"]).toBe(
      "---\nalwaysApply: true\n---\n# Always\n\nBe kind.\n",
    );
    expect(rendered[".agents/rules/python.md"]).toBe(
      '---\npaths:\n  - "**/*.py"\nglobs: "**/*.py"\ntrigger: glob\n---\n# Python\n\nUse types.\n',
    );
    // Kiro shows a block-scalar description literally, so its render folds it to one plain line.
    expect(rendered[".kiro/skills/folded/SKILL.md"]).toBe(
      "---\nname: folded\ndescription: A long description over two lines.\n---\nFold me.\n",
    );
    // A former command becomes a skill with its name, description and the client's user-only form.
    expect(rendered[".claude/skills/deploy/SKILL.md"]).toBe(
      "---\ndescription: Deploy the current branch.\ndisable-model-invocation: true\nname: deploy\n---\nDeploy $ARGUMENTS now.\n",
    );
    // Clients sharing .agents/skills take one render with every client's user-only marker.
    expect(rendered[".agents/skills/deploy/SKILL.md"]).toBe(
      "---\ndescription: Deploy the current branch.\ndisable-model-invocation: true\nname: deploy\n---\nDeploy the text the user typed after the command now.\n",
    );
    expect(rendered[".agents/skills/deploy/agents/openai.yaml"]).toBe(
      "policy:\n  allow_implicit_invocation: false\n",
    );
    expect(rendered[".kiro/prompts/deploy.md"]).toBe(
      "---\ndescription: Deploy the current branch.\n---\nDeploy $ARGUMENTS now.\n",
    );
    expect(rendered[".kiro/steering/deploy.md"]).toBe(
      "---\ndescription: Deploy the current branch.\ninclusion: manual\n---\nDeploy the text the user typed after the command now.\n",
    );
    expect(rendered[".opencode/commands/deploy.md"]).toBe(
      "---\ndescription: Deploy the current branch.\n---\nDeploy $ARGUMENTS now.\n",
    );
    expect(rendered["AGENTS.md"]).toBe(ALWAYS);
    // Without Claude in the plan, Copilot writes its own agent file.
    const alone = planInstall([id("agent", "reviewer")], [content], [profile("copilot")], {
      scope: "project",
      data: null,
    });
    if (alone.status !== "ok") throw new Error(JSON.stringify(alone));
    const agent = alone.plan[1] as WriteStep;
    expect(agent.path).toBe(".github/agents/reviewer.agent.md");
    const copilot = renderStep(agent, [content], profiles, bytesOf(read));
    expect(copilot.status === "ok" && text(copilot.bytes)).toBe(
      `---\nname: reviewer\ndescription: Reviews a change.\n---\n${BODY}`,
    );
  });

  it("gives Codex its own implicit-invocation control for a user-only skill", async () => {
    const { read, content } = await mixed();
    const codex = profile("codex");
    const result = planInstall([id("skill", "deploy")], [content], [codex], {
      scope: "project",
      data: null,
    });
    if (result.status !== "ok") throw new Error(JSON.stringify(result));
    expect(rows(result.plan)).toEqual([
      "write .agents/skills/deploy/SKILL.md skill.deploy [codex] skill@codex",
      "write .agents/skills/deploy/agents/openai.yaml skill.deploy [codex] user-only-file@codex",
      "write .aihq/notices/local-my-skills/LICENSE (1 items) [codex]",
    ]);
    const [skill, yaml] = result.plan.map((step) =>
      renderStep(step, [content], [codex], bytesOf(read)),
    );
    expect(skill?.status === "ok" && text(skill.bytes)).toBe(
      "---\ndescription: Deploy the current branch.\nname: deploy\n---\nDeploy the text the user typed after the command now.\n",
    );
    expect(yaml?.status === "ok" && text(yaml.bytes)).toBe(
      "policy:\n  allow_implicit_invocation: false\n",
    );
    expect((result.plan[1] as WriteStep).from).toBeUndefined();
  });
});

describe("user scope: shared versions, links and copies", () => {
  const userClis = () =>
    ["claude-code", "codex", "copilot", "dsh", "kimi", "kiro"].map((cli) => profile(cli));

  it("shares one version per distinct render input and links only where the client documents links", async () => {
    const { content } = await mixed();
    const result = planInstall(
      [id("skill", "plain"), id("rule", "always")],
      [content],
      userClis(),
      { scope: "user", data: null },
    );
    if (result.status === "invalid" || result.status === "refused")
      throw new Error(JSON.stringify(result));
    const plain = content.items.find((item) => item.id === id("skill", "plain"));
    if (plain === undefined) throw new Error("plain");
    // The version key of an unrendered copy: no render, so no profile enters it.
    const facts = {
      behaviourSha256: plain.behaviourSha256,
      description: "Plain skill.",
      files: [
        { executable: false, path: "SKILL.md", sha256: sha(PLAIN) },
        { executable: false, path: "references/notes.md", sha256: sha("Notes.\n") },
      ],
      name: "plain",
    };
    const version = sha(JSON.stringify(facts)).slice(0, 12);
    const kiroVersion = (
      result.plan.find(
        (step) => step.op === "link" && step.path === ".kiro/skills/plain",
      ) as LinkStep
    ).to
      .split("/")
      .at(-1);
    expect(kiroVersion).not.toBe(version);
    expect(rows(result.plan)).toEqual([
      // dsh cannot take a link, so the shared .agents/skills folder is a copy that also serves Codex.
      "write .agents/skills/plain/SKILL.md skill.plain [codex,dsh]",
      "write .agents/skills/plain/references/notes.md skill.plain [codex,dsh]",
      "write .aihq/notices/local-my-skills/LICENSE (2 items) [claude-code,codex,copilot,dsh,kimi,kiro]",
      // The two version folders sort by their keys, which follow the profile versions.
      ...[
        [
          `write .aihq/shared/local-my-skills/skill/plain/${kiroVersion}/SKILL.md skill.plain [kiro] skill@kiro`,
          `write .aihq/shared/local-my-skills/skill/plain/${kiroVersion}/references/notes.md skill.plain [kiro]`,
        ],
        [
          `write .aihq/shared/local-my-skills/skill/plain/${version}/SKILL.md skill.plain [claude-code,copilot,kimi]`,
          `write .aihq/shared/local-my-skills/skill/plain/${version}/references/notes.md skill.plain [claude-code,copilot,kimi]`,
        ],
      ]
        .sort((left, right) => ((left[0] as string) < (right[0] as string) ? -1 : 1))
        .flat(),
      // Kiro reads global steering from ~/.kiro/steering/.
      "write .kiro/steering/always.md rule.always [kiro] rule@kiro",
      `link .claude/skills/plain -> .aihq/shared/local-my-skills/skill/plain/${version} skill.plain [claude-code]`,
      `link .copilot/skills/plain -> .aihq/shared/local-my-skills/skill/plain/${version} skill.plain [copilot]`,
      `link .kimi-code/skills/plain -> .aihq/shared/local-my-skills/skill/plain/${version} skill.plain [kimi]`,
      `link .kiro/skills/plain -> .aihq/shared/local-my-skills/skill/plain/${kiroVersion} skill.plain [kiro]`,
      "merge .agents/AGENTS.md rule.always rule.always [kimi] rule-block@kimi",
      "merge .claude/CLAUDE.md rule.always rule.always [claude-code] rule-block@claude-code",
    ]);
    expect(
      result.unavailable.map((entry) => `${short(entry.item ?? "")} ${entry.cli} ${entry.reason}`),
    ).toEqual([
      "rule.always codex not-described",
      "rule.always copilot not-described",
      "rule.always dsh not-described",
    ]);
    for (const step of result.plan) if (step.op === "write") expect(step.root).toBe("user");

    const copies = planInstall([id("skill", "plain")], [content], [profile("claude-code")], {
      scope: "user",
      data: null,
      copy: true,
    });
    if (copies.status !== "ok") throw new Error(JSON.stringify(copies));
    expect(rows(copies.plan)).toEqual([
      "write .aihq/notices/local-my-skills/LICENSE (1 items) [claude-code]",
      "write .claude/skills/plain/SKILL.md skill.plain [claude-code]",
      "write .claude/skills/plain/references/notes.md skill.plain [claude-code]",
    ]);
  });

  it("puts a user-scope Codex command in its own version with openai.yaml inside it", async () => {
    const { content } = await mixed();
    const result = planInstall([id("skill", "deploy")], [content], [profile("codex")], {
      scope: "user",
      data: null,
    });
    if (result.status !== "ok") throw new Error(JSON.stringify(result));
    const link = result.plan.find((step) => step.op === "link") as LinkStep;
    expect(link).toMatchObject({
      path: ".agents/skills/deploy",
      item: id("skill", "deploy"),
      clis: ["codex"],
    });
    expect(rows(result.plan)).toEqual([
      "write .aihq/notices/local-my-skills/LICENSE (1 items) [codex]",
      `write ${link.to}/SKILL.md skill.deploy [codex] skill@codex`,
      `write ${link.to}/agents/openai.yaml skill.deploy [codex] user-only-file@codex`,
      `link .agents/skills/deploy -> ${link.to} skill.deploy [codex]`,
    ]);
    expect(link.to).toMatch(/^\.aihq\/shared\/local-my-skills\/skill\/deploy\/[0-9a-f]{12}$/);
  });

  it("keeps a client whose fallback has no evidenced user place unavailable", async () => {
    const { content } = await mixed();
    const result = planInstall(
      [id("skill", "deploy")],
      [content],
      [profile("opencode"), profile("kiro")],
      { scope: "user", data: null },
    );
    if (result.status === "invalid" || result.status === "refused")
      throw new Error(JSON.stringify(result));
    expect(rows(result.plan)).toEqual([
      "write .aihq/notices/local-my-skills/LICENSE (1 items) [kiro]",
      "write .kiro/prompts/deploy.md skill.deploy [kiro] user-only-fallback@kiro",
      // Kiro's global steering (~/.kiro/steering) gives the IDE its manual steering too.
      "write .kiro/steering/deploy.md skill.deploy [kiro] user-only-fallback@kiro",
    ]);
    expect(result.unavailable).toMatchObject([
      { item: id("skill", "deploy"), cli: "opencode", reason: "no-user-only" },
    ]);
  });
});

/** A custom profile in the same format: a copy of a shipped one with some sections changed. */
function custom(base: string, changes: Record<string, unknown>): ToolProfile {
  const value = { ...JSON.parse(JSON.stringify(profile(base))), ...changes };
  const read = readToolProfile(
    new TextEncoder().encode(`${JSON.stringify(sortKeys(value), null, 2)}\n`),
  );
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  return read.profile;
}

describe("structured merges", () => {
  it("merges one identical entry once and reports different, nested and write-and-merge collisions", async () => {
    const { content } = await mixed();
    const claude = profile("claude-code");
    const renamed = planInstall([id("mcp", "weather"), id("mcp", "docs")], [content], [claude], {
      scope: "project",
      data: null,
      names: { [id("mcp", "docs")]: "weather" },
    });
    expect(renamed).toMatchObject({
      status: "incomplete",
      clashes: [
        {
          root: "project",
          path: ".mcp.json",
          key: "/mcpServers/weather",
          reason: "different-content",
          items: [id("mcp", "docs"), id("mcp", "weather")],
          clis: ["claude-code"],
        },
      ],
    });
    const inner = custom("claude-code", {
      id: "inner",
      places: {
        ...claude.places,
        mcp: { project: { file: ".mcp.json", format: "json", key: "/mcpServers/<name>/env" } },
      },
    });
    const nested = planInstall([id("mcp", "weather")], [content], [claude, inner], {
      scope: "project",
      data: null,
    });
    expect(nested).toMatchObject({
      status: "incomplete",
      clashes: [
        {
          path: ".mcp.json",
          key: "/mcpServers/weather/env",
          reason: "nested-key",
          clis: ["claude-code", "inner"],
        },
      ],
    });
    const collide = custom("claude-code", {
      id: "collide",
      places: { ...claude.places, rule: { project: { always: ".<name>.json" } } },
    });
    const both = planInstall(
      [id("mcp", "weather"), id("rule", "always")],
      [content],
      [claude, collide],
      {
        scope: "project",
        data: null,
        names: { [id("rule", "always")]: "mcp" },
      },
    );
    expect(both).toMatchObject({ status: "incomplete" });
    expect((both as Plan).clashes).toContainEqual(
      expect.objectContaining({ path: ".mcp.json", reason: "write-and-merge" }),
    );
  });

  it("reports Codex always-on blocks that pass its 32 KiB AGENTS.md limit", async () => {
    const big = `# Big\n\n${"x".repeat(33 * 1024)}\n`;
    const { content } = await mixed({ ...TREE, "rules/big.md": big });
    const result = planInstall(
      [id("rule", "big")],
      [content],
      [profile("codex"), profile("kimi")],
      { scope: "project", data: null },
    );
    expect(result).toMatchObject({
      status: "incomplete",
      clashes: [
        {
          root: "project",
          path: "AGENTS.md",
          reason: "limit",
          items: [id("rule", "big")],
          clis: ["codex"],
        },
      ],
    });
    const small = planInstall([id("rule", "always")], [content], [profile("codex")], {
      scope: "project",
      data: null,
    });
    expect(small).toMatchObject({ status: "ok", clashes: [] });
  });
});

describe("refusals, unsupported kinds and custom profiles", () => {
  it("refuses rendering a native agent or rule block from changed bytes or another profile version", async () => {
    const { read, content } = await mixed();
    const codex = profile("codex");
    const result = planInstall(
      [id("agent", "reviewer"), id("rule", "always")],
      [content],
      [codex],
      { scope: "project", data: null },
    );
    if (result.status !== "ok") throw new Error(JSON.stringify(result));
    for (const step of placements(result.plan).filter(
      (candidate) => candidate.op !== "link" && candidate.render,
    )) {
      const files = bytesOf(read).map((file) => ({
        ...file,
        bytes: new TextEncoder().encode(`${text(file.bytes)}changed`),
      }));
      expect(renderStep(step, [content], [codex], files)).toMatchObject({
        status: "refused",
        code: "source-mismatch",
      });
      expect(
        renderStep(step, [content], [{ ...codex, version: codex.version + 1 }], bytesOf(read)),
      ).toMatchObject({
        status: "refused",
        code: "profile-mismatch",
      });
      expect(renderStep(step, [content], [codex], bytesOf(read))).toMatchObject({ status: "ok" });
    }
  });

  it("places a document only for a profile that describes a document place", async () => {
    const { content } = await mixed();
    const withDocs = custom("claude-code", {
      id: "team-claude",
      places: { ...profile("claude-code").places, document: { project: ".team/docs/<name>/" } },
    });
    const guide = id("document", "guide");
    const result = planInstall([guide], [content], [withDocs, profile("claude-code")], {
      scope: "project",
      data: null,
    });
    if (result.status === "invalid" || result.status === "refused")
      throw new Error(JSON.stringify(result));
    expect(rows(result.plan)).toEqual([
      "write .aihq/notices/local-my-skills/LICENSE (1 items) [team-claude]",
      "write .team/docs/guide/README.md document.guide [team-claude]",
    ]);
    expect(result.unavailable).toMatchObject([
      { item: guide, cli: "claude-code", reason: "not-described" },
    ]);
    const item = content.items.find((candidate) => candidate.id === guide);
    expect(item).toMatchObject({ purpose: "reference", description: "Team guide" });
  });

  it("reports availability by edition, render or reason", async () => {
    const { content } = await mixed();
    const item = (path: string) => content.items.find((candidate) => candidate.id === path) as Item;
    expect(availability(item(id("hook", "guard")), profile("kiro"))).toEqual({
      available: true,
      how: "edition",
    });
    expect(availability(item(id("hook", "guard")), profile("claude-code"))).toEqual({
      available: false,
      how: "none",
      reason: "no-edition",
    });
    expect(availability(item(id("agent", "reviewer")), profile("codex"))).toEqual({
      available: true,
      how: "rendered",
    });
    expect(availability(item(id("mcp", "weather")), profile("dsh"))).toEqual({
      available: false,
      how: "none",
      reason: "unsupported-kind",
    });
    expect(listItems(content, { cli: profile("dsh") }).map((entry) => short(entry.id))).toEqual([
      "rule.always",
      "skill.deploy",
      "skill.folded",
      "skill.plain",
    ]);
  });

  it("binds a declared file placeholder through the render and refuses a render that would lose it", async () => {
    const tree = {
      ...TREE,
      "skills/setup/SKILL.md":
        "---\nname: setup\ndescription: Set up.\n---\nUse {{API_URL}} for $ARGUMENTS.\n",
    };
    const read = readLocalSource(folder(tree));
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework: FRAMEWORK });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    const setup = id("skill", "setup");
    const requirements = {
      inputs: {
        API_URL: {
          description: "Service URL",
          isRequired: true,
          isSecret: false,
          placeholder: { sourcePath: "skills/setup/SKILL.md", marker: "{{API_URL}}" },
        },
      },
    };
    const items = found.items.map((item) => (item.id === setup ? { ...item, requirements } : item));
    const built = await buildContent(read.source, read.files, items, { framework: FRAMEWORK });
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    const codex = profile("codex");
    const plan = planInstall([setup], [built.content], [codex], { scope: "project", data: null });
    if (plan.status !== "ok") throw new Error(JSON.stringify(plan));
    const step = plan.plan.find(
      (candidate) => candidate.op === "write" && candidate.item === setup,
    ) as WriteStep;
    expect(step.inputs).toEqual([
      { item: setup, input: "API_URL", at: { placeholder: "{{API_URL}}" } },
    ]);
    const output = renderStep(step, [built.content], [codex], bytesOf(read));
    expect(output.status === "ok" && text(output.bytes)).toContain(
      "Use {{API_URL}} for the text the user typed after the command.",
    );
    // A declaration whose marker the file does not contain is refused at build time.
    const wrong = found.items.map((item) =>
      item.id === setup
        ? {
            ...item,
            requirements: {
              inputs: {
                API_URL: {
                  ...requirements.inputs.API_URL,
                  placeholder: { sourcePath: "skills/setup/SKILL.md", marker: "{{NOPE}}" },
                },
              },
            },
          }
        : item,
    );
    expect(
      await buildContent(read.source, read.files, wrong, { framework: FRAMEWORK }),
    ).toMatchObject({
      status: "invalid",
      problems: [{ path: `${setup}/requirements` }],
    });
  });

  it("binds a declared rule placeholder on the merge that writes the rule's block", async () => {
    const tree = { ...TREE, "rules/always.md": "# Always\n\nCall {{API_URL}} first.\n" };
    const read = readLocalSource(folder(tree));
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework: FRAMEWORK });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    const always = id("rule", "always");
    const requirements = {
      inputs: {
        API_URL: {
          description: "Service URL",
          isRequired: true,
          isSecret: false,
          placeholder: { sourcePath: "rules/always.md", marker: "{{API_URL}}" },
        },
      },
    };
    const items = found.items.map((item) =>
      item.id === always ? { ...item, requirements } : item,
    );
    const built = await buildContent(read.source, read.files, items, { framework: FRAMEWORK });
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    const plan = planInstall([always], [built.content], [profile("codex")], {
      scope: "project",
      data: null,
    });
    if (plan.status !== "ok") throw new Error(JSON.stringify(plan));
    const merge = plan.plan.find(
      (candidate) => candidate.op === "merge" && candidate.key === always,
    ) as MergeStep;
    expect(merge.file).toBe("AGENTS.md");
    expect(merge.inputs).toEqual([
      { item: always, input: "API_URL", at: { placeholder: "{{API_URL}}" } },
    ]);
  });

  it("gives byte-identical plans for identical input in any order", async () => {
    const first = await mixed();
    const second = await mixed();
    const ids = first.content.items.map((item) => item.id);
    for (const scope of ["project", "user"] as const) {
      const one = planInstall(ids, [first.content], nine(), { scope, data: null });
      const two = planInstall([...ids].reverse(), [second.content], nine().reverse(), {
        scope,
        data: null,
      });
      expect(JSON.stringify(two)).toBe(JSON.stringify(one));
    }
  });
});

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  return value;
}

describe("upstream editions", () => {
  it("prefers a client's upstream skill edition, copied as it is, and renders the rest", async () => {
    const CLAUDE_PLAIN =
      "---\nname: plain\ndescription: Plain skill, Claude's own.\n---\nClaude's plain.\n";
    const read = readLocalSource(
      folder({
        ...TREE,
        "editions/claude/plain/SKILL.md": CLAUDE_PLAIN,
        "editions/claude/plain/extra.md": "Extra.\n",
      }),
    );
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework: FRAMEWORK });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    const file = (path: string) => ({
      sourceId: FRAMEWORK,
      sourcePath: path,
      sha256: read.files.find((entry) => entry.path === path)?.sha256 as string,
      executable: false,
      role: "content" as const,
    });
    const plain = id("skill", "plain");
    const items = found.items.map((item) =>
      item.id === plain
        ? {
            ...item,
            editions: {
              "claude-code": {
                files: [
                  file("editions/claude/plain/SKILL.md"),
                  file("editions/claude/plain/extra.md"),
                ],
              },
            },
          }
        : item,
    );
    const built = await buildContent(read.source, read.files, items, { framework: FRAMEWORK });
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    const edition = built.content.items.find((item) => item.id === plain)?.editions?.[
      "claude-code"
    ];
    expect(edition?.scanKey).toMatch(/^git-sha1:[0-9a-f]{40}$/);
    expect(await checkContent(built.content, read.files)).toEqual({ status: "ok", problems: [] });
    const result = planInstall(
      [plain],
      [built.content],
      [profile("claude-code"), profile("codex")],
      { scope: "project", data: null },
    );
    if (result.status !== "ok") throw new Error(JSON.stringify(result));
    expect(
      writes(result.plan).map((step) => [
        step.path,
        step.from?.sourcePath,
        step.clis.join(),
        step.render?.name ?? null,
      ]),
    ).toEqual([
      [".agents/skills/plain/SKILL.md", "skills/plain/SKILL.md", "codex", null],
      [
        ".agents/skills/plain/references/notes.md",
        "skills/plain/references/notes.md",
        "codex",
        null,
      ],
      [".aihq/notices/local-my-skills/LICENSE", "LICENSE", "claude-code,codex", null],
      [".claude/skills/plain/SKILL.md", "editions/claude/plain/SKILL.md", "claude-code", null],
      [".claude/skills/plain/extra.md", "editions/claude/plain/extra.md", "claude-code", null],
    ]);
  });
});
