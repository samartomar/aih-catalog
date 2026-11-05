import type * as ChildProcess from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSource } from "../../src/catalog/node.js";
import { gitRepository, outDir } from "./helpers.js";

const calls: { args: readonly string[]; env: NodeJS.ProcessEnv }[] = [];
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof ChildProcess>();
  return {
    ...actual,
    spawn: (program: string, args: readonly string[], options: ChildProcess.SpawnOptions) => {
      calls.push({ args, env: options.env ?? {} });
      return actual.spawn(program, args as string[], options);
    },
  };
});

const saved = { ...process.env };
afterEach(() => {
  calls.splice(0);
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

describe("Git never asks for or uses credentials", () => {
  it("turns off credential helpers and password prompts and runs SSH non-interactively", async () => {
    process.env.SSH_ASKPASS = "/somewhere/askpass";
    process.env.SSH_ASKPASS_REQUIRE = "force";
    const upstream = gitRepository({ "README.md": "r\n" });
    const fetched = await fetchSource(
      { kind: "git", repository: upstream.path },
      { outDir: outDir() },
    );
    expect(fetched.status).toBe("ok");
    const gitCalls = calls.filter((call) => call.args.includes("--no-replace-objects"));
    expect(gitCalls.length).toBeGreaterThan(0);
    for (const { args, env } of gitCalls) {
      const settings = args.flatMap((arg, index) => (args[index - 1] === "-c" ? [arg] : []));
      expect(settings).toEqual(
        expect.arrayContaining([
          "credential.helper=",
          "core.askPass=",
          "core.sshCommand=ssh -o BatchMode=yes -o StrictHostKeyChecking=yes",
        ]),
      );
      expect(env.SSH_ASKPASS).toBeUndefined();
      expect(env.SSH_ASKPASS_REQUIRE).toBe("never");
      expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    }
  });
});
