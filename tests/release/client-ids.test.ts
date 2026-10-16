import { describe, expect, it } from "vitest";
import { CORE_NATIVE_CLIENT_IDS, clientAdapterProblems } from "../../src/release/client-ids.js";
import { CLIENTS } from "../../src/release/context-content.js";

const CLIENT_ID = /^[a-z][a-z0-9-]{0,63}$/;
const adapter = (id: string, clientId?: unknown) =>
  ({ id, kind: "client-adapter", ...(clientId === undefined ? {} : { clientId }) }) as never;

describe("Core native client ids", () => {
  it("is the frozen, sorted, unique, well-formed mirror of Core's eleven clients", () => {
    expect(Object.isFrozen(CORE_NATIVE_CLIENT_IDS)).toBe(true);
    expect(CORE_NATIVE_CLIENT_IDS).toEqual([
      "antigravity",
      "claude",
      "codex",
      "copilot",
      "cursor",
      "gemini",
      "kimi",
      "kiro",
      "opencode",
      "windsurf",
      "zed",
    ]);
    expect([...CORE_NATIVE_CLIENT_IDS].sort()).toEqual([...CORE_NATIVE_CLIENT_IDS]);
    expect(new Set(CORE_NATIVE_CLIENT_IDS).size).toBe(CORE_NATIVE_CLIENT_IDS.length);
    for (const id of CORE_NATIVE_CLIENT_IDS) expect(id).toMatch(CLIENT_ID);
  });

  it("covers exactly the clients the project-context renderer delivers", () => {
    expect(CLIENTS.map((client) => client.id).sort()).toEqual([...CORE_NATIVE_CLIENT_IDS]);
  });
});

describe("clientAdapterProblems", () => {
  it("is empty for known adapters and ignores other kinds", () => {
    expect(
      clientAdapterProblems([adapter("a", "codex"), { id: "b", kind: "skill" } as never]),
    ).toEqual([]);
  });

  it("names a missing clientId", () => {
    expect(clientAdapterProblems([adapter("a")])).toEqual([
      { reason: "missing-client-id", itemId: "a" },
    ]);
  });

  it.each(["Codex", "", "-x", 7, null])("names a malformed clientId %j", (bad) => {
    expect(clientAdapterProblems([adapter("a", bad)])).toEqual([
      { reason: "invalid-client-id", itemId: "a" },
    ]);
  });

  it("names a well-formed id outside the Core set", () => {
    expect(clientAdapterProblems([adapter("a", "not-a-core-client")])).toEqual([
      { reason: "unknown-client-id", itemId: "a", clientId: "not-a-core-client" },
    ]);
  });

  it("reports problems in item order", () => {
    expect(
      clientAdapterProblems([adapter("a", "zzz"), adapter("b", "codex"), adapter("c")]).map(
        (problem) => problem.itemId,
      ),
    ).toEqual(["a", "c"]);
  });
});
