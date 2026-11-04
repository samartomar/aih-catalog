import { describe, expect, it } from "vitest";
import { readLocalSource } from "../../src/catalog/node.js";
import { buildContent, checkContent } from "../../src/catalog/producer.js";
import { planInstall, readContent } from "../../src/catalog/reader.js";
import { findItems } from "../../src/catalog/source.js";
import { folder, profile, sha, sortKeys, utf8 } from "./helpers.js";

const COMMIT = "1".repeat(40);
const upstream = (root: string) => {
  const read = readLocalSource(root);
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  return {
    files: read.files,
    source: { kind: "git" as const, repository: "https://example.invalid/up", commit: COMMIT },
  };
};
const fileOf = (files: readonly { path: string; sha256?: string }[], path: string) => {
  const found = files.find((file) => file.path === path);
  if (!found?.sha256) throw new Error(`no ${path}`);
  return found.sha256;
};
/** A plan that is not refused or invalid. */
const planned = (result: ReturnType<typeof planInstall>) => {
  if (result.status === "invalid" || result.status === "refused")
    throw new Error(JSON.stringify(result));
  return result;
};
/** Independent canonical form: sorted keys, two spaces, final newline. */
const canonicalText = (value: unknown) => `${JSON.stringify(sortKeys(value), null, 2)}\n`;

const HOOKS = {
  hooks: {
    PreToolUse: [
      {
        id: "pre:bash:guard",
        matcher: "Bash",
        // The upstream's literal `${CLAUDE_PLUGIN_ROOT}` (not a template here).
        hooks: [{ type: "command", command: `node "${"$"}{CLAUDE_PLUGIN_ROOT}/scripts/guard.js"` }],
      },
      { matcher: "Write", hooks: [{ type: "command", command: "echo write" }] },
    ],
  },
};

describe("cutting entries out of a shared upstream hooks file", () => {
  it("writes each entry as its own one-entry hooks.json in the generated source, with provenance", async () => {
    const root = folder({
      LICENSE: "MIT\n",
      "hooks/hooks.json": `${JSON.stringify(HOOKS, null, 2)}\n`,
      "scripts/guard.js": "process.exit(0)\n",
    });
    const { files, source } = upstream(root);
    const shared = fileOf(files, "hooks/hooks.json");
    const cut = (pointer: string) => ({
      sourceId: "up",
      sourcePath: "hooks/hooks.json",
      sha256: shared,
      executable: false,
      role: "content" as const,
      cut: { pointer, as: "hook" as const },
    });
    const built = await buildContent(
      source,
      files,
      [
        {
          id: "up.hook.pre-bash-guard",
          kind: "hook",
          files: [cut("/hooks/PreToolUse/0")],
          editions: { "claude-code": { files: [cut("/hooks/PreToolUse/0")] } },
        },
      ],
      { framework: "up" },
    );
    expect(built.status).toBe("ok");
    if (built.status !== "ok") return;

    const expected = canonicalText({ hooks: { PreToolUse: [HOOKS.hooks.PreToolUse[0]] } });
    // The edition cuts the same entry, so it shares the one generated file.
    expect(built.generated).toEqual([
      {
        itemId: "up.hook.pre-bash-guard",
        path: "up.hook.pre-bash-guard/hooks.json",
        bytes: new TextEncoder().encode(expected),
        sha256: sha(expected),
        executable: false,
      },
    ]);
    expect(built.content.sources.map((entry) => [entry.id, entry.kind])).toEqual([
      ["up", "git"],
      ["up-generated", "authored"],
    ]);
    const [item] = built.content.items;
    expect(item?.editions?.["claude-code"]?.files).toEqual(item?.files);
    expect(item?.files).toEqual([
      {
        sourceId: "up-generated",
        sourcePath: "up.hook.pre-bash-guard/hooks.json",
        sha256: sha(expected),
        bytes: expected.length,
        executable: false,
        role: "content",
        derivedFrom: { sourcePath: "hooks/hooks.json", pointer: "/hooks/PreToolUse/0" },
      },
    ]);
    expect(item).toMatchObject({
      name: "pre-bash-guard",
      event: "pre-tool-use",
      matcher: "Bash",
      handler: { type: "command" },
    });
    // The script the entry runs lives at the upstream plugin root: a path reference.
    expect(item?.pathReferences).toEqual([
      { sourcePath: "up.hook.pre-bash-guard/hooks.json", path: "scripts/guard.js" },
    ]);
    // Content identity addresses the entry by its upstream location (path#pointer).
    const facts = [
      {
        executable: false,
        sha256: sha(expected),
        sourcePath: "hooks/hooks.json#/hooks/PreToolUse/0",
      },
    ];
    expect(item?.contentSha256).toBe(sha(JSON.stringify(facts)));

    // The committed generated copies check like any other source files.
    const generatedFiles = built.generated.map((file) => ({
      sourceId: "up-generated",
      path: file.path,
      mode: "100644" as const,
      sha256: file.sha256,
      bytes: file.bytes,
    }));
    expect(await checkContent(built.content, [...files, ...generatedFiles])).toMatchObject({
      status: "ok",
    });
    const changed = generatedFiles.map((file) => ({
      ...file,
      bytes: new TextEncoder().encode(`${utf8(file.bytes)} `),
      sha256: sha(`${utf8(file.bytes)} `),
    }));
    expect((await checkContent(built.content, [...files, ...changed])).status).toBe("invalid");
  });

  it("refuses a pointer that names no single hook group", async () => {
    const root = folder({ "hooks/hooks.json": JSON.stringify(HOOKS) });
    const { files, source } = upstream(root);
    const built = await buildContent(
      source,
      files,
      [
        {
          id: "up.hook.all",
          kind: "hook",
          files: [
            {
              sourceId: "up",
              sourcePath: "hooks/hooks.json",
              sha256: fileOf(files, "hooks/hooks.json"),
              executable: false,
              role: "content",
              cut: { pointer: "/hooks/PreToolUse", as: "hook" },
            },
          ],
        },
      ],
      { framework: "up" },
    );
    expect(built.status).toBe("invalid");
  });
});

const MCP = {
  mcpServers: {
    github: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "YOUR_GITHUB_PAT_HERE" },
      description: "GitHub operations",
    },
    jira: {
      command: "uvx",
      args: ["mcp-atlassian==0.21.0"],
      env: { JIRA_URL: "YOUR_JIRA_URL_HERE" },
      description: "Jira issue tracking",
    },
    supabase: {
      command: "npx",
      args: ["-y", "@supabase/mcp-server-supabase@latest", "--project-ref=YOUR_PROJECT_REF"],
      description: "Supabase database operations",
    },
    memxus: {
      type: "http",
      url: "https://mcp.example.invalid/mcp",
      headers: { Authorization: "Bearer YOUR_MEMXUS_API_KEY_HERE" },
      description: "Hosted memory",
    },
    nexus: { command: "nexus", args: ["mcp"], description: "A local binary" },
  },
};

describe("cutting MCP servers out of a shared client config", () => {
  const build = async (
    cuts: Readonly<Record<string, { version?: string; inputs?: Record<string, string> }>>,
  ) => {
    const root = folder({ "mcp-configs/mcp-servers.json": JSON.stringify(MCP, null, 2) });
    const { files, source } = upstream(root);
    const shared = fileOf(files, "mcp-configs/mcp-servers.json");
    return buildContent(
      source,
      files,
      Object.entries(cuts).map(([name, extra]) => ({
        id: `up.mcp.${name}`,
        kind: "mcp" as const,
        files: [
          {
            sourceId: "up",
            sourcePath: "mcp-configs/mcp-servers.json",
            sha256: shared,
            executable: false,
            role: "content" as const,
            cut: { pointer: `/mcpServers/${name}`, as: "mcp" as const, ...extra },
          },
        ],
      })),
      { framework: "up" },
    );
  };

  it("writes Registry server.json files with exact versions and secret inputs without values", async () => {
    const built = await build({
      github: { version: "2025.4.8" },
      jira: {},
      supabase: { version: "0.14.0" },
      memxus: {},
    });
    expect(built.status).toBe("ok");
    if (built.status !== "ok") return;
    const server = (id: string) =>
      JSON.parse(
        utf8(built.generated.find((file) => file.itemId === id)?.bytes ?? new Uint8Array()),
      );
    expect(server("up.mcp.github")).toEqual({
      name: "github",
      description: "GitHub operations",
      packages: [
        {
          registryType: "npm",
          identifier: "@modelcontextprotocol/server-github",
          version: "2025.4.8",
          runtimeHint: "npx",
          transport: { type: "stdio" },
          runtimeArguments: [{ type: "positional", value: "-y" }],
          environmentVariables: [
            {
              name: "GITHUB_PERSONAL_ACCESS_TOKEN",
              description: "GITHUB_PERSONAL_ACCESS_TOKEN",
              isRequired: true,
              isSecret: true,
            },
          ],
        },
      ],
    });
    // An exact pin in the upstream entry is kept; `@latest` gives way to Catalog's pin.
    expect(server("up.mcp.jira").packages[0]).toMatchObject({
      registryType: "pypi",
      identifier: "mcp-atlassian",
      version: "0.21.0",
      runtimeHint: "uvx",
    });
    expect(server("up.mcp.supabase").packages[0]).toMatchObject({
      identifier: "@supabase/mcp-server-supabase",
      version: "0.14.0",
      packageArguments: [
        {
          type: "positional",
          value: "--project-ref={PROJECT_REF}",
          variables: {
            PROJECT_REF: { description: "PROJECT_REF", isRequired: true, isSecret: true },
          },
        },
      ],
    });
    expect(server("up.mcp.memxus").remotes).toEqual([
      {
        type: "streamable-http",
        url: "https://mcp.example.invalid/mcp",
        headers: [
          {
            name: "Authorization",
            description: "The Authorization header: Bearer <MEMXUS_API_KEY>",
            isRequired: true,
            isSecret: true,
          },
        ],
      },
    ]);
    const supabase = built.content.items.find((item) => item.id === "up.mcp.supabase");
    expect(supabase?.requirements?.inputs).toEqual({
      PROJECT_REF: { description: "PROJECT_REF", isRequired: true, isSecret: true },
    });
    const github = built.content.items.find((item) => item.id === "up.mcp.github");
    expect(github?.requirements?.inputs.GITHUB_PERSONAL_ACCESS_TOKEN).toMatchObject({
      isSecret: true,
    });
    expect(JSON.stringify(built.generated.map((file) => utf8(file.bytes)))).not.toContain("YOUR_");

    // The planned client entry runs the exact pinned package.
    const plan = planned(
      planInstall(["up.mcp.github"], [built.content], [profile("claude-code")], {
        scope: "project",
        data: null,
      }),
    );
    const merge = plan.plan.find((step) => step.op === "merge");
    expect(merge).toMatchObject({
      entry: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github@2025.4.8"] },
    });
  });

  it("refuses a package without an exact version and a command with no Registry form", async () => {
    const unpinned = await build({ github: {} });
    expect(unpinned).toMatchObject({ status: "invalid" });
    expect(JSON.stringify(unpinned)).toContain("no exact version");
    const binary = await build({ nexus: {} });
    expect(JSON.stringify(binary)).toContain("no Registry package form");
  });

  it("plans the upstream notice that covers the shared file a server was cut from", async () => {
    const root = folder({
      LICENSE: "MIT\n",
      "mcp-configs/mcp-servers.json": JSON.stringify(MCP, null, 2),
      "other/NOTICE": "Only other/.\n",
    });
    const { files, source } = upstream(root);
    const built = await buildContent(
      source,
      files,
      [
        {
          id: "up.mcp.jira",
          kind: "mcp" as const,
          files: [
            {
              sourceId: "up",
              sourcePath: "mcp-configs/mcp-servers.json",
              sha256: fileOf(files, "mcp-configs/mcp-servers.json"),
              executable: false,
              role: "content" as const,
              cut: { pointer: "/mcpServers/jira", as: "mcp" as const },
            },
          ],
        },
      ],
      { framework: "up" },
    );
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    const plan = planned(
      planInstall(["up.mcp.jira"], [built.content], [profile("claude-code")], {
        scope: "project",
        data: null,
      }),
    );
    expect(
      plan.plan.flatMap((step) =>
        step.op === "write" ? [[step.path, step.from?.sourcePath, step.items]] : [],
      ),
    ).toEqual([[".aihq/notices/up/LICENSE", "LICENSE", ["up.mcp.jira"]]]);
  });
});

describe("content from several sources", () => {
  it("records a further pin and Catalog's authored files, each with its own notices", async () => {
    const own = upstream(
      folder({
        LICENSE: "MIT\n",
        "licenses/vendor-skills.LICENSE": "Vendor MIT\n",
        "skills/alpha/SKILL.md": "---\nname: alpha\ndescription: Alpha.\n---\nBody\n",
      }),
    );
    const other = readLocalSource(
      folder({
        LICENSE: "Other MIT\n",
        "skills/engineering/beta/SKILL.md": "---\nname: beta\ndescription: Beta.\n---\nBody\n",
      }),
    );
    const authored = readLocalSource(
      folder({ "bootstrap.md": "# Bootstrap\n\nRead the skills.\n" }),
    );
    if (other.status !== "ok" || authored.status !== "ok") throw new Error("read");
    const mine = findItems(own.files, { framework: "up" });
    const theirs = findItems(other.files, { framework: "up", sourceId: "other" });
    if (mine.status !== "ok" || theirs.status !== "ok") throw new Error("find");
    expect(mine.notices.map((notice) => [notice.sourcePath, notice.covers])).toEqual([
      ["LICENSE", "/"],
      ["licenses/vendor-skills.LICENSE", "/"],
    ]);
    const bootstrap = authored.files.find((file) => file.path === "bootstrap.md");
    const built = await buildContent(
      own.source,
      own.files,
      [
        ...mine.items,
        ...theirs.items,
        {
          id: "up.rule.bootstrap",
          kind: "rule",
          files: [
            {
              sourceId: "up-catalog",
              sourcePath: "bootstrap.md",
              sha256: bootstrap?.sha256 as string,
              executable: false,
              role: "content",
            },
          ],
        },
      ],
      {
        framework: "up",
        sources: [
          {
            id: "other",
            source: {
              kind: "git",
              repository: "https://example.invalid/other",
              commit: "2".repeat(40),
            },
            files: other.files,
          },
          { id: "up-catalog", source: { kind: "authored" }, files: authored.files },
        ],
      },
    );
    expect(built.status).toBe("ok");
    if (built.status !== "ok") return;
    expect(built.content.sources).toEqual([
      {
        id: "up",
        kind: "git",
        repository: "https://example.invalid/up",
        commit: COMMIT,
        notices: [
          { sourcePath: "LICENSE", sha256: sha("MIT\n"), covers: "/" },
          {
            sourcePath: "licenses/vendor-skills.LICENSE",
            sha256: sha("Vendor MIT\n"),
            covers: "/",
          },
        ],
      },
      {
        id: "other",
        kind: "git",
        repository: "https://example.invalid/other",
        commit: "2".repeat(40),
        notices: [{ sourcePath: "LICENSE", sha256: sha("Other MIT\n"), covers: "/" }],
      },
      { id: "up-catalog", kind: "authored", notices: [] },
    ]);
    expect(built.content.items.map((item) => item.id)).toEqual([
      "up.rule.bootstrap",
      "up.skill.alpha",
      "up.skill.engineering.beta",
    ]);
    expect(readContent(built.bytes).status).toBe("ok");
    const tagged = [
      ...own.files,
      ...other.files.map((file) => ({ ...file, sourceId: "other" })),
      ...authored.files.map((file) => ({ ...file, sourceId: "up-catalog" })),
    ];
    expect(await checkContent(built.content, tagged)).toMatchObject({ status: "ok" });
    // Without the other pin's files the check names what is missing.
    expect(await checkContent(built.content, own.files)).toMatchObject({ status: "invalid" });

    // A plan copies each source's notices once, from the source that holds them.
    const plan = planned(
      planInstall(["up.skill.engineering.beta"], [built.content], [profile("claude-code")], {
        scope: "project",
        data: null,
      }),
    );
    const notices = plan.plan.filter(
      (step) => step.op === "write" && step.path.startsWith(".aihq/notices/"),
    );
    // A further source's notices have a folder of their own: two LICENSE files never collide.
    expect(
      notices.map((step) => [
        (step as { path: string }).path,
        (step as { from: { sourceId: string } }).from.sourceId,
      ]),
    ).toEqual([[".aihq/notices/up/other/LICENSE", "other"]]);
  });
});

describe("file-owned fields of the ported kinds", () => {
  it("records a rule's language from its language folder, but not for common rules", async () => {
    const { content } = await (async () => {
      const own = upstream(
        folder({
          "rules/python/testing.md": "# Python testing\n",
          "rules/common/style.md": "# Style\n",
        }),
      );
      const found = findItems(own.files, { framework: "up" });
      if (found.status !== "ok") throw new Error("find");
      const built = await buildContent(own.source, own.files, found.items, { framework: "up" });
      if (built.status !== "ok") throw new Error(JSON.stringify(built));
      return built;
    })();
    const language = Object.fromEntries(content.items.map((item) => [item.id, item.language]));
    expect(language).toEqual({
      "up.rule.common.style": undefined,
      "up.rule.python.testing": "python",
    });
    const tampered = {
      ...content,
      items: content.items.map((item) =>
        item.id === "up.rule.python.testing" ? { ...item, language: "rust" } : item,
      ),
    };
    const own = upstream(
      folder({
        "rules/python/testing.md": "# Python testing\n",
        "rules/common/style.md": "# Style\n",
      }),
    );
    expect(await checkContent(tampered, own.files)).toMatchObject({ status: "invalid" });
  });

  it("reads a Kiro hook file as a hook item placed only from its Kiro edition", async () => {
    // Kiro's hook format names its action `then`; written as text, as the upstream file is.
    const hook =
      '{"name":"auto-format","version":"1.0.0","enabled":true,"description":"Format files on save",' +
      '"when":{"type":"fileEdited","patterns":["*.ts","*.js"]},' +
      '"then":{"type":"askAgent","prompt":"Fix formatting."}}';
    const own = upstream(folder({ ".kiro/hooks/auto-format.kiro.hook": hook }));
    const file = {
      sourceId: "up",
      sourcePath: ".kiro/hooks/auto-format.kiro.hook",
      sha256: sha(hook),
      executable: false,
      role: "content" as const,
    };
    const built = await buildContent(
      own.source,
      own.files,
      [
        {
          id: "up.hook.auto-format",
          kind: "hook",
          files: [file],
          editions: { kiro: { files: [file] } },
        },
      ],
      { framework: "up" },
    );
    expect(built.status).toBe("ok");
    if (built.status !== "ok") return;
    expect(built.content.items[0]).toMatchObject({
      name: "auto-format",
      description: "Format files on save",
      event: "file-edited",
      matcher: "*.ts|*.js",
      handler: { type: "askAgent" },
    });
    const plan = planned(
      planInstall(
        ["up.hook.auto-format"],
        [built.content],
        [profile("kiro"), profile("claude-code")],
        { scope: "project", data: null },
      ),
    );
    expect(
      plan.plan
        .filter((step) => step.op === "write")
        .map((step) => (step as { path: string }).path),
    ).toEqual([".kiro/hooks/auto-format.kiro.hook"]);
    expect(plan.unavailable).toEqual([
      expect.objectContaining({
        item: "up.hook.auto-format",
        cli: "claude-code",
        reason: "no-edition",
      }),
    ]);
  });

  it("keeps an authored upstream-only fetch policy on the item", async () => {
    const own = upstream(
      folder({ "skills/alpha/SKILL.md": "---\nname: alpha\ndescription: Alpha.\n---\nBody\n" }),
    );
    const found = findItems(own.files, { framework: "up" });
    if (found.status !== "ok") throw new Error("find");
    const built = await buildContent(
      own.source,
      own.files,
      found.items.map((item) => ({ ...item, fetch: "upstream" as const })),
      { framework: "up" },
    );
    expect(built.status).toBe("ok");
    if (built.status !== "ok") return;
    expect(built.content.items[0]?.fetch).toBe("upstream");
    expect(await checkContent(built.content, own.files)).toMatchObject({ status: "ok" });
  });
});

describe("path references to another chosen item's files", () => {
  const tree = {
    "skills/alpha/SKILL.md":
      "---\nname: alpha\ndescription: Alpha.\n---\nUse ../beta/template.md as the template\n",
    "skills/beta/SKILL.md": "---\nname: beta\ndescription: Beta.\n---\nBody\n",
    "skills/beta/template.md": "Template\n",
  };
  const content = async () => {
    const own = upstream(folder(tree));
    const found = findItems(own.files, { framework: "up" });
    if (found.status !== "ok") throw new Error("find");
    const built = await buildContent(own.source, own.files, found.items, { framework: "up" });
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    return built.content;
  };
  const plan = async (items: string[], names?: Record<string, string>) =>
    planned(
      planInstall(items, [await content()], [profile("claude-code"), profile("kiro")], {
        scope: "project",
        data: null,
        ...(names ? { names } : {}),
      }),
    );

  it("are resolved when the planned folders keep the upstream relative position", async () => {
    const both = await plan(["up.skill.alpha", "up.skill.beta"]);
    expect(both.references).toEqual([]);
    expect(both.status).toBe("ok");
  });

  it("still block when the other item is not chosen or is renamed", async () => {
    const alone = await plan(["up.skill.alpha"]);
    expect(alone.status).toBe("incomplete");
    expect(alone.references).toEqual([
      expect.objectContaining({
        kind: "path",
        item: "up.skill.alpha",
        path: "skills/beta/template.md",
      }),
    ]);
    const renamed = await plan(["up.skill.alpha", "up.skill.beta"], { "up.skill.beta": "gamma" });
    expect(renamed.status).toBe("incomplete");
  });
});
