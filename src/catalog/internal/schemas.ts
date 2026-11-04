/**
 * The five published JSON Schemas (draft 2020-12), one per format. They describe the shape
 * the readers admit; the readers also check what a schema cannot express (recomputed digests,
 * sorted and unique lists, cross-references between fields and canonical bytes), so a document
 * that conforms can still read `invalid`. Patterns are the readers' own expressions. Pure data.
 */
import {
  DATE,
  EXACT_VERSION,
  FRAMEWORK_ID,
  ID_SEGMENT,
  INPUT_NAME,
  INSTALL_NAME,
  NAMESPACED_NAME,
  NPM_PACKAGE,
  OBJECT_ID,
  RANGE,
  SCAN_KEY,
  SHA256,
  TOOL_NAME,
  WHEEL,
} from "./model.js";

type Schema = Readonly<Record<string, unknown>>;

const DRAFT = "https://json-schema.org/draft/2020-12/schema";
const KINDS = ["skill", "agent", "rule", "hook", "mcp", "document", "ai-setup"];
const CELLS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "windows-arm64",
  "windows-x64",
];
/** A relative path: no leading `/`, drive letter, backslash, NUL, empty, `.` or `..` segment. */
const SAFE_PATH = String.raw`^(?![A-Za-z]:)(?!(?:.*/)?\.{1,2}(?:/|$))[^/\\\u0000]+(?:/[^/\\\u0000]+)*$`;
const SEGMENT = ID_SEGMENT.source.slice(1, -1);
const ITEM_ID = `^${FRAMEWORK_ID.source.slice(1, -1)}\\.(?:${KINDS.join("|")})\\.${SEGMENT}(?:\\.${SEGMENT})*$`;
const WARNING = "^[a-z0-9-]+$";
const KEBAB_EVENT = "^[a-z]+(?:-[a-z]+)*$";
const FRONTMATTER_KEY = "^[A-Za-z][A-Za-z0-9_.-]*$";

const text = (maxLength = 4096): Schema => ({ type: "string", minLength: 1, maxLength });
const pattern = (expression: RegExp | string, maxLength?: number): Schema => ({
  type: "string",
  pattern: typeof expression === "string" ? expression : expression.source,
  ...(maxLength === undefined ? {} : { maxLength }),
});
const ref = (name: string): Schema => ({ $ref: `#/$defs/${name}` });
const list = (items: Schema, minItems = 0): Schema => ({
  type: "array",
  items,
  ...(minItems > 0 ? { minItems } : {}),
});
const map = (values: Schema, propertyNames?: Schema): Schema => ({
  type: "object",
  additionalProperties: values,
  ...(propertyNames ? { propertyNames } : {}),
});
/** A closed object: `required` defaults to every property. */
const record = (
  properties: Record<string, Schema>,
  required: readonly string[] = Object.keys(properties),
): Schema => ({
  type: "object",
  additionalProperties: false,
  properties,
  ...(required.length > 0 ? { required } : {}),
});
/** A JSON Schema conditional; `then` is the keyword's own name (biome.json allows it here). */
const when = (condition: Schema, then: Schema, otherwise?: Schema): Schema => ({
  if: condition,
  then,
  ...(otherwise === undefined ? {} : { else: otherwise }),
});
const oneOf = (...options: Schema[]): Schema => ({ oneOf: options });
const constant = (value: unknown): Schema => ({ const: value });
const choice = (...values: string[]): Schema => ({ enum: values });
const byScope = (place: Schema): Schema => record({ project: place, user: place }, []);
const count: Schema = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const seconds: Schema = { type: "integer", minimum: 1, maximum: 86_400 };
const bool: Schema = { type: "boolean" };
const argv: Schema = list({ type: "string", maxLength: 4096 });
const argvList = (max = 4096): Schema => list(list(text(max), 1), 1);
const scalarFrontmatter: Schema = map(
  { oneOf: [{ type: "boolean" }, { type: "number" }, text(256)] },
  pattern(FRONTMATTER_KEY),
);

/** Shared definitions: the AI setup record is used by content; its settings by recipes. */
const shared = {
  sha256: pattern(SHA256),
  path: pattern(SAFE_PATH, 4096),
  frameworkId: pattern(FRAMEWORK_ID, 128),
  itemId: pattern(ITEM_ID, 512),
  exactVersion: pattern(EXACT_VERSION, 128),
  cell: choice(...CELLS),
  toolNames: { ...list(pattern(TOOL_NAME)), uniqueItems: true },
  env: map({ type: "string", maxLength: 4096 }, pattern(INPUT_NAME)),
  member: record({ path: ref("path"), sha256: ref("sha256"), executable: bool }),
  settings: record({
    commands: list(
      record({
        argv: { ...argv, minItems: 1 },
        readback: record({ argv: { ...argv, minItems: 1 }, expected: { type: "string" } }),
      }),
    ),
    files: list(
      record({ sourcePath: ref("path"), root: choice("user", "project"), path: ref("path") }),
    ),
  }),
} satisfies Record<string, Schema>;

const aiSetup: Schema = {
  ...record(
    {
      version: ref("exactVersion"),
      distributions: list(
        {
          ...record(
            {
              cells: { ...list(ref("cell"), 1), uniqueItems: true },
              kind: choice("pypi-wheel", "native-archive", "npm", "git"),
              file: pattern("^[^/\\\\]+$", 512),
              url: pattern("^https://", 2048),
              sha256: ref("sha256"),
              bytes: count,
              members: list(ref("member"), 1),
              integrity: pattern("^sha512-[A-Za-z0-9+/]+={0,2}$"),
            },
            ["cells", "kind", "sha256", "bytes"],
          ),
          anyOf: [{ required: ["file"] }, { required: ["url"] }],
          allOf: [
            when(
              { properties: { kind: constant("native-archive") } },
              { required: ["members"] },
              { not: { required: ["members"] } },
            ),
            when(
              { properties: { kind: constant("npm") } },
              { required: ["integrity"] },
              { not: { required: ["integrity"] } },
            ),
          ],
        },
        0,
      ),
      runtime: record({ python: pattern(RANGE), node: pattern(RANGE), closure: text(64) }, []),
      executable: pattern(TOOL_NAME),
      launch: record({ args: argv, clis: map(argv, ref("frameworkId")) }, ["args"]),
      mcpItem: text(512),
      settings: ref("settings"),
      doNotRun: list({ ...argv, minItems: 1 }),
      qualifications: { ...list(ref("sha256")), uniqueItems: true },
      licenceNotice: text(),
    },
    ["version", "distributions", "executable", "launch", "settings", "doNotRun", "qualifications"],
  ),
};

/** The MCP setting fields an `mcp` item and a recipe's AI setup change share. */
const mcpSettings = {
  enabledTools: ref("toolNames"),
  disabledTools: ref("toolNames"),
  startupSeconds: seconds,
  callSeconds: seconds,
  env: ref("env"),
} satisfies Record<string, Schema>;

const recordedFile = record({
  sourcePath: ref("path"),
  sha256: ref("sha256"),
  bytes: count,
  executable: bool,
});
const itemFile = record(
  {
    sourceId: ref("frameworkId"),
    sourcePath: ref("path"),
    sha256: ref("sha256"),
    bytes: count,
    executable: bool,
    role: choice("content", "behaviour"),
    cli: text(64),
    derivedFrom: record({ sourcePath: ref("path"), pointer: { type: "string" } }),
  },
  ["sourceId", "sourcePath", "sha256", "bytes", "executable", "role"],
);
const includePattern: Schema = {
  type: "string",
  maxLength: 512,
  not: { pattern: "\\*\\*|\\*.*/$" },
  pattern: String.raw`^(?![A-Za-z]:)(?!(?:.*/)?\.{1,2}(?:/|$))[^/\\\u0000]+(?:/[^/\\\u0000]+)*/?$`,
};

/** Fields only one kind records: present ⇒ that kind. */
const OWNED: Readonly<Record<string, string>> = {
  agent: "agent",
  server: "mcp",
  enabledTools: "mcp",
  disabledTools: "mcp",
  startupSeconds: "mcp",
  callSeconds: "mcp",
  env: "mcp",
  event: "hook",
  matcher: "hook",
  handler: "hook",
  purpose: "document",
  aiSetup: "ai-setup",
  userOnly: "skill",
  arguments: "skill",
  scope: "rule",
};
const REQUIRED_BY_KIND: Readonly<Record<string, readonly string[]>> = {
  skill: ["userOnly", "arguments"],
  rule: ["scope"],
  agent: ["agent"],
  hook: ["event", "handler"],
  mcp: ["server"],
  document: ["purpose"],
  "ai-setup": ["aiSetup"],
};

const content: Schema = {
  $schema: DRAFT,
  $id: "urn:aihq:catalog:content:0.1.0",
  title: "Catalog content",
  description:
    "One framework's sources, items, runtime bundles and recorded plugin folders, at exact pins.",
  ...record(
    {
      schema: constant("urn:aihq:catalog:content:0.1.0"),
      framework: record({ id: ref("frameworkId"), name: text(200) }),
      sources: list(ref("source")),
      items: list(ref("item")),
      bundles: list(ref("bundle")),
      plugins: list(ref("plugin")),
    },
    ["schema", "framework", "sources", "items"],
  ),
  $defs: {
    ...shared,
    scanKey: pattern(SCAN_KEY),
    itemFile,
    recordedFile,
    notice: record({
      sourcePath: ref("path"),
      sha256: ref("sha256"),
      covers: { anyOf: [constant("/"), ref("path")] },
    }),
    source: {
      ...record(
        {
          id: ref("frameworkId"),
          kind: choice("git", "npm", "local", "authored"),
          repository: text(2048),
          commit: pattern(OBJECT_ID),
          package: pattern(NPM_PACKAGE, 2048),
          version: ref("exactVersion"),
          subpath: ref("path"),
          notices: list(ref("notice")),
          noticesFor: list(text(512)),
        },
        ["id", "kind", "notices"],
      ),
      allOf: [
        when(
          { properties: { kind: constant("git") } },
          {
            required: ["repository", "commit"],
            not: { anyOf: [{ required: ["package"] }, { required: ["version"] }] },
          },
        ),
        when(
          { properties: { kind: constant("npm") } },
          {
            required: ["package", "version"],
            not: {
              anyOf: [
                { required: ["repository"] },
                { required: ["commit"] },
                { required: ["subpath"] },
              ],
            },
          },
        ),
        when(
          { properties: { kind: constant("local") } },
          {
            not: {
              anyOf: ["repository", "commit", "package", "version", "subpath"].map((key) => ({
                required: [key],
              })),
            },
          },
        ),
      ],
    },
    bundle: record({
      id: pattern(`^${SEGMENT}(?:\\.${SEGMENT})*$`, 512),
      sourceId: ref("frameworkId"),
      layout: pattern("^(?:[a-z0-9][a-z0-9_-]*/)*<name>/$"),
      files: list(ref("recordedFile"), 1),
      scanKey: ref("scanKey"),
    }),
    plugin: record(
      {
        sourceId: ref("frameworkId"),
        path: { anyOf: [constant("/"), ref("path")] },
        include: { ...list(includePattern, 1), uniqueItems: true },
        plugin: pattern(INSTALL_NAME, 64),
        files: list(ref("recordedFile"), 1),
        scanKey: ref("scanKey"),
        folderScanKey: ref("scanKey"),
      },
      ["sourceId", "path", "files", "scanKey"],
    ),
    input: record(
      {
        description: text(1024),
        isRequired: bool,
        isSecret: bool,
        default: { type: "string" },
        placeholder: record({ sourcePath: ref("path"), marker: text(128) }),
      },
      ["description", "isRequired", "isSecret"],
    ),
    edition: record({ files: list(ref("itemFile"), 1), scanKey: ref("scanKey") }),
    aiSetup,
    item: {
      ...record(
        {
          id: ref("itemId"),
          kind: choice(...KINDS),
          name: pattern(INSTALL_NAME, 64),
          description: text(1024),
          files: list(ref("itemFile")),
          contentSha256: ref("sha256"),
          behaviourSha256: ref("sha256"),
          scanKey: ref("scanKey"),
          userOnly: bool,
          arguments: bool,
          scope: oneOf(
            choice("always", "on-request"),
            record({ paths: list(text(1024), 1) }),
            record({ byDescription: constant(true) }),
          ),
          language: pattern(ID_SEGMENT, 64),
          requirements: record(
            {
              inputs: map(ref("input"), pattern(INPUT_NAME)),
              tools: { type: "array" },
            },
            ["inputs"],
          ),
          dependencies: list(text(512)),
          references: {
            ...list(record({ name: pattern(NAMESPACED_NAME), sourcePath: ref("path") }), 1),
            uniqueItems: true,
          },
          bundle: text(512),
          pathReferences: list(
            record({ cli: ref("frameworkId"), sourcePath: ref("path"), path: ref("path") }, [
              "sourcePath",
              "path",
            ]),
            1,
          ),
          supersedes: list(text(512)),
          fetch: constant("upstream"),
          editions: map(ref("edition"), ref("frameworkId")),
          cli: text(64),
          agent: record(
            {
              prompt: ref("path"),
              tools: list(text(128)),
              model: text(128),
              color: text(128),
              background: bool,
            },
            ["prompt"],
          ),
          server: {
            type: "object",
            description:
              "The Registry server.json, as the upstream or a cut-out entry gives it; its own schema governs the other fields.",
            properties: { name: text(256), description: text(1024) },
            required: ["name", "description"],
          },
          event: pattern(KEBAB_EVENT, 64),
          matcher: { type: "string" },
          handler: { type: "object", properties: { type: text(64) }, required: ["type"] },
          purpose: text(256),
          aiSetup: ref("aiSetup"),
          ...mcpSettings,
        },
        ["id", "kind", "name", "description", "files", "contentSha256", "behaviourSha256"],
      ),
      allOf: [
        ...Object.entries(REQUIRED_BY_KIND).map(([kind, required]) =>
          when({ properties: { kind: constant(kind) }, required: ["kind"] }, { required }),
        ),
        ...Object.entries(OWNED).map(([field, kind]) =>
          when({ required: [field] }, { properties: { kind: constant(kind) } }),
        ),
        when(
          { properties: { kind: { not: constant("ai-setup") } } },
          { properties: { files: { minItems: 1 } } },
        ),
      ],
    },
  },
};

/** A place: a template with `<name>`, or a folder shared with other clients when planned. */
const place = (folder: boolean): Schema => {
  const template = pattern(folder ? "<name>.*/$" : "<name>(?!.*/$)", 512);
  return oneOf(template, record({ reuse: list(template, 1), otherwise: template }));
};
const jsonMerge = (key: Schema = pattern("^/")): Schema =>
  record({ file: text(512), format: constant("json"), key, entry: {} });
const rulePlace: Schema = oneOf(
  pattern("<name>(?!.*/$)", 512),
  record(
    { merge: constant("markdown"), file: text(512), limitBytes: { type: "integer", minimum: 1 } },
    ["merge", "file"],
  ),
);
const field64: Schema = pattern(FRONTMATTER_KEY, 64);
const constantSet: Schema = map(text(64));
const inputReference: Schema = oneOf(
  choice("none", "unknown"),
  record({ syntax: pattern("<name>", 64) }),
);
const warnings: Schema = list(pattern(WARNING, 64));

const toolProfile: Schema = {
  $schema: DRAFT,
  $id: "urn:aihq:catalog:tool-profile:0.1.0",
  title: "Catalog tool profile",
  description:
    "How one client names, places and flags each kind, and which native mechanisms it has.",
  ...record(
    {
      schema: constant("urn:aihq:catalog:tool-profile:0.1.0"),
      id: pattern(FRAMEWORK_ID, 64),
      name: text(200),
      version: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      checkedWith: list(record({ app: text(64), version: text(64), date: pattern(DATE) }), 1),
      places: record(
        {
          skill: byScope(place(true)),
          agent: byScope(place(false)),
          rule: byScope(
            record(
              {
                always: rulePlace,
                paths: rulePlace,
                "on-request": rulePlace,
                "by-description": rulePlace,
              },
              [],
            ),
          ),
          mcp: byScope(
            record({ file: text(512), format: choice("json", "toml"), key: pattern("<name>") }),
          ),
          document: byScope(pattern("<name>.*/$", 512)),
        },
        [],
      ),
      editionPlaces: record(
        {
          agent: byScope(pattern("/$", 512)),
          rule: byScope(pattern("/$", 512)),
          hook: byScope(pattern("/$", 512)),
        },
        [],
      ),
      unsupported: { ...map(text(256)), propertyNames: choice(...KINDS) },
      links: record({ skill: choice("documented", "not-documented") }),
      userOnly: oneOf(
        constant("none"),
        record({ frontmatter: scalarFrontmatter }),
        record({ file: record({ path: text(512), yaml: { type: "object" } }) }),
      ),
      userOnlyFallback: byScope(
        list(
          record(
            {
              id: text(64),
              path: pattern("<name>(?!.*/$)", 512),
              frontmatter: scalarFrontmatter,
              arguments: choice("kept", "reworded"),
            },
            ["id", "path", "arguments"],
          ),
          1,
        ),
      ),
      arguments: choice("substituted", "chat-text"),
      foldDescription: constant(true),
      agentFile: record(
        {
          format: choice("claude-md", "md", "toml", "json"),
          fields: list(choice("name", "description"), 1),
          tools: oneOf(choice("keep", "none"), map(text(128))),
          model: choice("keep", "drop"),
        },
        ["format", "tools", "model"],
      ),
      ruleScopes: record(
        Object.fromEntries(
          ["always", "paths", "on-request", "by-description"].map((scope) => [
            scope,
            record(
              {
                frontmatter: scalarFrontmatter,
                globs: field64,
                form: choice("list", "comma", "single-or-list"),
                describe: list(choice("name", "description")),
              },
              scope === "paths" ? ["frontmatter", "globs", "form"] : ["frontmatter"],
            ),
          ]),
        ),
        [],
      ),
      hookEvents: map(text(64), pattern(KEBAB_EVENT)),
      mcpFile: record(
        {
          stdio: record(
            { command: field64, args: field64, argv: field64, env: field64, set: constantSet },
            [],
          ),
          remote: record(
            Object.fromEntries(
              ["streamable-http", "sse"].map((transport) => [
                transport,
                record({ url: text(64), headers: field64, set: constantSet }, ["url"]),
              ]),
            ),
            [],
          ),
          tools: { ...record({ enabled: field64, disabled: field64 }, []), minProperties: 1 },
        },
        [],
      ),
      inputReferences: record({
        file: inputReference,
        "mcp-argv": inputReference,
        "mcp-env": inputReference,
        "mcp-header": inputReference,
      }),
      plugins: record(
        {
          pin: choice("holds", "drops-on-update", "none"),
          scopes: { ...list(choice("project", "user"), 1), uniqueItems: true },
          pinForm: choice("marketplace", "local-marketplace", "spec"),
          marketplaceFolder: pattern("/$", 512),
          install: argvList(512),
          remove: argvList(512),
          verify: oneOf(constant("none"), record({ argv: list(text(512), 1), expect: text(512) })),
          warnings,
        },
        ["pin", "verify"],
      ),
      localPlugins: byScope(
        record(
          {
            folder: pattern("/$", 512),
            manifests: list(ref("path"), 1),
            register: list(jsonMerge()),
            warnings,
          },
          ["folder", "manifests"],
        ),
      ),
      bundleRoot: byScope(pattern("<framework>.*/$", 512)),
      bundleWarnings: list(text(64)),
      skillFolderOverlap: record({
        folders: { ...list(pattern("/$", 512)), minItems: 2, maxItems: 2 },
        merge: jsonMerge(),
        warnings: list(text(64)),
      }),
      provides: record(
        Object.fromEntries(
          ["skill", "command", "agent"].map((kind) => [
            kind,
            { ...list(text(128), 1), uniqueItems: true },
          ]),
        ),
        [],
      ),
      disableBuiltIn: oneOf(
        constant("not-documented"),
        record(
          {
            sameName: constant("replaces"),
            setting: record({
              root: choice("project", "user"),
              file: text(512),
              format: constant("json"),
              key: pattern("^/.*<name>"),
              entry: {},
            }),
            manual: text(512),
            warnings,
          },
          [],
        ),
      ),
    },
    [
      "schema",
      "id",
      "name",
      "version",
      "checkedWith",
      "places",
      "links",
      "userOnly",
      "arguments",
      "inputReferences",
    ],
  ),
  $defs: { path: shared.path },
};

const pin = (commit: RegExp | string = OBJECT_ID): Schema =>
  record({ repository: text(2048), commit: pattern(commit) });
const recipeMember: Schema = record({ item: text(512), preTicked: bool });

const recipe: Schema = {
  $schema: DRAFT,
  $id: "urn:aihq:catalog:recipe:0.1.0",
  title: "Catalog recipe",
  description:
    "A one-click choice shipped as a Git plugin beside its Agent Plugins plugin.json: one route per client, its items and choice groups, and the Catalog data commit it was written against.",
  ...record(
    {
      schema: constant("urn:aihq:catalog:recipe:0.1.0"),
      id: ref("frameworkId"),
      kind: choice("base", "add-on", "combination"),
      framework: ref("frameworkId"),
      frameworks: { ...list(ref("frameworkId")), minItems: 2, uniqueItems: true },
      content: oneOf(pin(), { ...map(pin(), ref("frameworkId")), not: { required: ["commit"] } }),
      routes: map(choice("plugin", "local-plugin", "setup", "items"), ref("frameworkId")),
      plugins: map(
        record(
          {
            source: ref("frameworkId"),
            path: { anyOf: [constant("/"), ref("path")] },
            plugin: pattern(INSTALL_NAME, 64),
            commit: pattern(OBJECT_ID),
            marketplace: text(2048),
          },
          ["source", "path", "plugin", "commit"],
        ),
        ref("frameworkId"),
      ),
      setup: map(
        record({
          repository: text(2048),
          commit: pattern(OBJECT_ID),
          into: ref("path"),
          command: list(text(), 1),
          needs: list(text(256)),
        }),
        ref("frameworkId"),
      ),
      clis: map({ ...list(choice(...KINDS), 1), uniqueItems: true }, ref("frameworkId")),
      members: list(recipeMember),
      options: list(
        record({
          id: ref("frameworkId"),
          pick: choice("one", "several"),
          items: list(recipeMember, 1),
        }),
      ),
      namePrefix: map(pattern("^(?:[a-z0-9]+-)*$", 32), ref("frameworkId")),
      overrides: list(record({ item: text(512), replaces: text(128) })),
      requires: list(text(128)),
      aiSetup: map(record({ ...mcpSettings, settings: ref("settings") }, [])),
      qualifications: { ...map(ref("sha256")), propertyNames: ref("cell") },
      data: pin("^[0-9a-f]{40}$"),
    },
    ["schema", "id", "kind", "content", "routes", "members", "data"],
  ),
  allOf: [
    when(
      { properties: { kind: constant("combination") }, required: ["kind"] },
      {
        required: ["frameworks"],
        not: { required: ["framework"] },
        properties: { content: { not: { required: ["commit"] } } },
      },
      {
        required: ["framework"],
        not: { anyOf: [{ required: ["frameworks"] }, { required: ["qualifications"] }] },
        properties: { content: { required: ["repository", "commit"] } },
      },
    ),
    when(
      { properties: { kind: constant("add-on") }, required: ["kind"] },
      { required: ["requires"], properties: { requires: { minItems: 1 } } },
      { properties: { requires: { maxItems: 0 } } },
    ),
  ],
  $defs: {
    path: shared.path,
    frameworkId: shared.frameworkId,
    sha256: shared.sha256,
    cell: shared.cell,
    toolNames: shared.toolNames,
    env: shared.env,
    settings: shared.settings,
  },
};

const qualification: Schema = {
  $schema: DRAFT,
  $id: "urn:aihq:catalog:qualification:0.1.0",
  title: "Catalog qualification",
  description:
    "The exact bytes one qualification run saw for an AI setup version (or a combination recipe) on one platform cell, and the run's result.",
  ...record({
    schema: constant("urn:aihq:catalog:qualification:0.1.0"),
    subject: oneOf(
      record({
        aiSetup: pattern(
          `^${FRAMEWORK_ID.source.slice(1, -1)}\\.ai-setup\\.${SEGMENT}(?:\\.${SEGMENT})*$`,
          512,
        ),
        version: ref("exactVersion"),
        cell: ref("cell"),
      }),
      record({ recipe: ref("frameworkId"), cell: ref("cell") }),
    ),
    observed: oneOf(
      record(
        {
          artifact: {
            ...record(
              {
                file: text(512),
                url: text(2048),
                sha256: ref("sha256"),
                bytes: count,
              },
              ["sha256", "bytes"],
            ),
            anyOf: [{ required: ["file"] }, { required: ["url"] }],
          },
          members: list(ref("member"), 1),
          closure: oneOf(
            { type: "null" },
            list(
              record({
                name: text(256),
                version: text(128),
                file: pattern(WHEEL),
                sha256: ref("sha256"),
              }),
              1,
            ),
          ),
          interpreter: oneOf(
            { type: "null" },
            record({
              version: ref("exactVersion"),
              file: text(512),
              sha256: ref("sha256"),
              bytes: count,
            }),
          ),
        },
        ["artifact", "closure", "interpreter"],
      ),
      record({ qualifications: { ...list(ref("sha256")), minItems: 2, uniqueItems: true } }),
    ),
    result: {
      ...record(
        {
          status: choice("qualified", "blocked", "unknown"),
          reason: text(1024),
          run: ref("sha256"),
          date: pattern(DATE),
        },
        ["status", "run", "date"],
      ),
      allOf: [
        when({ properties: { status: constant("blocked") } }, { required: ["reason"] }),
        when({ properties: { status: constant("qualified") } }, { not: { required: ["reason"] } }),
      ],
    },
  }),
  allOf: [
    when(
      { properties: { subject: { required: ["recipe"] } } },
      { properties: { observed: { required: ["qualifications"] } } },
      { properties: { observed: { required: ["artifact"] } } },
    ),
  ],
  $defs: {
    sha256: shared.sha256,
    path: shared.path,
    frameworkId: shared.frameworkId,
    exactVersion: shared.exactVersion,
    cell: shared.cell,
    member: shared.member,
  },
};

const candidate: Schema = oneOf(
  record({ kind: constant("local"), path: text() }),
  record({ kind: constant("git"), repository: text(2048), ref: text(), subpath: ref("path") }, [
    "kind",
    "repository",
  ]),
  {
    ...record(
      {
        kind: constant("npm"),
        package: pattern(NPM_PACKAGE, 214),
        version: ref("exactVersion"),
        range: text(256),
      },
      ["kind", "package"],
    ),
    not: { required: ["version", "range"] },
  },
);

const sourceLink: Schema = {
  $schema: DRAFT,
  $id: "urn:aihq:catalog:source-link:0.1.0",
  title: "Catalog source-link result",
  description:
    "What parseSourceLink read from pasted text: a source candidate, the reason it named none, or a refusal. The text is never fetched or run.",
  oneOf: [
    record({
      schema: constant("urn:aihq:catalog:source-link:0.1.0"),
      status: constant("recognised"),
      candidate,
    }),
    record({
      schema: constant("urn:aihq:catalog:source-link:0.1.0"),
      status: constant("unrecognised"),
      reason: text(),
    }),
    record(
      {
        schema: constant("urn:aihq:catalog:source-link:0.1.0"),
        status: constant("refused"),
        code: text(64),
        reason: text(),
        limit: text(64),
      },
      ["schema", "status", "code", "reason"],
    ),
  ],
  $defs: { path: shared.path, exactVersion: shared.exactVersion },
};

export const schemaDocuments = {
  "source-link": sourceLink,
  content,
  "tool-profile": toolProfile,
  recipe,
  qualification,
} as const;
