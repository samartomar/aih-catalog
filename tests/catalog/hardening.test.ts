import { describe, expect, it } from "vitest";
import { readLocalSource } from "../../src/catalog/node.js";
import { buildContent } from "../../src/catalog/producer.js";
import {
  type Content,
  type Plan,
  type PlanStep,
  planInstall,
  readRecipe,
  renderStep,
} from "../../src/catalog/reader.js";
import { findItems } from "../../src/catalog/source.js";
import { FRAMEWORK, folder, profile, sha } from "./helpers.js";

const SKILL = "---\nname: tidy\ndescription: Tidy the code.\n---\n\nTidy $ARGUMENTS.\n";

/** Own content from `tree`, with every item pointed at one runtime bundle of `include`. */
async function bundled(
  id: string,
  tree: Record<string, string>,
  include: readonly string[],
  layout = "skills/<name>/",
): Promise<Content> {
  const read = readLocalSource(folder(tree, id));
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  const found = findItems(read.files, { framework: id });
  if (found.status !== "ok") throw new Error(JSON.stringify(found));
  const built = await buildContent(
    read.source,
    read.files,
    found.items.map((item) => ({ ...item, bundle: `${id}.runtime` })),
    { framework: id, bundles: [{ id: `${id}.runtime`, layout, include }] },
  );
  if (built.status !== "ok") throw new Error(JSON.stringify(built));
  return built.content;
}

const startSkill = (id: string, guide: string) =>
  `---\nname: ${id}-start\ndescription: Start ${id}.\n---\n\nRead \`../../docs/${guide}\` first.\n`;

describe("bundle include patterns", () => {
  it("matches a many-star pattern against a long name in linear time", async () => {
    const name = `${"a".repeat(200)}.md`;
    const root = folder({ "skills/tidy/SKILL.md": SKILL, [`docs/${name}`]: "x\n" });
    const read = readLocalSource(root);
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework: FRAMEWORK });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    const pattern = `docs/${"*a".repeat(40)}*b`;
    const started = performance.now();
    const built = await buildContent(
      read.source,
      read.files,
      found.items.map((item) => ({ ...item, bundle: "local.runtime" })),
      {
        framework: FRAMEWORK,
        bundles: [
          { id: "local.runtime", layout: "skills/<name>/", include: [pattern, "docs/*.md"] },
        ],
      },
    );
    expect(performance.now() - started).toBeLessThan(2000);
    expect(built.status).toBe("ok");
    if (built.status !== "ok") return;
    expect(built.content.bundles?.[0]?.files.map((file) => file.sourcePath)).toEqual([
      `docs/${name}`,
    ]);
  });
});

describe("portable paths", () => {
  it("refuses entry paths some supported file system cannot hold under that name", () => {
    for (const path of [
      "skills/a:b/SKILL.md",
      "docs/what?.md",
      "docs/a<b>.md",
      'docs/"x".md',
      "docs/a|b.md",
      "docs/a*b.md",
      "docs/tab\there.md",
      "docs/trailing.",
      "docs/trailing ",
      "docs/con",
      "docs/NUL.md",
      "com1/x.md",
      "docs/lpt9.txt",
      ".git/config",
      "skills/tidy/.GIT/hooks/pre-commit",
      "PROGRA~1/x.md",
      "docs/guide~2.md",
    ]) {
      const result = findItems([{ path, mode: "100644", sha256: sha("x") }], {
        framework: FRAMEWORK,
      });
      expect(result, path).toMatchObject({ status: "refused", code: "path-escape" });
    }
  });

  it("keeps ordinary names that only resemble reserved ones", () => {
    const result = findItems(
      ["docs/console.md", "docs/com10.md", "docs/.hidden"].map((path) => ({
        path,
        mode: "100644" as const,
        sha256: sha("x"),
      })),
      { framework: FRAMEWORK },
    );
    expect(result.status).toBe("ok");
  });

  it("refuses two entry paths that differ only in case or Unicode form", () => {
    for (const pair of [
      ["docs/Guide.md", "docs/guide.md"],
      ["docs/café.md", "docs/café.md"],
    ]) {
      const result = findItems(
        pair.map((path) => ({ path, mode: "100644" as const, sha256: sha("x") })),
        { framework: FRAMEWORK },
      );
      expect(result, pair.join()).toMatchObject({ status: "invalid" });
    }
  });

  it("reports a clash when two bundles place files that differ only in case", async () => {
    const content = (id: string, guide: string) =>
      bundled(
        id,
        { "skills/start/SKILL.md": startSkill(id, guide), [`docs/${guide}`]: `${id}\n` },
        ["docs/*.md"],
      );
    const plan = planInstall(
      ["alpha.skill.start", "beta.skill.start"],
      [await content("alpha", "guide.md"), await content("beta", "Guide.md")],
      [profile("codex")],
      { scope: "project", data: null },
    ) as Plan;
    expect(plan.status).toBe("incomplete");
    expect(plan.clashes).toMatchObject([
      {
        root: "project",
        reason: "different-content",
        items: ["alpha.skill.start", "beta.skill.start"],
      },
    ]);
  });
});

describe("bundle files on client configuration", () => {
  const surfaces = [
    { cli: "claude-code", scope: "project", file: "settings.json" },
    { cli: "claude-code", scope: "project", file: "settings.local.json" },
    { cli: "claude-code", scope: "project", file: "hooks/start.sh" },
    { cli: "claude-code", scope: "user", file: "CLAUDE.md" },
  ] as const;

  it("refuses a bundle whose file would land on a client's configuration", async () => {
    for (const { cli, scope, file } of surfaces) {
      const content = await bundled(
        "alpha",
        {
          "skills/start/SKILL.md": startSkill("alpha", "guide.md"),
          "docs/guide.md": "x\n",
          [file]: "{}\n",
        },
        ["docs/", file],
      );
      const plan = planInstall(["alpha.skill.start"], [content], [profile(cli)], {
        scope,
        data: null,
      }) as Plan;
      expect(plan.status, file).toBe("incomplete");
      expect(plan.unavailable, file).toMatchObject([
        { item: "alpha.skill.start", cli, reason: "no-bundle-place" },
      ]);
      const paths = plan.plan.flatMap((step) => ("path" in step ? [step.path] : []));
      expect(
        paths.some((path) => path.endsWith(file)),
        file,
      ).toBe(false);
    }
  });

  it("refuses a bundle file on another planned client's shared rule file", async () => {
    const content = await bundled(
      "alpha",
      {
        "skills/start/SKILL.md": startSkill("alpha", "guide.md"),
        "docs/guide.md": "x\n",
        "AGENTS.md": "# x\n",
      },
      ["docs/", "AGENTS.md"],
    );
    const plan = planInstall(
      ["alpha.skill.start"],
      [content],
      [profile("codex"), profile("kimi")],
      {
        scope: "user",
        data: null,
      },
    ) as Plan;
    expect(plan.unavailable).toContainEqual(
      expect.objectContaining({
        item: "alpha.skill.start",
        cli: "codex",
        reason: "no-bundle-place",
      }),
    );
    expect(plan.plan.some((step) => step.op === "write" && step.path === ".agents/AGENTS.md")).toBe(
      false,
    );
  });
});

/** A Registry server.json as test data: fields are changed freely, valid or not. */
type Fields = Record<string, unknown>;
type ServerJson = { packages: [Fields, ...Fields[]]; [key: string]: unknown };

/** A Registry server.json with one npm stdio package, changed by `patch`. */
const serverJson = (patch: (server: ServerJson) => void = () => {}) => {
  const server: ServerJson = {
    name: "io.example/weather",
    description: "Weather lookups.",
    packages: [
      {
        registryType: "npm",
        identifier: "@example/weather-mcp",
        version: "1.2.3",
        runtimeHint: "npx",
        runtimeArguments: [{ type: "positional", value: "-y" }],
        transport: { type: "stdio" },
      },
    ],
  };
  patch(server);
  return `${JSON.stringify(server, null, 2)}\n`;
};

/** Builds one MCP item from `text`: the build result. */
async function buildServer(text: string) {
  const read = readLocalSource(folder({ "mcp/weather/server.json": text }));
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  const found = findItems(read.files, { framework: FRAMEWORK });
  if (found.status !== "ok") throw new Error(JSON.stringify(found));
  return buildContent(read.source, read.files, found.items, { framework: FRAMEWORK });
}

const WEATHER = `${FRAMEWORK}.mcp.weather`;
const planServer = (content: Content, cli = "claude-code") =>
  planInstall([WEATHER], [content], [profile(cli)], { scope: "project", data: null }) as Plan;

describe("MCP launch fields", () => {
  it("launches an npm package through npx with only its yes flag", async () => {
    const built = await buildServer(serverJson());
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    const plan = planServer(built.content);
    expect(plan.status).toBe("ok");
    expect(plan.plan).toContainEqual(
      expect.objectContaining({
        op: "merge",
        file: ".mcp.json",
        entry: expect.objectContaining({
          command: "npx",
          args: ["-y", "@example/weather-mcp@1.2.3"],
        }),
      }),
    );
  });

  it("refuses a package runner or runner argument outside the allowlist", async () => {
    const cases = {
      hint: serverJson((server) => {
        server.packages[0].runtimeHint = "node";
      }),
      flag: serverJson((server) => {
        server.packages[0].runtimeArguments = [
          { type: "named", name: "--node-options", value: "--require=./x.js" },
        ];
      }),
      call: serverJson((server) => {
        server.packages[0].runtimeArguments = [{ type: "positional", value: "-c" }];
      }),
      pypi: serverJson((server) => {
        Object.assign(server.packages[0], {
          registryType: "pypi",
          identifier: "weather-mcp",
          runtimeHint: "uvx",
          runtimeArguments: [{ type: "named", name: "--with", value: "other" }],
        });
      }),
      pypiHint: serverJson((server) => {
        Object.assign(server.packages[0], {
          registryType: "pypi",
          identifier: "weather-mcp",
          runtimeHint: "npx",
          runtimeArguments: [],
        });
      }),
      inherited: serverJson((server) => {
        server.packages[0].registryType = "constructor";
      }),
    };
    for (const [name, text] of Object.entries(cases)) {
      const built = await buildServer(text);
      if (built.status !== "ok") throw new Error(`${name}: ${JSON.stringify(built)}`);
      const plan = planServer(built.content);
      expect(plan.status, name).toBe("incomplete");
      expect(plan.unavailable, name).toMatchObject([
        { item: WEATHER, cli: "claude-code", reason: "unsupported-server" },
      ]);
    }
  });

  it("refuses a package identifier outside its registry's name grammar", async () => {
    for (const [registryType, identifier] of [
      ["npm", "-e"],
      ["npm", "--yes"],
      ["npm", "Weather MCP"],
      ["npm", "@scope/../x"],
      ["pypi", "-c"],
      ["pypi", "weather mcp"],
      ["pypi", "weather_mcp ; rm"],
    ]) {
      const built = await buildServer(
        serverJson((server) => {
          Object.assign(server.packages[0], { registryType, identifier, runtimeArguments: [] });
          delete server.packages[0].runtimeHint;
        }),
      );
      expect(built, identifier).toMatchObject({ status: "invalid" });
    }
  });

  it("checks a recorded server's packages again when content is read", async () => {
    const built = await buildServer(serverJson());
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    const edits: ((server: ServerJson) => void)[] = [
      (server) => {
        server.packages[0].version = "^1.2.0";
      },
      (server) => {
        server.packages[0].identifier = "-e";
      },
      (server) => {
        (server as Record<string, unknown>).packages = "npx";
      },
      (server) => {
        server.remotes = [{ type: "websocket", url: "https://x.example/mcp" }];
      },
    ];
    for (const edit of edits) {
      const content = structuredClone(built.content) as unknown as {
        items: [{ server: ServerJson }];
      };
      edit(content.items[0].server);
      const plan = planServer(content as unknown as Content) as unknown as {
        status: string;
        problems: { path: string }[];
      };
      expect(plan.status).toBe("invalid");
      expect(plan.problems.map((problem) => problem.path)).toContainEqual(
        expect.stringMatching(/\/server(?:\/|$)/),
      );
    }
  });
});

/** Builds one MCP item from `text` with authored `extra` fields: its content, or throws. */
async function serverContent(text: string, extra: Record<string, unknown> = {}) {
  const read = readLocalSource(folder({ "mcp/weather/server.json": text }));
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  const found = findItems(read.files, { framework: FRAMEWORK });
  if (found.status !== "ok") throw new Error(JSON.stringify(found));
  const built = await buildContent(
    read.source,
    read.files,
    found.items.map((item) => ({ ...item, ...extra })),
    { framework: FRAMEWORK },
  );
  if (built.status !== "ok") throw new Error(JSON.stringify(built));
  return built.content;
}

const remoteJson = (url: string, headers: Fields[] = []) =>
  `${JSON.stringify({
    name: "io.example/weather",
    description: "Weather lookups.",
    remotes: [{ type: "streamable-http", url, headers }],
  })}\n`;

/** The opener a client expands from the environment, spelled so it is plainly data. */
const EXPAND = "${";

describe("MCP literals and remotes", () => {
  it("refuses literal text the client would expand as a reference", async () => {
    const cases: [string, string, Record<string, unknown>][] = [
      [
        "argument",
        serverJson((server) => {
          server.packages[0].packageArguments = [
            { type: "positional", value: `${EXPAND}env:HOME}/data` },
          ];
        }),
        {},
      ],
      ["env", serverJson(), { env: { WEATHER_HOME: `${EXPAND}HOME}` } }],
      ["url", remoteJson(`https://weather.example/${EXPAND}env:TOKEN}/mcp`), {}],
      // OpenCode's own forms, refused on every client.
      ["opencode env", serverJson(), { env: { WEATHER_HOME: "{env:HOME}" } }],
      [
        "opencode file",
        serverJson((server) => {
          server.packages[0].packageArguments = [{ type: "positional", value: "{file:~/.ssh/id}" }];
        }),
        {},
      ],
    ];
    for (const [name, text, extra] of cases) {
      const plan = planServer(await serverContent(text, extra));
      expect(plan.status, name).toBe("incomplete");
      expect(plan.unavailable, name).toMatchObject([
        { item: WEATHER, cli: "claude-code", reason: "unsupported-server" },
      ]);
    }
  });

  it("keeps declared inputs as bindings", async () => {
    const text = serverJson((server) => {
      server.packages[0].packageArguments = [
        {
          type: "named",
          name: "--region",
          value: "{REGION}",
          variables: { REGION: { description: "Region", isRequired: true } },
        },
      ];
    });
    const plan = planServer(await serverContent(text));
    expect(plan.status).toBe("ok");
  });

  it("refuses a remote server that is not https, unless it is on this machine", async () => {
    for (const url of [
      "http://weather.example/mcp",
      "ftp://weather.example/mcp",
      // Spellings URL parsers read differently, and credentials.
      String.raw`https://weather.example\@evil.example/mcp`,
      String.raw`https:\\evil.example/mcp`,
      "https://weather.example/%2e%2e/mcp/../x",
      "https://WEATHER.example/mcp",
      "https://user@weather.example/mcp",
    ]) {
      const plan = planServer(await serverContent(remoteJson(url)));
      expect(plan.unavailable, url).toMatchObject([
        { item: WEATHER, cli: "claude-code", reason: "unsupported-server" },
      ]);
    }
    for (const url of [
      "http://localhost:18801/mcp",
      "http://127.0.0.1:8080/mcp",
      "http://[::1]:8080/mcp",
      "https://weather.example/mcp",
    ])
      expect(planServer(await serverContent(remoteJson(url))).status, url).toBe("ok");
  });
});

describe("MCP environment", () => {
  const LOADERS = [
    "NODE_OPTIONS",
    "NODE_PATH",
    "LD_PRELOAD",
    "DYLD_INSERT_LIBRARIES",
    "PYTHONPATH",
    "PYTHONSTARTUP",
    "UV_INDEX_URL",
    "PIP_INDEX_URL",
    "npm_config_registry",
    "NPM_CONFIG_USERCONFIG",
    "PATH",
    "Path",
    "PATHEXT",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "XDG_CONFIG_HOME",
    "GIT_PROXY_COMMAND",
    "GIT_EXTERNAL_DIFF",
    "GIT_PAGER",
    "PAGER",
    "EDITOR",
    "VISUAL",
    "HOMEDRIVE",
    "HOMEPATH",
    "PROGRAMDATA",
    "ALLUSERSPROFILE",
    "KIMI_CODE_HOME",
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_DIR",
    "OPENCODE_CONFIG_CONTENT",
    "COPILOT_HOME",
    "CURSOR_CONFIG_DIR",
  ];

  it("refuses env that changes how the server's runtime loads code", async () => {
    for (const name of LOADERS) {
      const read = readLocalSource(folder({ "mcp/weather/server.json": serverJson() }));
      if (read.status !== "ok") throw new Error(JSON.stringify(read));
      const found = findItems(read.files, { framework: FRAMEWORK });
      if (found.status !== "ok") throw new Error(JSON.stringify(found));
      const built = await buildContent(
        read.source,
        read.files,
        found.items.map((item) => ({ ...item, env: { [name]: "x" } })),
        { framework: FRAMEWORK },
      );
      expect(built, name).toMatchObject({ status: "invalid" });
    }
  });

  it("refuses a server input bound to such a variable", async () => {
    for (const name of ["NODE_OPTIONS", "LD_PRELOAD", "PYTHONPATH"]) {
      const built = await buildServer(
        serverJson((server) => {
          server.packages[0].environmentVariables = [{ name, description: "x" }];
        }),
      );
      expect(built, name).toMatchObject({ status: "invalid" });
    }
  });

  it("keeps ordinary settings such as Python's UTF-8 mode", async () => {
    const content = await serverContent(serverJson(), {
      env: { PYTHONUTF8: "1", WEATHER_UNITS: "metric" },
    });
    expect(planServer(content).status).toBe("ok");
  });
});

describe("the library's own framework", () => {
  const ownSkill = async (framework: string, text = SKILL, name = "tidy") => {
    const read = readLocalSource(folder({ [`skills/${name}/SKILL.md`]: text }, framework));
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    const built = await buildContent(read.source, read.files, found.items, { framework });
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    return built.content;
  };

  it("refuses supplied content that claims Catalog's own framework", async () => {
    const plan = planInstall(["aih.skill.tidy"], [await ownSkill("aih")], [profile("codex")], {
      scope: "project",
      data: null,
    });
    expect(plan).toMatchObject({ status: "invalid" });
  });

  it("refuses two supplied contents of one framework", async () => {
    const first = await ownSkill("alpha");
    const second = await ownSkill("alpha", SKILL, "other");
    const plan = planInstall(["alpha.skill.tidy"], [first, second], [profile("codex")], {
      scope: "project",
      data: null,
    });
    expect(plan).toMatchObject({ status: "invalid" });
  });

  it("renders Catalog's own items only from the library, never from supplied content", async () => {
    const alpha = await ownSkill("alpha");
    const plan = planInstall(["alpha.skill.tidy"], [alpha], [profile("codex")], {
      scope: "project",
      data: null,
    }) as Plan;
    const rendered = plan.plan.find((step) => step.op === "write" && step.render !== undefined);
    if (rendered === undefined) throw new Error("no rendered step");
    const step = JSON.parse(JSON.stringify(rendered).replaceAll("alpha", "aih")) as PlanStep;
    const files = [
      {
        sourceId: "aih",
        sourcePath: "skills/tidy/SKILL.md",
        bytes: new TextEncoder().encode(SKILL),
      },
    ];
    expect(renderStep(step, [await ownSkill("aih")], [profile("codex")], files).status).not.toBe(
      "ok",
    );
  });
});

describe("repository addresses", () => {
  const COMMIT = "a".repeat(40);
  const PLUGIN = {
    name: "pack-base",
    version: "1.0.0",
    description: "The whole pack.",
    author: { name: "Pack authors" },
    license: "MIT",
    keywords: ["recipe"],
  };
  const recipe = (change: Record<string, unknown>) => ({
    schema: "urn:aihq:catalog:recipe:0.1.0",
    id: "pack-base",
    kind: "base",
    framework: "pack",
    content: { repository: "https://example.invalid/team/pack", commit: COMMIT },
    routes: { "claude-code": "plugin" },
    plugins: {
      "claude-code": {
        source: "pack",
        path: "/",
        plugin: "pack",
        commit: COMMIT,
        marketplace: "https://example.invalid/team/pack-marketplace",
        marketplaceName: "pack-dev",
      },
    },
    setup: {},
    clis: {},
    members: [],
    options: [],
    namePrefix: {},
    overrides: [],
    requires: [],
    aiSetup: {},
    data: { repository: "https://example.invalid/team/catalog-data", commit: "b".repeat(40) },
    ...change,
  });
  const encode = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\n`);
  const BAD = [
    "-uhttps://example.invalid/team/pack",
    "ext::sh -c touch",
    "file:///srv/repos/pack",
    "/srv/repos/pack",
    "git@example.invalid:team/pack.git",
    "http://example.invalid/team/pack",
    "https://user:secret@example.invalid/team/pack",
    "https://example.invalid/team/pack?ref=x",
    "https://example.invalid/team/pack#x",
    "https://example.invalid/team/pack x",
    "https://example.invalid/-team/pack",
  ];

  it("reads a recipe whose pins and marketplace are ordinary https repositories", () => {
    expect(readRecipe(encode(PLUGIN), encode(recipe({})))).toMatchObject({ status: "ok" });
  });

  it("refuses a recipe pin, data pin or marketplace that is not an https repository", () => {
    for (const address of BAD) {
      const pins = [
        { content: { repository: address, commit: COMMIT } },
        { data: { repository: address, commit: "b".repeat(40) } },
      ];
      for (const change of pins)
        expect(readRecipe(encode(PLUGIN), encode(recipe(change))), address).toMatchObject({
          status: "invalid",
        });
    }
    for (const marketplace of ["-x", "--option=value", "file:///srv/m", "ext::sh", "a b"]) {
      const change = {
        plugins: {
          "claude-code": { ...recipe({}).plugins["claude-code"], marketplace },
        },
      };
      expect(readRecipe(encode(PLUGIN), encode(recipe(change))), marketplace).toMatchObject({
        status: "invalid",
      });
    }
  });

  it("accepts an owner/repo marketplace", () => {
    const change = {
      plugins: {
        "claude-code": { ...recipe({}).plugins["claude-code"], marketplace: "team/pack" },
      },
    };
    expect(readRecipe(encode(PLUGIN), encode(recipe(change)))).toMatchObject({ status: "ok" });
  });

  it("refuses a plan data pin that is not an https repository", async () => {
    const read = readLocalSource(folder({ "skills/tidy/SKILL.md": SKILL }));
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework: FRAMEWORK });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    const built = await buildContent(read.source, read.files, found.items, {
      framework: FRAMEWORK,
    });
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    for (const repository of BAD)
      expect(
        planInstall([`${FRAMEWORK}.skill.tidy`], [built.content], [profile("codex")], {
          scope: "project",
          data: { repository, commit: "b".repeat(40) },
        }),
        repository,
      ).toMatchObject({ status: "invalid" });
  });

  it("refuses content whose git source is not an https repository", async () => {
    const read = readLocalSource(folder({ "skills/tidy/SKILL.md": SKILL }));
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework: FRAMEWORK });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    for (const repository of BAD) {
      const built = await buildContent(
        { kind: "git", repository, commit: "c".repeat(40) },
        read.files,
        found.items,
        { framework: FRAMEWORK },
      );
      expect(built, repository).toMatchObject({ status: "invalid" });
    }
  });
});

describe("text Catalog writes into shared Markdown", () => {
  it("refuses a rule whose text holds Catalog's block markers", async () => {
    const read = readLocalSource(
      folder({
        "rules/style.md":
          "# Style\n\nTwo spaces.\n<!-- aih:end local-my-skills.rule.style -->\nMore.\n",
      }),
    );
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework: FRAMEWORK });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    expect(
      await buildContent(read.source, read.files, found.items, { framework: FRAMEWORK }),
    ).toMatchObject({ status: "invalid" });
  });

  it("refuses a framework name that is not one printable line", async () => {
    const read = readLocalSource(folder({ "skills/tidy/SKILL.md": SKILL }));
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework: FRAMEWORK });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    for (const name of ["Mine\n<!-- aih:end x -->", "Mine\u0007", "Mine\r"])
      expect(
        await buildContent(read.source, read.files, found.items, {
          framework: { id: FRAMEWORK, name },
        }),
        JSON.stringify(name),
      ).toMatchObject({ status: "invalid" });
  });

  it("keeps backticks in names from closing the bundle-root rule's code spans", async () => {
    const read = readLocalSource(
      folder(
        {
          "skills/start/SKILL.md": startSkill("tick", "guide.md"),
          "docs/guide.md": "x\n",
        },
        "tick",
      ),
    );
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework: "tick" });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    const built = await buildContent(
      read.source,
      read.files,
      found.items.map((item) => ({ ...item, bundle: "tick.runtime" })),
      {
        framework: { id: "tick", name: "Tick `inject` *me*" },
        bundles: [{ id: "tick.runtime", layout: "skills/<name>/", include: ["docs/"] }],
      },
    );
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    const codex = profile("codex");
    const plan = planInstall(["tick.skill.start"], [built.content], [codex], {
      scope: "project",
      data: null,
    }) as Plan;
    const step = plan.plan.find(
      (candidate) => candidate.op === "merge" && candidate.render?.name === "bundle-root",
    );
    if (step === undefined) throw new Error("no bundle-root block");
    const rendered = renderStep(step, [built.content], [codex], []);
    if (rendered.status !== "ok") throw new Error(JSON.stringify(rendered));
    const text = new TextDecoder().decode(rendered.bytes);
    // The name is plain text, so its Markdown punctuation is escaped with backslashes.
    expect(text).toContain("- Tick \\`inject\\` \\*me\\*: its skills in");
  });
});

describe("secrets in files the model reads", () => {
  it("refuses a secret input placed into a skill, rule or agent file", async () => {
    const files = {
      "skills/setup/SKILL.md": "---\nname: setup\ndescription: Set up.\n---\nUse {{TOKEN}}.\n",
      "rules/always.md": "# Always\n\nUse {{TOKEN}}.\n",
      "agents/helper.md": "---\nname: helper\ndescription: Helps.\n---\nUse {{TOKEN}}.\n",
    };
    for (const [sourcePath] of Object.entries(files)) {
      const read = readLocalSource(
        folder({ [sourcePath]: files[sourcePath as keyof typeof files] }),
      );
      if (read.status !== "ok") throw new Error(JSON.stringify(read));
      const found = findItems(read.files, { framework: FRAMEWORK });
      if (found.status !== "ok") throw new Error(JSON.stringify(found));
      const secret = (isSecret: boolean) => ({
        inputs: {
          TOKEN: {
            description: "Token",
            isRequired: true,
            isSecret,
            placeholder: { sourcePath, marker: "{{TOKEN}}" },
          },
        },
      });
      const build = (isSecret: boolean) =>
        buildContent(
          read.source,
          read.files,
          found.items.map((item) => ({ ...item, requirements: secret(isSecret) })),
          { framework: FRAMEWORK },
        );
      expect(await build(true), sourcePath).toMatchObject({ status: "invalid" });
      expect((await build(false)).status, sourcePath).toBe("ok");
    }
  });
});

describe("names that are also object keys", () => {
  it("treats an agent tool named like an object key as one no client maps", async () => {
    const read = readLocalSource(
      folder({
        "agents/helper.md":
          "---\nname: helper\ndescription: Helps.\ntools: toString, constructor\n---\nHelp.\n",
      }),
    );
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework: FRAMEWORK });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    const built = await buildContent(read.source, read.files, found.items, {
      framework: FRAMEWORK,
    });
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    const plan = planInstall([`${FRAMEWORK}.agent.helper`], [built.content], [profile("copilot")], {
      scope: "project",
      data: null,
    }) as Plan;
    expect(plan.warnings).toContainEqual(
      expect.objectContaining({ code: "agent-tools-unrestricted", cli: "copilot" }),
    );
  });
});

describe("a skill's own files", () => {
  it("refuses a skill file outside the skill's folder", async () => {
    const read = readLocalSource(
      folder({ "skills/tidy/SKILL.md": SKILL, "elsewhere/notes.md": "Notes.\n" }),
    );
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework: FRAMEWORK });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    const notes = read.files.find((file) => file.path === "elsewhere/notes.md");
    const items = found.items.map((item) => ({
      ...item,
      files: [
        ...item.files,
        {
          sourceId: FRAMEWORK,
          sourcePath: "elsewhere/notes.md",
          sha256: notes?.sha256 as string,
          executable: false,
          role: "content" as const,
        },
      ],
    }));
    expect(
      await buildContent(read.source, read.files, items, { framework: FRAMEWORK }),
    ).toMatchObject({ status: "invalid" });
  });
});

const GUIDE = "Guide.\n";

describe("bundle roots and other clients' configuration", () => {
  const cases = [
    { cli: "opencode", scope: "user", layout: "opencode/skills/<name>/", file: "git/config" },
    { cli: "cursor", scope: "user", layout: "skills/<name>/", file: "mcp.json" },
    { cli: "codex", scope: "project", layout: "skills/<name>/", file: "mcp_config.json" },
    { cli: "copilot", scope: "project", layout: "skills/<name>/", file: "workflows/ci.yml" },
    { cli: "kimi", scope: "user", layout: "skills/<name>/", file: "mcp.json" },
    // Client files that load, run or configure code, from each client's documentation.
    { cli: "opencode", scope: "user", layout: "skills/<name>/", file: "plugins/x.js" },
    { cli: "opencode", scope: "user", layout: "skills/<name>/", file: "plugin/x.js" },
    { cli: "opencode", scope: "user", layout: "skills/<name>/", file: "tools/x.ts" },
    { cli: "opencode", scope: "user", layout: "skills/<name>/", file: "tool/x.ts" },
    { cli: "opencode", scope: "user", layout: "skills/<name>/", file: "package.json" },
    { cli: "opencode", scope: "user", layout: "skills/<name>/", file: "tui.json" },
    { cli: "opencode", scope: "user", layout: "skills/<name>/", file: "tui.jsonc" },
    { cli: "cursor", scope: "user", layout: "skills/<name>/", file: "hooks.json" },
    { cli: "antigravity", scope: "user", layout: "skills/<name>/", file: "mcp_config.json" },
    { cli: "antigravity", scope: "user", layout: "skills/<name>/", file: "hooks.json" },
    { cli: "antigravity", scope: "user", layout: "skills/<name>/", file: "plugins/x/plugin.json" },
    { cli: "antigravity", scope: "project", layout: "skills/<name>/", file: "hooks.json" },
    {
      cli: "antigravity",
      scope: "project",
      layout: "skills/<name>/",
      file: "plugins/x/plugin.json",
    },
    { cli: "codex", scope: "project", layout: "skills/<name>/", file: "hooks.json" },
    { cli: "codex", scope: "project", layout: "skills/<name>/", file: "plugins/x/plugin.json" },
    { cli: "copilot", scope: "user", layout: "skills/<name>/", file: "lsp-config.json" },
    { cli: "copilot", scope: "user", layout: "skills/<name>/", file: "permissions-config.json" },
    { cli: "copilot", scope: "user", layout: "skills/<name>/", file: "providers.json" },
    { cli: "copilot", scope: "user", layout: "skills/<name>/", file: "extensions/x.js" },
    {
      cli: "copilot",
      scope: "user",
      layout: "skills/<name>/",
      file: "installed-plugins/x/plugin.json",
    },
    { cli: "copilot", scope: "user", layout: "skills/<name>/", file: "copilot-instructions.md" },
    { cli: "copilot", scope: "user", layout: "skills/<name>/", file: "instructions/x.md" },
    { cli: "kimi", scope: "user", layout: "skills/<name>/", file: "tui.toml" },
  ] as const;

  it("never places a bundle file on any shipped client's configuration or outside a client's own folder", async () => {
    for (const { cli, scope, layout, file } of cases) {
      const content = await bundled(
        "alpha",
        {
          "skills/start/SKILL.md": startSkill("alpha", "guide.md"),
          "docs/guide.md": GUIDE,
          [file]: GUIDE,
        },
        ["docs/", file],
        layout,
      );
      const plan = planInstall(["alpha.skill.start"], [content], [profile(cli)], {
        scope,
        data: null,
      }) as Plan;
      const where = `${cli} ${scope} ${file}`;
      expect(plan.status, where).toBe("incomplete");
      expect(plan.unavailable, where).toContainEqual(
        expect.objectContaining({ item: "alpha.skill.start", cli, reason: "no-bundle-place" }),
      );
      const paths = plan.plan.flatMap((step) => ("path" in step ? [step.path] : []));
      expect(
        paths.some((path) => path.endsWith(file)),
        where,
      ).toBe(false);
    }
  });

  it("keeps a bundle in the client's own folder", async () => {
    const content = await bundled(
      "alpha",
      { "skills/start/SKILL.md": startSkill("alpha", "guide.md"), "docs/guide.md": GUIDE },
      ["docs/"],
    );
    for (const [cli, scope, path] of [
      ["opencode", "user", ".config/opencode/docs/guide.md"],
      ["codex", "project", ".agents/docs/guide.md"],
      ["claude-code", "project", ".claude/docs/guide.md"],
    ] as const) {
      const plan = planInstall(["alpha.skill.start"], [content], [profile(cli)], {
        scope,
        data: null,
      }) as Plan;
      expect(
        plan.unavailable.filter((entry) => entry.reason === "no-bundle-place"),
        cli,
      ).toEqual([]);
      expect(
        plan.plan.some((step) => "path" in step && step.path === path),
        cli,
      ).toBe(true);
    }
  });
});

describe("input markers named like object keys", () => {
  it("refuses a marker that names no declared input, even an inherited object key", async () => {
    for (const marker of ["constructor", "toString", "hasOwnProperty"]) {
      const built = await buildServer(
        serverJson((server) => {
          server.packages[0].packageArguments = [{ type: "positional", value: `{${marker}}` }];
        }),
      );
      expect(built, marker).toMatchObject({ status: "invalid" });
    }
  });
});

/** A file that reads as an agent where it sits in agents/, and as plain text elsewhere. */
const PERSONA = "---\nname: guide\ndescription: Guides.\n---\n\nGuide.\n";

describe("what a bundle may place under a client's folder", () => {
  it("places only agents/, resources/, docs/ and references/ under a client's bundle root", async () => {
    for (const file of ["scripts/run.sh", "commands/x.md", "README.md", "skills2/x.md"]) {
      const content = await bundled(
        "alpha",
        {
          "skills/start/SKILL.md": startSkill("alpha", "guide.md"),
          "docs/guide.md": GUIDE,
          [file]: GUIDE,
        },
        ["docs/", file],
      );
      for (const [cli, scope] of [
        ["claude-code", "project"],
        ["codex", "user"],
      ] as const) {
        const plan = planInstall(["alpha.skill.start"], [content], [profile(cli)], {
          scope,
          data: null,
        }) as Plan;
        expect(plan.unavailable, `${cli} ${file}`).toContainEqual(
          expect.objectContaining({ item: "alpha.skill.start", cli, reason: "no-bundle-place" }),
        );
      }
    }
    for (const folder of ["agents", "resources", "docs", "references"]) {
      const content = await bundled(
        "alpha",
        {
          "skills/start/SKILL.md": startSkill("alpha", "guide.md"),
          [`${folder}/notes/guide.md`]: PERSONA,
        },
        [`${folder}/`],
      );
      const plan = planInstall(["alpha.skill.start"], [content], [profile("claude-code")], {
        scope: "project",
        data: null,
      }) as Plan;
      expect(
        plan.plan.some(
          (step) => "path" in step && step.path === `.claude/${folder}/notes/guide.md`,
        ),
        folder,
      ).toBe(true);
    }
  });

  it("keeps Catalog's own bundle folders as they are", async () => {
    const content = await bundled(
      "alpha",
      { "skills/start/SKILL.md": startSkill("alpha", "guide.md"), "scripts/run.md": GUIDE },
      ["scripts/"],
    );
    const plan = planInstall(["alpha.skill.start"], [content], [profile("kiro")], {
      scope: "project",
      data: null,
    }) as Plan;
    expect(
      plan.plan.some((step) => "path" in step && step.path === ".kiro/aih/alpha/scripts/run.md"),
    ).toBe(true);
  });
});

describe("agent files that carry client settings", () => {
  const withKey = (key: string) =>
    `---\nname: helper\ndescription: Helps.\n${key}: {}\n---\n\nHelp.\n`;
  const KEYS = ["hooks", "mcpServers", "mcp-servers", "permissionMode", "PermissionMode"];

  it("refuses an agent whose frontmatter sets hooks, MCP servers or a permission mode", async () => {
    for (const key of KEYS) {
      const read = readLocalSource(folder({ "agents/helper.md": withKey(key) }));
      if (read.status !== "ok") throw new Error(JSON.stringify(read));
      const found = findItems(read.files, { framework: FRAMEWORK });
      if (found.status !== "ok") throw new Error(JSON.stringify(found));
      expect(
        await buildContent(read.source, read.files, found.items, { framework: FRAMEWORK }),
        key,
      ).toMatchObject({ status: "invalid" });
    }
  });

  it("refuses a bundle whose agents/ file sets them, even when it is not an agent item", async () => {
    for (const key of KEYS) {
      const read = readLocalSource(
        folder(
          {
            "skills/start/SKILL.md": startSkill("alpha", "guide.md"),
            "docs/guide.md": GUIDE,
            "agents/helper.md": withKey(key),
          },
          "alpha",
        ),
      );
      if (read.status !== "ok") throw new Error(JSON.stringify(read));
      const found = findItems(read.files, { framework: "alpha" });
      if (found.status !== "ok") throw new Error(JSON.stringify(found));
      const built = await buildContent(
        read.source,
        read.files,
        found.items
          .filter((item) => item.kind === "skill")
          .map((item) => ({ ...item, bundle: "alpha.runtime" })),
        {
          framework: "alpha",
          bundles: [
            { id: "alpha.runtime", layout: "skills/<name>/", include: ["docs/", "agents/"] },
          ],
        },
      );
      expect(built, key).toMatchObject({
        status: "invalid",
        problems: expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining(key) }),
        ]),
      });
    }
  });
});

describe("a caller's own bundle root", () => {
  it("holds a supplied profile's bundle root to the reading folders", async () => {
    const content = await bundled(
      "alpha",
      { "skills/start/SKILL.md": startSkill("alpha", "guide.md"), "scripts/run.md": GUIDE },
      ["scripts/"],
    );
    const kiro = profile("kiro");
    const own = {
      ...kiro,
      bundleRoot: { project: ".kiro/own/<framework>/", user: ".kiro/own/<framework>/" },
    };
    const plan = planInstall(["alpha.skill.start"], [content], [own], {
      scope: "project",
      data: null,
    }) as Plan;
    expect(plan.unavailable).toContainEqual(
      expect.objectContaining({
        item: "alpha.skill.start",
        cli: "kiro",
        reason: "no-bundle-place",
      }),
    );
  });
});
