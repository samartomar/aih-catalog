// biome-ignore-all lint/suspicious/noTemplateCurlyInString: fixtures carry literal environment references
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { translateCodexMcpServer } from "../../src/release/codex-mcp-entries.js";

const set = (path: string[], literal: unknown) => ({ action: "set", path, value: { literal } });
const supported = (key: string, server: unknown) => {
  const result = translateCodexMcpServer(key, server);
  if (!result.supported) throw new Error(`unsupported: ${result.reason}`);
  return result;
};
const reason = (server: unknown, key = "srv") => {
  const result = translateCodexMcpServer(key, server);
  if (result.supported) throw new Error("expected an unsupported server");
  return result.reason;
};

describe("stdio servers", () => {
  it("translates command and args", () => {
    expect(supported("memory", { command: "npx", args: ["-y", "pkg"] })).toEqual({
      supported: true,
      entries: [
        set(["mcp_servers", "memory", "command"], "npx"),
        set(["mcp_servers", "memory", "args"], ["-y", "pkg"]),
      ],
      prerequisites: [{ kind: "executable", name: "npx" }],
    });
  });

  it("accepts an explicit stdio type and a command without args", () => {
    expect(supported("nexus", { type: "stdio", command: "nexus" }).entries).toEqual([
      set(["mcp_servers", "nexus", "command"], "nexus"),
    ]);
  });

  it("forwards exact ${NAME} and ${NAME:-} environment references through env_vars in upstream order", () => {
    const result = supported("srv", {
      command: "tool",
      env: { ZED: "${ZED}", ALPHA: "${ALPHA:-}" },
    });
    expect(result.entries).toEqual([
      set(["mcp_servers", "srv", "command"], "tool"),
      set(["mcp_servers", "srv", "env_vars"], ["ZED", "ALPHA"]),
    ]);
  });

  it("writes literal environment values as env tables, after env_vars", () => {
    expect(
      supported("srv", {
        command: "tool",
        args: ["a"],
        env: { MODE: "fast", TOKEN: "${TOKEN}", LEVEL: "3" },
      }).entries,
    ).toEqual([
      set(["mcp_servers", "srv", "command"], "tool"),
      set(["mcp_servers", "srv", "args"], ["a"]),
      set(["mcp_servers", "srv", "env_vars"], ["TOKEN"]),
      set(["mcp_servers", "srv", "env", "MODE"], "fast"),
      set(["mcp_servers", "srv", "env", "LEVEL"], "3"),
    ]);
  });

  it.each([
    [{ command: "tool", args: ["--root=${ROOT}"] }, "args-placeholder"],
    [{ command: "tool", args: ["${ROOT}"] }, "args-placeholder"],
    [{ command: "tool", env: { A: "${B}" } }, "env-reference-name-mismatch"],
    [{ command: "tool", env: { A: "${A:-default}" } }, "env-placeholder"],
    [{ command: "tool", env: { A: "pre-${A}" } }, "env-placeholder"],
    [{ command: "tool", env: { A: "${A}-post" } }, "env-placeholder"],
    [{ command: "tool", env: { A: "${A:-}${A:-}" } }, "env-placeholder"],
    [{ command: "tool", env: { A: "$${A}" } }, "env-placeholder"],
    [{ command: "tool", env: { A: 1 } }, "env-value"],
    [{ command: "tool", env: {} }, "env-shape"],
    [{ command: "tool", env: ["A"] }, "env-shape"],
    [{ command: "tool", args: [] }, "args-shape"],
    [{ command: "tool", args: [1] }, "args-shape"],
    [{ command: "tool", args: "x" }, "args-shape"],
    [{ command: "" }, "command-shape"],
    [{ command: 1 }, "command-shape"],
    [{ command: "tool", description: "text" }, "unsupported-key description"],
    [{ command: "tool", cwd: "." }, "unsupported-key cwd"],
    [{ command: "tool", url: "https://x.example" }, "unsupported-key url"],
    [{ command: "tool", headers: {} }, "unsupported-key headers"],
    [{ type: "sse", command: "tool" }, "unsupported-type"],
    [{ type: "stdio" }, "command-shape"],
    [{ args: ["x"] }, "transport-unknown"],
    [{}, "transport-unknown"],
  ])("refuses %j", (server, expected) => {
    expect(reason(server)).toContain(expected);
  });
});

describe("http servers", () => {
  it("translates a plain url", () => {
    expect(supported("vercel", { type: "http", url: "https://mcp.vercel.com" })).toEqual({
      supported: true,
      entries: [set(["mcp_servers", "vercel", "url"], "https://mcp.vercel.com")],
      prerequisites: [],
    });
  });

  it("maps Authorization Bearer ${NAME} to bearer_token_env_var", () => {
    expect(
      supported("m", {
        type: "http",
        url: "https://x.example/mcp",
        headers: { Authorization: "Bearer ${MEMXUS_API_KEY}" },
      }).entries,
    ).toEqual([
      set(["mcp_servers", "m", "url"], "https://x.example/mcp"),
      set(["mcp_servers", "m", "bearer_token_env_var"], "MEMXUS_API_KEY"),
    ]);
  });

  it("maps other exact ${NAME} headers to env_http_headers and plain values to http_headers", () => {
    expect(
      supported("b", {
        type: "http",
        url: "https://x.example/mcp",
        headers: {
          "x-literal": "fixed",
          "x-key": "${BROWSER_USE_KEY}",
          Authorization: "Bearer ${TOKEN}",
          "x-other": "${OTHER}",
          "x-second": "two",
        },
      }).entries,
    ).toEqual([
      set(["mcp_servers", "b", "url"], "https://x.example/mcp"),
      set(["mcp_servers", "b", "bearer_token_env_var"], "TOKEN"),
      set(["mcp_servers", "b", "http_headers", "x-literal"], "fixed"),
      set(["mcp_servers", "b", "http_headers", "x-second"], "two"),
      set(["mcp_servers", "b", "env_http_headers", "x-key"], "BROWSER_USE_KEY"),
      set(["mcp_servers", "b", "env_http_headers", "x-other"], "OTHER"),
    ]);
  });

  it("takes a fixed bearer value as a literal http_headers entry", () => {
    expect(
      supported("srv", {
        type: "http",
        url: "https://x",
        headers: { Authorization: "Bearer fixed" },
      }).entries,
    ).toEqual([
      set(["mcp_servers", "srv", "url"], "https://x"),
      set(["mcp_servers", "srv", "http_headers", "Authorization"], "Bearer fixed"),
    ]);
  });

  it.each([
    [{ type: "http", url: "https://x.example/${PATH}" }, "url-placeholder"],
    [{ type: "http", url: 1 }, "url-shape"],
    [{ type: "http", url: "" }, "url-shape"],
    [{ type: "http" }, "url-shape"],
    [{ type: "http", url: "https://x", headers: {} }, "headers-shape"],
    [{ type: "http", url: "https://x", headers: { A: 1 } }, "header-value"],
    [{ type: "http", url: "https://x", headers: { A: "${A:-}" } }, "header-placeholder"],
    [{ type: "http", url: "https://x", headers: { A: "pre ${A}" } }, "header-placeholder"],
    [
      { type: "http", url: "https://x", headers: { Authorization: "Bearer ${A:-}" } },
      "header-placeholder",
    ],
    [
      { type: "http", url: "https://x", headers: { Authorization: "Bearer pre-${A}" } },
      "header-placeholder",
    ],
    [
      { type: "http", url: "https://x", headers: { Authorization: "Basic ${A}" } },
      "header-placeholder",
    ],
    [{ type: "http", url: "https://x", command: "tool" }, "unsupported-key command"],
    [{ type: "http", url: "https://x", args: ["a"] }, "unsupported-key args"],
    [{ type: "http", url: "https://x", env: { A: "b" } }, "unsupported-key env"],
    [{ type: "http", url: "https://x", description: "d" }, "unsupported-key description"],
    [{ url: "https://x" }, "transport-unknown"],
  ])("refuses %j", (server, expected) => {
    expect(reason(server)).toContain(expected);
  });
});

describe("boundary input", () => {
  it.each([[null], [undefined], ["x"], [1], [[]]])("refuses a non-object server %j", (server) => {
    expect(reason(server)).toContain("server-shape");
  });

  it.each([[""], [1], [undefined]])("refuses a source key %j", (key) => {
    expect(translateCodexMcpServer(key as string, { command: "x" })).toEqual({
      supported: false,
      reason: "source-key-shape",
    });
  });

  it("does not mutate its input", () => {
    const server = { command: "tool", args: ["a"], env: { A: "${A}" } };
    const copy = JSON.parse(JSON.stringify(server));
    supported("srv", server);
    expect(server).toEqual(copy);
  });
});

describe("pinned ECC servers", () => {
  const inventory = JSON.parse(readFileSync("producer/ecc/inventory.json", "utf8")) as {
    itemFacts: Record<string, { sourceKey?: string; rawServer?: unknown; offeredServer?: unknown }>;
  };
  const facts = Object.entries(inventory.itemFacts)
    .filter(([id]) => id.startsWith("ecc.claude.mcp."))
    .map(([id, fact]) => ({ id, ...fact }));

  it("covers all 37 offered Claude servers", () => {
    expect(facts).toHaveLength(37);
  });

  it("refuses every raw upstream server that carries a display description", () => {
    // The raw upstream objects hold documentation text and placeholder values; only the
    // reviewed offered form (host-environment references, no description) is translatable.
    const described = facts.filter(
      (fact) => (fact.rawServer as { description?: string }).description,
    );
    expect(described.length).toBeGreaterThan(0);
    for (const fact of described) {
      expect(translateCodexMcpServer(fact.sourceKey as string, fact.rawServer).supported).toBe(
        false,
      );
    }
  });

  it("splits the offered servers into 34 translatable and 3 excluded for ${...} in args", () => {
    const outcome = facts.map((fact) => ({
      key: fact.sourceKey as string,
      result: translateCodexMcpServer(fact.sourceKey as string, fact.offeredServer),
    }));
    const excluded = outcome.filter((row) => !row.result.supported);
    expect(excluded.map((row) => row.key).sort()).toEqual([
      "filesystem",
      "ito-compute",
      "supabase",
    ]);
    for (const row of excluded) {
      expect(row.result).toMatchObject({
        supported: false,
        reason: expect.stringContaining("args-placeholder"),
      });
    }
    expect(outcome.filter((row) => row.result.supported)).toHaveLength(34);
  });

  it("translates representative servers exactly", () => {
    const entriesOf = (key: string) =>
      supported(key, facts.find((fact) => fact.sourceKey === key)?.offeredServer).entries;
    expect(entriesOf("github")).toEqual([
      set(["mcp_servers", "github", "url"], "https://api.githubcopilot.com/mcp/readonly"),
    ]);
    expect(entriesOf("memxus")).toEqual([
      set(["mcp_servers", "memxus", "url"], "https://mcp.memxus.com/mcp"),
      set(["mcp_servers", "memxus", "bearer_token_env_var"], "MEMXUS_API_KEY"),
    ]);
    expect(entriesOf("browser-use")).toEqual([
      set(["mcp_servers", "browser-use", "url"], "https://api.browser-use.com/v3/mcp"),
      set(
        ["mcp_servers", "browser-use", "env_http_headers", "x-browser-use-api-key"],
        "BROWSER_USE_KEY",
      ),
    ]);
    expect(entriesOf("evalview")).toContainEqual(
      set(["mcp_servers", "evalview", "env_vars"], ["OPENAI_API_KEY"]),
    );
  });
});
