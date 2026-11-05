import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchSource, readContentFile, readLocalSource } from "../../src/catalog/node.js";
import { folder, outDir } from "./helpers.js";

/** True when `result`, as JSON, holds `text` in any spelling of its path separators. */
const mentions = (result: unknown, text: string): boolean => {
  const flat = (value: string) => value.replace(/[\\/]+/g, "/");
  return flat(JSON.stringify(result)).includes(flat(text));
};

describe("keeping credentials and machine paths out of results", () => {
  it("refuses a Git address carrying credentials without repeating them", async () => {
    for (const repository of [
      "https://someone:hunter2-secret@example.test/owner/repo",
      "https://hunter2-secret@example.test/owner/repo",
      "ssh://git:hunter2-secret@example.test/owner/repo",
      "file://hunter2-secret@localhost/owner/repo",
    ]) {
      const fetched = await fetchSource({ kind: "git", repository }, { outDir: outDir() });
      expect(fetched, repository).toMatchObject({ status: "invalid" });
      expect(JSON.stringify(fetched), repository).not.toContain("hunter2-secret");
    }
  });

  it("refuses a Git address with a query or fragment without repeating it", async () => {
    for (const repository of [
      "https://example.test/owner/repo?token=hunter2-secret",
      "https://example.test/owner/repo.git#hunter2-secret",
      "ssh://git@example.test/owner/repo?hunter2-secret",
    ]) {
      const fetched = await fetchSource({ kind: "git", repository }, { outDir: outDir() });
      expect(fetched, repository).toMatchObject({ status: "invalid" });
      expect(JSON.stringify(fetched), repository).not.toContain("hunter2-secret");
    }
  });

  it("names no machine path when a local repository, folder or file is missing", async () => {
    const root = folder({});
    const missing = join(root, "private-name-absent");
    const fetched = await fetchSource(
      { kind: "git", repository: missing },
      { outDir: outDir(), fromUser: true },
    );
    expect(fetched).toMatchObject({ status: "refused", code: "fetch-failed" });
    expect(mentions(fetched, root)).toBe(false);
    expect(mentions(fetched, "private-name-absent")).toBe(false);
    for (const result of [readLocalSource(missing), readContentFile(missing)]) {
      expect(result).toMatchObject({ status: "refused", code: "not-found" });
      expect(mentions(result, root)).toBe(false);
    }
  });

  it("names no machine path when the outDir cannot be used", async () => {
    const root = folder({});
    const file = join(root, "a-file");
    writeFileSync(file, "x");
    const fetched = await fetchSource(
      { kind: "git", repository: root },
      { outDir: file, fromUser: true },
    );
    expect(fetched).toMatchObject({ status: "refused" });
    expect(mentions(fetched, root)).toBe(false);
  });
});
