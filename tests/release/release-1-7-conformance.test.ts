import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  behaviourSha256Of,
  computeBehaviourIdentity,
  contentIdentityText,
} from "../../src/release/document.js";
import { measureItem17, measureMaterial17 } from "../../src/release/measure.js";
import { readReleaseContent } from "../../src/release/reader.js";
import { buildEmbeddedSets } from "../../src/release/sets.js";
import { compileTransitionRelease } from "../../src/release/transition.js";

// Focused checks of the release 1.7 contract rules: the behaviour encoding against
// Core's independent golden vectors, measured sizes, provenance hops, empty sets,
// hook runners and registration files, and the transition's material and hop checks.
const root = resolve(import.meta.dirname, "../..");
type Doc = ReturnType<typeof JSON.parse>;
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
};
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const bytesOf = (document: unknown) => new TextEncoder().encode(`${canonical(document)}\n`);
const json = (path: string): Doc => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const reasons = (document: unknown) => {
  const result = readReleaseContent(bytesOf(document), {
    expectedSha256: sha256(bytesOf(document)),
  });
  return result.valid ? [] : result.diagnostics.map((entry) => entry.reason);
};
const extensions = () => json("release/release-extensions.content.json");
/** Recomputes an edited release 1.7 item's behaviour file and both identities. */
function restamp(item: Doc): void {
  const identity = computeBehaviourIdentity(item, "1.7") as NonNullable<
    ReturnType<typeof computeBehaviourIdentity>
  >;
  const behaviour = item.materials.find((member: Doc) => member.role === "behaviour");
  behaviour.sha256 = sha256(identity.behaviourBytes);
  behaviour.byteLength = identity.behaviourBytes.length;
  behaviour.size = { ...behaviour.size, bytes: identity.behaviourBytes.length };
  item.contentSha256 = identity.contentSha256;
  item.behaviourSha256 = identity.behaviourSha256;
}

describe("the release 1.7 behaviour identity", () => {
  it("reproduces Core's independent golden vectors", () => {
    const vectors = json("tests/fixtures/item-identity-1.7.0-vectors.json");
    expect(vectors.cases.map((entry: Doc) => entry.name)).toEqual([
      "base",
      "payload-only",
      "dependency-only",
      "executable-bit",
    ]);
    for (const { name, input, expect: want } of vectors.cases) {
      const lines = contentIdentityText(input.materials);
      expect(sha256(lines), name).toBe(want.contentSha256);
      const { materials: _materials, ...value } = input;
      expect(behaviourSha256Of({ ...value, contentLines: lines }), name).toBe(want.behaviourSha256);
    }
  });

  it("keeps release 1.6 on its own identity over every material line", () => {
    const item = extensions().items.find((entry: Doc) => entry.id === "extensions.matt.grill-me");
    const v16 = computeBehaviourIdentity(item, "1.6");
    const v17 = computeBehaviourIdentity(item, "1.7");
    expect(v16?.contentSha256).toBe(v17?.contentSha256);
    expect(v16?.behaviourSha256).toBe(sha256(contentIdentityText(item.materials)));
    expect(v17?.behaviourSha256).toBe(item.behaviourSha256);
    expect(v16?.behaviourSha256).not.toBe(v17?.behaviourSha256);
  });
});

describe("measured sizes", () => {
  it("counts bytes and Unicode code points, and leaves characters of non-text null", () => {
    expect(measureMaterial17(new TextEncoder().encode("é🙂\n"))).toEqual({
      bytes: 7,
      chars: 3,
      tokens: [],
      status: "measured",
    });
    expect(measureMaterial17(new Uint8Array([0xff, 0xfe, 0x00]))).toEqual({
      bytes: 3,
      chars: null,
      tokens: [],
      status: "not-text",
    });
    expect(measureMaterial17(new TextEncoder().encode("a\u0000b")).status).toBe("not-text");
  });

  it("splits a Markdown primary into frontmatter and body; other files count as files", () => {
    const text = "---\nname: x\n---\n# Body\n";
    const size = measureItem17({
      name: "x",
      description: "d",
      primary: "skill",
      content: [
        { id: "skill", bytes: new TextEncoder().encode(text) },
        { id: "license", bytes: new TextEncoder().encode("MIT\n") },
        { id: "blob", bytes: new Uint8Array([0xff]) },
      ],
    });
    expect(size.parts).toEqual([
      { part: "name", bytes: 1, chars: 1 },
      { part: "description", bytes: 1, chars: 1 },
      { part: "frontmatter", bytes: 7, chars: 7 },
      { part: "body", bytes: 7, chars: 7 },
      { part: "files", bytes: 5, chars: null },
    ]);
    expect(size.tokens).toEqual([]);
  });
});

describe("provenance hops", () => {
  const withHop = (edit: (item: Doc) => void) => {
    const document = extensions();
    edit(
      document.items.find((entry: Doc) => entry.id === "extensions.skill.security-and-hardening"),
    );
    return reasons(document);
  };
  it("accepts the committed content", () => {
    expect(reasons(extensions())).toEqual([]);
  });
  it("refuses a hop off its source's pin or licence, or naming no release source", () => {
    expect(withHop((item) => (item.provenance.source.revision = "a".repeat(40)))).toContain(
      "provenance-revision-mismatch",
    );
    expect(withHop((item) => (item.provenance.derivedFrom[0].license = "Apache-2.0"))).toContain(
      "provenance-license-mismatch",
    );
    expect(withHop((item) => (item.provenance.source.sourceId = "elsewhere"))).toContain(
      "unknown-source",
    );
  });
  it("refuses a verified hop without per-material upstream proof", () => {
    expect(withHop((item) => (item.provenance.derivedFrom[0].ancestry = "verified"))).toContain(
      "unverified-derivation",
    );
  });
});

describe("hook payloads and materials", () => {
  const withHook = (edit: (item: Doc) => void) => {
    const document = extensions();
    const item = document.items.find((entry: Doc) => entry.id === "extensions.hook.git-guard");
    edit(item);
    restamp(item);
    // A behaviour change moves the sets that pin the hook; this case reads the item alone.
    delete document.sets;
    return reasons(document);
  };
  it("refuses a runner Core would not render", () => {
    expect(
      withHook((item) => {
        const { script } = item.payload.command;
        item.payload.command = { program: "node", script };
      }),
    ).toContain("hook-command-ambiguous");
    expect(
      withHook((item) => {
        item.payload.command = { ...item.payload.command, program: "node" };
      }),
    ).toContain("hook-command-ambiguous");
    expect(
      withHook((item) => {
        item.payload.command = { script: item.payload.command.script };
      }),
    ).toContain("interpreter-required");
  });
  it("accepts a program given the script as a material argument, and async", () => {
    expect(
      withHook((item) => {
        const { script } = item.payload.command;
        item.payload.command = { program: "node", script, args: [{ material: script }] };
        item.payload.async = true;
      }),
    ).toEqual([]);
  });
  it("refuses a hook registration file as hook material", () => {
    expect(
      withHook((item) => {
        const license = item.materials.find((member: Doc) => member.relPath === "LICENSE");
        license.relPath = "hooks/hooks.json";
        item.executable = { ...item.executable, "hooks/hooks.json": false };
        delete item.executable.LICENSE;
      }),
    ).toContain("hook-registration-material");
  });
});

describe("sets", () => {
  it("refuses a set that offers nothing", () => {
    const document = extensions();
    const built = buildEmbeddedSets(
      [{ id: "empty", name: "Empty", description: "Nothing.", offer: "listed", members: [] }],
      document.framework,
      document.items,
    );
    expect(built.problems.map((problem) => problem.reason)).toContain("set-empty");
  });
  it("copies the upstream's words for cost and stability", () => {
    const document = extensions();
    const built = buildEmbeddedSets(
      [
        {
          id: "words",
          name: "Words",
          description: "Upstream words.",
          offer: "listed",
          cost: "medium",
          stability: "beta",
          members: [
            {
              item: { framework: "extensions", itemId: "extensions.notices" },
              optional: false,
              defaultOn: true,
            },
          ],
        },
      ],
      document.framework,
      document.items,
    );
    expect(built.problems).toEqual([]);
    expect(built.sets?.[0]).toMatchObject({ cost: "medium", stability: "beta" });
  });
});

describe("the transition build", () => {
  const copies = () => {
    const document = json("fixtures/release-1-7/extensions-copies-release-1.6.0.json");
    const read = readReleaseContent(bytesOf(document), {
      expectedSha256: sha256(bytesOf(document)),
    });
    if (!read.valid) throw new Error(JSON.stringify(read.diagnostics));
    return read.release;
  };
  const compile = (
    overrides: Record<string, unknown>,
    declaration: Record<string, unknown> = {},
  ) => {
    const release = copies();
    return compileTransitionRelease({
      releases: { [release.sha256]: release },
      earlier: [],
      framework: release.framework as never,
      package: release.package,
      items: [
        {
          id: "extensions.notices",
          kind: "document",
          purpose: "notice",
          role: "supporting",
          copies: [{ releaseSha256: release.sha256, itemId: "extensions.notices" }],
          ...declaration,
        },
      ],
      ...overrides,
    } as never);
  };
  const refusal = (result: ReturnType<typeof compile>) =>
    result.status === "ok" ? [] : result.diagnostics.map((entry) => entry.reason);
  it("measures sizes from the exact bytes and refuses other bytes", () => {
    const real = (path: string) => new Uint8Array(readFileSync(resolve(root, path)));
    const ok = compile({ readMaterial: real });
    expect(refusal(ok)).toEqual([]);
    expect(refusal(compile({ readMaterial: () => new TextEncoder().encode("other") }))).toContain(
      "material-bytes-mismatch",
    );
  });
  it("refuses leaving out a material no copy carries", () => {
    expect(refusal(compile({}, { withoutMaterials: ["hooks/hooks.json"] }))).toContain(
      "material-not-carried",
    );
  });
  it("refuses a hop naming no pinned source", () => {
    expect(
      refusal(
        compile(
          {},
          {
            provenance: { derivedFrom: [{ sourceId: "nowhere", path: "x", ancestry: "declared" }] },
          },
        ),
      ),
    ).toContain("provenance-source");
  });
});

describe("executable bits", () => {
  it("are committed as each prepared 1.7 material declares them, so a checkout carries them", () => {
    const modes = new Map(
      execFileSync("git", ["ls-files", "-s", "--", "release"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 << 20,
      })
        .split("\n")
        .filter(Boolean)
        .map((line) => [line.split("\t")[1], line.split(" ")[0]] as const),
    );
    let executable = 0;
    for (const name of ["extensions", "ecc", "superpowers", "project-basics"])
      for (const item of json(`release/release-${name}.content.json`).items)
        for (const member of item.materials) {
          if (member.executable === true) executable++;
          expect([member.packagePath, modes.get(member.packagePath)]).toEqual([
            member.packagePath,
            member.executable === true ? "100755" : "100644",
          ]);
        }
    expect(executable).toBeGreaterThan(0);
  });
});
