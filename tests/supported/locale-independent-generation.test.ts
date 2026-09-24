import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCatalogFrameworkDefaultsV1,
  serializeCatalogDefaultV1,
} from "../../src/production/catalog-defaults-v1.js";
import { catalogTextCompareV1 } from "../../src/production/collation-v1.js";

const root = resolve(import.meta.dirname, "..", "..");

/**
 * Runs `action` as if the process default locale were `locale`: every collation that
 * names no locale (`localeCompare`, `new Intl.Collator()`) resolves to `locale` instead.
 */
function withDefaultLocale<T>(locale: string, action: () => T): T {
  const originalLocaleCompare = String.prototype.localeCompare;
  const OriginalCollator = Intl.Collator;
  const pinned = (locales: unknown) => (locales === undefined ? locale : locales);
  // biome-ignore lint/suspicious/noExplicitAny: test-only override of a built-in
  (String.prototype as any).localeCompare = function (
    this: string,
    that: string,
    locales?: string | string[],
    options?: Intl.CollatorOptions,
  ) {
    return originalLocaleCompare.call(this, that, pinned(locales) as string, options);
  };
  const PinnedCollator = ((locales?: string | string[], options?: Intl.CollatorOptions) =>
    new OriginalCollator(pinned(locales) as string, options)) as unknown as typeof Intl.Collator;
  PinnedCollator.supportedLocalesOf = OriginalCollator.supportedLocalesOf;
  Intl.Collator = PinnedCollator;
  try {
    return action();
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
    Intl.Collator = OriginalCollator;
  }
}

function generatedBytes(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(buildCatalogFrameworkDefaultsV1(root)).map(([path, value]) => [
      path,
      serializeCatalogDefaultV1(value),
    ]),
  );
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("locale-independent Catalog generation", () => {
  it("the injected default locale really changes default collation", () => {
    const sample = ["codebase-design", "code-review"];
    const sortDefault = () => [...sample].sort((left, right) => left.localeCompare(right));
    expect(withDefaultLocale("en", sortDefault)).toEqual(["code-review", "codebase-design"]);
    expect(withDefaultLocale("th", sortDefault)).toEqual(["codebase-design", "code-review"]);
  });

  it("regenerates byte-identical defaults under the Thai and English default locales", () => {
    const thai = withDefaultLocale("th", generatedBytes);
    const english = withDefaultLocale("en", generatedBytes);
    expect(Object.keys(thai)).toEqual(Object.keys(english));
    for (const [path, bytes] of Object.entries(english)) {
      const committed = readFileSync(resolve(root, path), "utf8");
      expect(bytes === committed, `${path} under en`).toBe(true);
      expect(thai[path] === committed, `${path} under th`).toBe(true);
    }
  }, 120_000);

  it("orders text in the committed English order regardless of the default locale", () => {
    const sample = ["codebase-design", "code-review", "Zeta", "alpha", "a/b", "a-b", "a"];
    const expected = ["a", "a-b", "a/b", "alpha", "code-review", "codebase-design", "Zeta"];
    expect([...sample].sort(catalogTextCompareV1)).toEqual(expected);
    expect(withDefaultLocale("th", () => [...sample].sort(catalogTextCompareV1))).toEqual(expected);
    expect(withDefaultLocale("tr", () => [...sample].sort(catalogTextCompareV1))).toEqual(expected);
  });

  it("is a total order: collation ties fall back to code units", () => {
    expect(catalogTextCompareV1("a", "a")).toBe(0);
    expect(catalogTextCompareV1("a\u0000", "a")).not.toBe(0);
    expect(Math.sign(catalogTextCompareV1("a\u0000", "a"))).toBe(
      -Math.sign(catalogTextCompareV1("a", "a\u0000")),
    );
  });

  it("keeps every production collation on the shared comparator", () => {
    const offenders = sourceFiles(resolve(root, "src", "production"))
      .filter((path) => !path.endsWith("collation-v1.ts"))
      .filter((path) => /\blocaleCompare\s*\(|\bIntl\.Collator\b/u.test(readFileSync(path, "utf8")))
      .map((path) => relative(root, path).replaceAll("\\", "/"));
    expect(offenders).toEqual([]);
  });
});
