/**
 * Reads the hook declarations an OpenCode plugin file exports, without running
 * it. OpenCode calls each exported plugin function and registers the members of
 * the object it returns as hooks, so the reading is: every export is either a
 * plugin function, inert text, or a default export that only aliases a plugin
 * already read; every return path of a plugin function (control-flow blocks
 * included, nested functions and classes excluded) returns exactly one object
 * literal; every member of such an object is a named function. The hooks of a
 * plugin are the union over its return paths. Anything else fails closed: a
 * hook this reader cannot interpret is never dropped.
 *
 * The file is parsed by the TypeScript compiler (a build-time dependency; this
 * module never ships in the package) over a virtual file system holding only
 * the plugin text, so nothing is resolved, read from disk or executed.
 */

import type {
  Block,
  ExportAssignment,
  Expression,
  FunctionDeclaration,
  Node,
  ObjectLiteralExpression,
  PropertyName,
  ReturnStatement,
  SourceFile,
} from "typescript/unstable/ast";
import { SyntaxKind } from "typescript/unstable/ast";
import {
  isArrowFunction,
  isClassLikeDeclaration,
  isExportAssignment,
  isFunctionDeclaration,
  isFunctionExpression,
  isFunctionLikeDeclaration,
  isIdentifier,
  isMethodDeclaration,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAssignment,
  isReturnStatement,
  isStringLiteral,
  isVariableStatement,
} from "typescript/unstable/ast/is";
import type { FileSystem, FileSystemEntries } from "typescript/unstable/fs";
import { API } from "typescript/unstable/sync";

export interface OpenCodePluginHookV1 {
  /** The export that returns the hook, for example `SuperpowersPlugin`. */
  plugin: string;
  /** The hook name OpenCode registers, for example `config`. */
  hook: string;
}

type Fail = (reason: string) => never;

const VIRTUAL_ROOT = "/aih-opencode-plugin";
const VIRTUAL_FILE = `${VIRTUAL_ROOT}/plugin.js`;
const VIRTUAL_CONFIG = `${VIRTUAL_ROOT}/tsconfig.json`;

/**
 * The only files the parser can see: its configuration and the plugin text.
 * Every request is answered from these alone, and a miss is explicit (`null`,
 * `false`, no entries): the parser reads the real file system for any request
 * a callback answers with `undefined`.
 */
export function openCodePluginParserFileSystemV1(source: string): FileSystem {
  const files = new Map<unknown, string>([
    [
      VIRTUAL_CONFIG,
      JSON.stringify({
        compilerOptions: { allowJs: true, noLib: true, noResolve: true, types: [] },
        files: ["plugin.js"],
      }),
    ],
    [VIRTUAL_FILE, source],
  ]);
  const directories = new Map<unknown, FileSystemEntries>([
    ["/", { files: [], directories: [VIRTUAL_ROOT.slice(1)] }],
    [
      VIRTUAL_ROOT,
      {
        files: [VIRTUAL_CONFIG, VIRTUAL_FILE].map((file) => file.slice(VIRTUAL_ROOT.length + 1)),
        directories: [],
      },
    ],
  ]);
  return {
    readFile: (path) => files.get(path) ?? null,
    fileExists: (path) => files.has(path),
    directoryExists: (path) => directories.has(path),
    getAccessibleEntries: (path) => {
      const entries = directories.get(path);
      return { files: [...(entries?.files ?? [])], directories: [...(entries?.directories ?? [])] };
    },
    realpath: (path) => path,
  };
}

/** Parses `source` as an ECMAScript module and hands its syntax tree to `read` while the parser runs. */
function withParsedModule<T>(source: string, fail: Fail, read: (file: SourceFile) => T): T {
  const api = new API({ cwd: VIRTUAL_ROOT, fs: openCodePluginParserFileSystemV1(source) });
  try {
    const program = api
      .updateSnapshot({ openProjects: [VIRTUAL_CONFIG] })
      .getProjects()[0]?.program;
    const file = program?.getSourceFile(VIRTUAL_FILE);
    if (program === undefined || file === undefined)
      return fail("the plugin file: it did not parse");
    const [error] = program.getSyntacticDiagnostics(VIRTUAL_FILE);
    if (error !== undefined) {
      const line = file.getLineAndCharacterOfPosition(error.pos).line + 1;
      return fail(`the plugin file, which has a syntax error on line ${line}: ${error.text}`);
    }
    return read(file);
  } finally {
    api.close();
  }
}

export function readOpenCodePluginHooksV1(source: string, path: string): OpenCodePluginHookV1[] {
  const fail: Fail = (reason) => {
    throw new TypeError(`${path}: this Catalog cannot interpret ${reason}`);
  };
  return withParsedModule(source, fail, (file) => readModule(file, fail));
}

function readModule(file: SourceFile, fail: Fail): OpenCodePluginHookV1[] {
  const line = (node: Node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const hasModifier = (node: Node, kind: SyntaxKind) =>
    (node as { modifiers?: readonly Node[] }).modifiers?.some((item) => item.kind === kind) ===
    true;
  const unparenthesized = (expression: Expression): Expression =>
    isParenthesizedExpression(expression) ? unparenthesized(expression.expression) : expression;
  /** A property name whose text is known without evaluating anything. */
  const keyOf = (name: PropertyName): string | undefined =>
    isIdentifier(name) || isStringLiteral(name) ? name.text : undefined;
  const isFunctionValue = (node: Expression) =>
    (isArrowFunction(node) || isFunctionExpression(node)) && node.asteriskToken === undefined;

  /** The hook names of one object literal a plugin returns. */
  const hookNames = (object: ObjectLiteralExpression, plugin: string): string[] =>
    object.properties.map((member) => {
      const describe = () => `the member on line ${line(member)} of ${plugin}'s hooks`;
      if (isPropertyAssignment(member)) {
        const key = keyOf(member.name);
        if (key === undefined || key === "__proto__" || !isFunctionValue(member.initializer))
          return fail(describe());
        return key;
      }
      if (isMethodDeclaration(member)) {
        const key = keyOf(member.name);
        if (key === undefined || member.asteriskToken !== undefined || member.body === undefined)
          return fail(describe());
        return key;
      }
      // Shorthand members, spreads and accessors carry no statically known hook function.
      return fail(describe());
    });

  /** Every return statement of a function body, excluding those of nested functions and classes. */
  const returnsOf = (body: Block): ReturnStatement[] => {
    const found: ReturnStatement[] = [];
    const visit = (node: Node): void => {
      if (isFunctionLikeDeclaration(node) || isClassLikeDeclaration(node)) return;
      if (isReturnStatement(node)) found.push(node);
      node.forEachChild(visit);
    };
    body.forEachChild(visit);
    return found;
  };

  /** The union of the hooks of every object literal the plugin function can return. */
  const pluginHooks = (
    plugin: string,
    fn: Expression | FunctionDeclaration,
  ): OpenCodePluginHookV1[] => {
    if (!(isArrowFunction(fn) || isFunctionExpression(fn) || isFunctionDeclaration(fn)))
      return fail(`${plugin}, which is not a plugin function`);
    if (fn.asteriskToken !== undefined) return fail(`${plugin}, which is a generator`);
    const body = fn.body;
    if (body === undefined) return fail(`${plugin}, which has no body`);
    const returned: ObjectLiteralExpression[] = [];
    if (body.kind === SyntaxKind.Block) {
      for (const statement of returnsOf(body as Block)) {
        const object =
          statement.expression === undefined ? undefined : unparenthesized(statement.expression);
        if (object === undefined || !isObjectLiteralExpression(object))
          return fail(
            `${plugin}, whose return on line ${line(statement)} is not exactly one object literal`,
          );
        returned.push(object);
      }
      if (returned.length === 0) return fail(`${plugin}, whose body returns no object literal`);
    } else {
      const object = unparenthesized(body as Expression);
      if (!isObjectLiteralExpression(object))
        return fail(`${plugin}, whose concise body is not exactly one object literal`);
      returned.push(object);
    }
    const hooks = new Set(returned.flatMap((object) => hookNames(object, plugin)));
    return [...hooks].map((hook) => ({ plugin, hook }));
  };

  const plugins = new Map<string, OpenCodePluginHookV1[]>();

  const readDefault = (statement: ExportAssignment): void => {
    if (statement.isExportEquals) fail(`the export on line ${line(statement)}`);
    const value = unparenthesized(statement.expression);
    if (isIdentifier(value) && plugins.has(value.text)) return;
    if (!isObjectLiteralExpression(value)) fail(`the export on line ${line(statement)}`);
    for (const member of value.properties) {
      const key = isPropertyAssignment(member) ? keyOf(member.name) : undefined;
      const initializer = isPropertyAssignment(member) ? member.initializer : undefined;
      if (key === "id" && initializer !== undefined && isStringLiteral(initializer)) continue;
      if (
        key === "server" &&
        initializer !== undefined &&
        isIdentifier(initializer) &&
        plugins.has(initializer.text)
      )
        continue;
      fail(
        `the default export member ${key ?? `on line ${line(member)}`}: it has no reviewed reading (OpenCode V2 setup registrations have no representation in the hook inventory)`,
      );
    }
  };

  for (const statement of file.statements) {
    if (isExportAssignment(statement)) {
      readDefault(statement);
      continue;
    }
    const where = `the export on line ${line(statement)}`;
    // `export { … }` and `export * from …` re-export under names this reader cannot follow.
    if (statement.kind === SyntaxKind.ExportDeclaration) return fail(where);
    if (!hasModifier(statement, SyntaxKind.ExportKeyword)) continue;
    if (hasModifier(statement, SyntaxKind.DefaultKeyword)) return fail(where);
    if (isFunctionDeclaration(statement)) {
      const name = statement.name?.text;
      if (name === undefined) return fail(where);
      plugins.set(name, pluginHooks(name, statement));
      continue;
    }
    if (!isVariableStatement(statement)) return fail(where);
    const declarations = statement.declarationList.declarations;
    const [declaration] = declarations;
    if (declarations.length !== 1 || declaration === undefined || !isIdentifier(declaration.name))
      return fail(where);
    const initializer = declaration.initializer;
    if (initializer === undefined) return fail(where);
    const name = declaration.name.text;
    const kind = initializer.kind;
    if (
      kind === SyntaxKind.StringLiteral ||
      kind === SyntaxKind.NoSubstitutionTemplateLiteral ||
      kind === SyntaxKind.TemplateExpression
    )
      continue;
    if (!isFunctionValue(initializer)) return fail(where);
    plugins.set(name, pluginHooks(name, initializer));
  }
  if (plugins.size === 0) fail("a plugin file that exports no plugin function");
  return [...plugins.values()].flat();
}
