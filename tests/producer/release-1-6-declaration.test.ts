import { expect, it } from "vitest";
import {
  checkProducerDeclaration,
  compileProducerDeclaration,
  prepareSourceRefresh,
} from "../../src/release/producer.js";
import { readReleaseContent } from "../../src/release/reader.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const AGENT_DIRECTORY = {
  type: "string" as const,
  required: true,
  default: ".claude",
  minLength: 1,
  maxLength: 64,
  description: "Project directory that receives skills/<name>/ (Claude Code reads .claude).",
};

const SKILL = `---
description: Review the proposed setup.
---
# Review

Check the setup carefully.
`;

const MCP_SKILL = `---
description: Serve the notes index.
---
# Notes server

Runs the notes MCP server.
`;

const declaration = () => ({
  schema: "urn:aihq:catalog:producer-declaration:3.2.0",
  format: "aihq-catalog-producer-declaration",
  version: 3,
  framework: {
    id: "example-framework",
    name: "Example Framework",
    version: "1.0.0",
    description: "Framework for the 3.2.0 producer tests.",
  },
  sources: [{ id: "notes", repository: "example/notes", licensePath: "LICENSE", license: "MIT" }],
  items: [
    {
      id: "notes.review",
      source: "notes",
      label: "Review",
      description: "Review skill",
      kind: "skill",
      skillPath: "review/SKILL.md",
      requires: [],
      optional: [],
      conflicts: [],
      clientCapabilities: [],
      activation: [],
      configuration: { agentDirectory: AGENT_DIRECTORY },
      provenance: { selectedBy: "example-curator" },
    },
    {
      id: "notes.mcp",
      source: "notes",
      label: "MCP server",
      description: "Captured MCP definition",
      kind: "mcp-server",
      skillPath: "mcp/SKILL.md",
      requires: [],
      optional: [],
      conflicts: [],
      clientCapabilities: [],
      activation: [],
      configuration: { agentDirectory: AGENT_DIRECTORY },
      requirements: {
        inputs: { serverToken: { type: "string", required: true, sensitive: true } },
      },
      payload: {
        key: "notes",
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        env: { notes_token: { input: "serverToken" } },
        derivation: {
          sourceMaterial: "skill",
          pointer: "review/SKILL.md",
          transform: "identical",
        },
      },
    },
  ],
});

const sourceFiles = (): {
  source: string;
  revision: string;
  files: Record<string, Uint8Array>;
  modes?: Record<string, number>;
}[] => [
  {
    source: "notes",
    revision: "a".repeat(40),
    files: {
      LICENSE: encode("MIT license fixture\n"),
      "review/SKILL.md": encode(SKILL),
      "mcp/SKILL.md": encode(MCP_SKILL),
    },
  },
];

it("checks a 3.2.0 declaration and refuses an unknown schema precisely", () => {
  const checked = checkProducerDeclaration(declaration());
  expect(checked.status).toBe("ok");
  const unknown = checkProducerDeclaration({
    ...declaration(),
    schema: "urn:aihq:catalog:producer-declaration:4.0.0",
  });
  expect(unknown.status).toBe("refused");
  if (unknown.status !== "refused") return;
  expect(unknown.diagnostics[0]?.code).toBe("SCHEMA_UNSUPPORTED");
});

it("requires the framework identity on a 3.2.0 declaration", () => {
  const withoutFramework = { ...declaration() } as Record<string, unknown>;
  delete withoutFramework.framework;
  const compiled = compileProducerDeclaration({
    declaration: withoutFramework,
    sourceFiles: sourceFiles(),
  });
  expect(compiled.status).toBe("refused");
  if (compiled.status !== "refused") return;
  expect(compiled.diagnostics[0]?.path).toBe("/framework");
});

it("compiles a 3.2.0 declaration into release 1.6.0 with behaviour files and identities", () => {
  const compiled = compileProducerDeclaration({
    declaration: declaration(),
    sourceFiles: sourceFiles(),
  });
  expect(compiled.status).toBe("ok");
  if (compiled.status !== "ok") return;
  expect(compiled.value.release.schema).toBe("urn:aihq:catalog:release:1.6.0");
  expect(compiled.value.release.framework?.id).toBe("example-framework");
  expect(compiled.value.release.sources[0]?.license).toBe("MIT");
  const review = compiled.value.release.items.find((item) => item.id === "notes.review");
  expect(review).toBeDefined();
  if (review === undefined) return;
  const behaviour = review.materials.find(
    (member) => (member as unknown as Record<string, unknown>).role === "behaviour",
  ) as unknown as Record<string, unknown> | undefined;
  expect(behaviour).toBeDefined();
  expect(behaviour?.relPath).toBe("aih-behaviour.json");
  expect(behaviour?.sourcePath).toBeNull();
  expect(behaviour?.sourceId).toBe("example-framework");
  expect(behaviour?.packagePath).toBe("release/items/notes.review/aih-behaviour.json");
  expect(review.contentSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(review.behaviourSha256).toMatch(/^[0-9a-f]{64}$/);
  // The derived skill payload names the installed directory.
  const payload = review.payload as Record<string, unknown>;
  expect(payload.dirName).toBe("review");
  expect(payload.invocation).toBe("user-only");
  // The supplied snapshot carries no file modes: executable state is unknown, never inferred.
  expect(review.executable).toEqual({ LICENSE: "unknown", "SKILL.md": "unknown" });
  // True provenance defaults to the source repository; selection is recorded.
  expect(review.source).toBe("https://github.com/example/notes");
  expect(review.selectedBy).toBe("example-curator");
  // The behaviour file bytes ship as a package member.
  const behaviourOutput = compiled.value.materials.find(
    (member) => member.path === "release/items/notes.review/aih-behaviour.json",
  );
  expect(behaviourOutput).toBeDefined();
  // Every material carries a measured size.
  for (const member of review.materials as unknown as Record<string, unknown>[]) {
    expect(member.size).toMatchObject({ status: "measured" });
  }
  // The compiled release is pre-baseline content; it passes the content admission.
  const reread = readReleaseContent(compiled.value.releaseBytes, {
    expectedSha256: compiled.value.releaseSha256,
  });
  expect(reread.valid).toBe(true);
  if (!reread.valid) return;
  expect(reread.release.baseline).toBeUndefined();
});

it("captures MCP payloads through the behaviour file with declared requirement inputs", () => {
  const compiled = compileProducerDeclaration({
    declaration: declaration(),
    sourceFiles: sourceFiles(),
  });
  expect(compiled.status).toBe("ok");
  if (compiled.status !== "ok") return;
  const mcp = compiled.value.release.items.find((item) => item.id === "notes.mcp");
  expect(mcp).toBeDefined();
  if (mcp === undefined) return;
  const payload = mcp.payload as Record<string, unknown>;
  expect(payload.transport).toBe("stdio");
  expect(mcp.requirements?.inputs?.serverToken?.sensitive).toBe(true);
  // MCP definitions are captured materials: distinct bytes give distinct identities.
  const review = compiled.value.release.items.find((item) => item.id === "notes.review");
  expect(mcp.contentSha256).not.toBe(review?.contentSha256);
  expect(mcp.behaviourSha256).not.toBe(review?.behaviourSha256);
});

it("refuses a 3.2.0 item whose kind payload cannot be derived", () => {
  const declarationWithRule = declaration() as unknown as {
    items: Record<string, unknown>[];
  };
  declarationWithRule.items = [
    {
      ...(declarationWithRule.items[0] as Record<string, unknown>),
      id: "notes.rule",
      kind: "rule",
      skillPath: "rule/SKILL.md",
    },
  ];
  const files = sourceFiles();
  const first = files[0] as (typeof files)[number] & {
    files: Record<string, Uint8Array>;
  };
  files[0] = {
    ...first,
    files: { ...first.files, "rule/SKILL.md": encode(SKILL) },
  };
  const compiled = compileProducerDeclaration({
    declaration: declarationWithRule,
    sourceFiles: files,
  });
  expect(compiled.status).toBe("refused");
  if (compiled.status !== "refused") return;
  expect(compiled.diagnostics[0]?.message).toContain("payload");
});

it("reads executable states from supplied source modes before the inventory freezes", () => {
  const files = sourceFiles();
  const first = files[0];
  if (first === undefined) throw new Error("fixture source missing");
  files[0] = {
    ...first,
    modes: { LICENSE: 0o644, "review/SKILL.md": 0o755, "mcp/SKILL.md": 0o644 },
  };
  const compiled = compileProducerDeclaration({
    declaration: declaration(),
    sourceFiles: files,
  });
  expect(compiled.status).toBe("ok");
  if (compiled.status !== "ok") return;
  const review = compiled.value.release.items.find((item) => item.id === "notes.review");
  expect(review?.executable).toEqual({ LICENSE: false, "SKILL.md": true });
  const mcp = compiled.value.release.items.find((item) => item.id === "notes.mcp");
  expect(mcp?.executable).toEqual({ LICENSE: false, "SKILL.md": false });
});

it("refuses an unsupported supplied source mode", () => {
  const files = sourceFiles();
  const first = files[0];
  if (first === undefined) throw new Error("fixture source missing");
  files[0] = { ...first, modes: { LICENSE: 0o600 } };
  const compiled = compileProducerDeclaration({ declaration: declaration(), sourceFiles: files });
  expect(compiled.status).toBe("refused");
  if (compiled.status !== "refused") return;
  expect(compiled.diagnostics[0]?.path).toBe("/sourceFiles/0/modes");
});

it("refreshes a previous 1.6 release through the public producer flow", () => {
  const compiled = compileProducerDeclaration({
    declaration: declaration(),
    sourceFiles: sourceFiles(),
  });
  expect(compiled.status).toBe("ok");
  if (compiled.status !== "ok") return;
  const updatedSkill = `${SKILL}\n\nExtra guidance after refresh.\n`;
  const refreshed = prepareSourceRefresh({
    declaration: declaration(),
    source: "notes",
    inventoryComplete: true,
    sourceFiles: [
      {
        source: "notes",
        revision: "b".repeat(40),
        files: {
          LICENSE: encode("MIT license fixture\n"),
          "review/SKILL.md": encode(updatedSkill),
          "mcp/SKILL.md": encode(MCP_SKILL),
        },
      },
    ],
    previous: {
      releaseBytes: compiled.value.releaseBytes,
      materials: compiled.value.materials.map((member) => ({
        path: member.path,
        bytes: member.bytes,
      })),
    },
  });
  expect(refreshed.status).toBe("ok");
  if (refreshed.status !== "ok") return;
  expect(refreshed.value.release.schema).toBe("urn:aihq:catalog:release:1.6.0");
  const review = refreshed.value.release.items.find((item) => item.id === "notes.review");
  expect(review?.materials.some((member) => "role" in member && member.role === "behaviour")).toBe(
    true,
  );
  const behaviour = refreshed.value.materials.find(
    (member) => member.path === "release/items/notes.review/aih-behaviour.json",
  );
  expect(behaviour).toBeDefined();
});
