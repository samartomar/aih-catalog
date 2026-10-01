import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonical, sha256 } from "./fixtures.js";

const repository = resolve(import.meta.dirname, "../..");

/** A disposable installed-package root holding the carried release, with its own package.json. */
export function installedRoot(prefix: string): { root: string; cleanup: () => void } {
  const scratch = mkdtempSync(join(tmpdir(), `aih-catalog-${prefix}-`));
  const root = join(scratch, "node_modules", "@aihq", "catalog");
  mkdirSync(root, { recursive: true });
  const pkg = JSON.parse(readFileSync(resolve(repository, "package.json"), "utf8"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: pkg.name,
      version: pkg.version,
      type: "module",
      main: "./index.js",
      exports: { ".": "./index.js", "./release.json": "./release/release.json" },
      scripts: { postinstall: "node index.js" },
    }),
  );
  // Importing or running this package's code would leave a sentinel; reading must not.
  writeFileSync(
    join(root, "index.js"),
    'import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./IMPORTED", import.meta.url), "imported");\n',
  );
  cpSync(resolve(repository, "release"), join(root, "release"), { recursive: true });
  return { root, cleanup: () => rmSync(scratch, { recursive: true, force: true }) };
}

type Document = Record<string, unknown> & { items: Record<string, unknown>[] };

/** Rewrites one recipe in an installed root and re-pins its hash so only the definitions disagree. */
export function rewriteRecipe(
  root: string,
  itemId: string,
  change: (recipe: Record<string, unknown>) => void,
) {
  const releasePath = join(root, "release", "release.json");
  const release = JSON.parse(readFileSync(releasePath, "utf8")) as Document;
  const item = release.items.find((candidate) => candidate.id === itemId) as Record<
    string,
    Record<string, unknown>
  >;
  const recipePath = join(root, ...(item.recipe?.path as string).split("/"));
  const recipe = JSON.parse(readFileSync(recipePath, "utf8"));
  change(recipe);
  const bytes = Buffer.from(`${canonical(recipe)}\n`);
  writeFileSync(recipePath, bytes);
  (item.recipe as Record<string, unknown>).sha256 = sha256(bytes);
  (item.recipe as Record<string, unknown>).byteLength = bytes.length;
  writeFileSync(releasePath, `${canonical(release)}\n`);
}
