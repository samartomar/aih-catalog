import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * A disposable local git repository with fixed author, committer and dates, so
 * the commit ids of a given history are the same on every machine. These are
 * real git objects: tests read them through the same `git` commands production
 * uses, without any network.
 */
export class FixtureRepository {
  readonly dir: string;
  private readonly home: string;
  private readonly environment: Record<string, string>;
  private count = 0;

  constructor() {
    this.home = mkdtempSync(join(tmpdir(), "aih-producer-upstream-"));
    this.dir = join(this.home, "repo");
    mkdirSync(this.dir);
    const config = join(this.home, "empty.gitconfig");
    writeFileSync(config, "");
    this.environment = {
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_GLOBAL: config,
      GIT_CONFIG_NOSYSTEM: "1",
    };
    this.git("init", "-q", "--initial-branch=main");
  }

  git(...args: string[]): string {
    return execFileSync("git", ["-C", this.dir, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...this.environment },
    }).trim();
  }

  /** Applies `changes` (null deletes a file) and commits with a fixed identity and date. */
  commit(changes: Record<string, string | Uint8Array | null>, message: string): string {
    for (const [path, value] of Object.entries(changes)) {
      const target = join(this.dir, ...path.split("/"));
      if (value === null) {
        rmSync(target, { force: true });
      } else {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, value);
      }
    }
    this.count += 1;
    const date = `2026-03-0${this.count}T12:00:00+00:00`;
    this.git("-c", "core.autocrlf=false", "add", "-A");
    execFileSync(
      "git",
      [
        "-C",
        this.dir,
        "-c",
        "user.name=Fixture Author",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.autocrlf=false",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        message,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ...this.environment,
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_DATE: date,
        },
      },
    );
    return this.git("rev-parse", "HEAD");
  }

  /** `git` bound to this repository for the producer's tree reader. */
  run = (...args: string[]): Uint8Array =>
    execFileSync("git", ["-C", this.dir, ...args], {
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...this.environment },
    });

  dispose(): void {
    rmSync(this.home, { recursive: true, force: true });
  }
}

const skill = (name: string, description: string, body: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

export const MIT =
  "MIT License\n\nCopyright (c) 2026 Fixture Author\n\nPermission is hereby granted, free of charge.\n";

/** The upstream file set at the first fixed commit. */
export const UPSTREAM_A: Record<string, string> = {
  LICENSE: MIT,
  "README.md": "# fixture skills\n",
  "skills/productivity/grill-me/SKILL.md": skill(
    "grill-me",
    "Interview to sharpen a plan.",
    'Call the Skill tool with "grilling".',
  ),
  "skills/productivity/grilling/SKILL.md": skill(
    "grilling",
    "Grill the user about a plan.",
    "Interview the user until shared understanding.",
  ),
  "skills/productivity/handoff/SKILL.md": skill(
    "handoff",
    "Compact a session for a fresh agent.",
    "Write a handoff note.",
  ),
  "skills/productivity/wait-what/SKILL.md": skill(
    "wait-what",
    "Ask what just happened.",
    "Explain the last step.",
  ),
  "skills/productivity/writing-for-agents/SKILL.md": skill(
    "writing-for-agents",
    "Write documents for agents.",
    "Keep it short.",
  ),
};

/** Changes applied by the second fixed commit: change, add, remove and a shared dependency. */
export const UPSTREAM_B_CHANGES: Record<string, string | null> = {
  "skills/productivity/handoff/SKILL.md": skill(
    "handoff",
    "Compact a session for a fresh agent.",
    "Write a handoff note.\n\nName the next step first.",
  ),
  "skills/productivity/to-questionnaire/SKILL.md": skill(
    "to-questionnaire",
    "Turn a topic into questions.",
    "Draft the questions.",
  ),
  "skills/productivity/wait-what/SKILL.md": null,
  "skills/productivity/grilling/SKILL.md": skill(
    "grilling",
    "Grill the user about a plan or design.",
    "Interview the user until shared understanding, then summarize.",
  ),
};
