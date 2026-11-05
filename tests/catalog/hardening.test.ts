import { describe, expect, it } from "vitest";
import { readLocalSource } from "../../src/catalog/node.js";
import { buildContent } from "../../src/catalog/producer.js";
import {
  type Content,
  type Plan,
  type PlanStep,
  planInstall,
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
): Promise<Content> {
  const read = readLocalSource(folder(tree, id));
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  const found = findItems(read.files, { framework: id });
  if (found.status !== "ok") throw new Error(JSON.stringify(found));
  const built = await buildContent(
    read.source,
    read.files,
    found.items.map((item) => ({ ...item, bundle: `${id}.runtime` })),
    { framework: id, bundles: [{ id: `${id}.runtime`, layout: "skills/<name>/", include }] },
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
    for (const url of ["http://weather.example/mcp", "ftp://weather.example/mcp"]) {
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
