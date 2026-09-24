/**
 * Reads the hook declarations an OpenCode plugin file exports, without running
 * it. OpenCode calls each exported plugin function and registers the members of
 * the object it returns as hooks, so the reading is: every export is either a
 * plugin function, inert text, or a default export that aliases a plugin
 * already read and may name an OpenCode V2 `setup` function; every return path
 * of a plugin function (control-flow blocks included, nested functions and
 * classes excluded) returns exactly one object literal; every member of such an
 * object is a named function. The hooks of a plugin are the union over its
 * return paths.
 *
 * OpenCode V2 calls `setup(ctx)` instead and the plugin registers through the
 * context. The reviewed reading of `setup`: it is one top-level function
 * declaration with one plain context parameter that it never returns a value
 * from; every use of the context (nested functions included) is a `!` or
 * `typeof` guard of a member chain, a registration `ctx.skill.transform(fn)`
 * or `ctx.session.hook("<event>", fn)`, or the query `ctx.session.get(...)`;
 * and `this`, `arguments` and `eval` do not occur. Its hooks are
 * `skill.transform` and `session.hook.<event>` under the plugin name
 * `default.setup`. Anything else fails closed: a hook this reader cannot
 * interpret is never dropped.
 *
 * The file is parsed by the TypeScript compiler (a build-time dependency; this
 * module never ships in the package) over a virtual file system holding only
 * the plugin text, so nothing is resolved, read from disk or executed. A path
 * ending in `.ts` is parsed as TypeScript, any other as JavaScript.
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
  isBinaryExpression,
  isBindingElement,
  isCallExpression,
  isClassLikeDeclaration,
  isExportAssignment,
  isExportDeclaration,
  isExportSpecifier,
  isFunctionDeclaration,
  isFunctionExpression,
  isFunctionLikeDeclaration,
  isIdentifier,
  isMethodDeclaration,
  isNamedExports,
  isObjectLiteralExpression,
  isParameterDeclaration,
  isParenthesizedExpression,
  isPostfixUnaryExpression,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isReturnStatement,
  isShorthandPropertyAssignment,
  isStringLiteral,
  isTypeOfExpression,
  isVariableDeclaration,
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
const VIRTUAL_CONFIG = `${VIRTUAL_ROOT}/tsconfig.json`;

/** The plugin's virtual file name: its language follows the upstream path's extension. */
type PluginFileNameV1 = "plugin.js" | "plugin.ts";

const pluginFileName = (path: string): PluginFileNameV1 =>
  path.endsWith(".ts") ? "plugin.ts" : "plugin.js";

/**
 * The only files the parser can see: its configuration and the plugin text.
 * Every request is answered from these alone, and a miss is explicit (`null`,
 * `false`, no entries): the parser reads the real file system for any request
 * a callback answers with `undefined`.
 */
export function openCodePluginParserFileSystemV1(
  source: string,
  fileName: PluginFileNameV1 = "plugin.js",
): FileSystem {
  const files = new Map<unknown, string>([
    [
      VIRTUAL_CONFIG,
      JSON.stringify({
        compilerOptions: { allowJs: true, noLib: true, noResolve: true, types: [] },
        files: [fileName],
      }),
    ],
    [`${VIRTUAL_ROOT}/${fileName}`, source],
  ]);
  const directories = new Map<unknown, FileSystemEntries>([
    ["/", { files: [], directories: [VIRTUAL_ROOT.slice(1)] }],
    [
      VIRTUAL_ROOT,
      {
        files: ["tsconfig.json", fileName],
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
function withParsedModule<T>(
  source: string,
  fileName: PluginFileNameV1,
  fail: Fail,
  read: (file: SourceFile) => T,
): T {
  const virtualFile = `${VIRTUAL_ROOT}/${fileName}`;
  const api = new API({
    cwd: VIRTUAL_ROOT,
    fs: openCodePluginParserFileSystemV1(source, fileName),
  });
  try {
    const program = api
      .updateSnapshot({ openProjects: [VIRTUAL_CONFIG] })
      .getProjects()[0]?.program;
    const file = program?.getSourceFile(virtualFile);
    if (program === undefined || file === undefined)
      return fail("the plugin file: it did not parse");
    const [error] = program.getSyntacticDiagnostics(virtualFile);
    if (error !== undefined) {
      const line = file.getLineAndCharacterOfPosition(error.pos).line + 1;
      return fail(`the plugin file, which has a syntax error on line ${line}: ${error.text}`);
    }
    return read(file);
  } finally {
    api.close();
  }
}

const failFor =
  (path: string): Fail =>
  (reason) => {
    throw new TypeError(`${path}: this Catalog cannot interpret ${reason}`);
  };

export function readOpenCodePluginHooksV1(source: string, path: string): OpenCodePluginHookV1[] {
  const fail = failFor(path);
  return withParsedModule(source, pluginFileName(path), fail, (file) => readModule(file, fail));
}

/** A relative module path without parent segments, as an entry point may name it. */
const RELATIVE_MODULE =
  /^\.\/(?:(?!\.{1,2}\/)[A-Za-z0-9._-]+\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.js$/u;

/**
 * Reads an OpenCode V2 directory entry point (`index.js`), which must consist of
 * exactly `export { default } from "./<relative path>.js"`, and returns that
 * module path. Any other statement or export shape fails closed.
 */
export function readOpenCodeEntryReexportV1(source: string, path: string): string {
  const fail = failFor(path);
  return withParsedModule(source, pluginFileName(path), fail, (file) => {
    const [statement, ...rest] = file.statements;
    const where =
      "an entry point other than exactly one `export { default } from` a relative module";
    if (statement === undefined || rest.length > 0 || !isExportDeclaration(statement))
      return fail(where);
    const clause = statement.exportClause;
    const specifier = statement.moduleSpecifier;
    const [element, ...others] =
      clause !== undefined && isNamedExports(clause) ? clause.elements : [];
    if (
      statement.isTypeOnly ||
      statement.attributes !== undefined ||
      element === undefined ||
      others.length > 0 ||
      !isExportSpecifier(element) ||
      element.isTypeOnly ||
      element.propertyName !== undefined ||
      !isIdentifier(element.name) ||
      element.name.text !== "default" ||
      specifier === undefined ||
      !isStringLiteral(specifier) ||
      !RELATIVE_MODULE.test(specifier.text)
    )
      return fail(where);
    return specifier.text;
  });
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

  /** The hooks the V2 `setup` function named `name` registers, or a failure. */
  const setupHooks = (name: string): OpenCodePluginHookV1[] => {
    const plugin = "default.setup";
    const where = `the V2 setup function ${name}`;
    const declarations = file.statements.filter(
      (statement): statement is FunctionDeclaration =>
        isFunctionDeclaration(statement) && statement.name?.text === name,
    );
    const [fn] = declarations;
    if (declarations.length !== 1 || fn === undefined)
      return fail(`${where}, which is not exactly one top-level function declaration`);
    const rebinds = (node: Node): boolean => {
      const target = (expression: Expression) => {
        const inner = unparenthesized(expression);
        return isIdentifier(inner) && inner.text === name;
      };
      if (
        (isVariableDeclaration(node) && isIdentifier(node.name) && node.name.text === name) ||
        (isBinaryExpression(node) &&
          node.operatorToken.kind >= SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= SyntaxKind.LastAssignment &&
          target(node.left)) ||
        ((isPrefixUnaryExpression(node) || isPostfixUnaryExpression(node)) &&
          (node.operator === SyntaxKind.PlusPlusToken ||
            node.operator === SyntaxKind.MinusMinusToken) &&
          target(node.operand))
      )
        return true;
      let found = false;
      node.forEachChild((child) => {
        found ||= rebinds(child);
        return undefined;
      });
      return found;
    };
    if (rebinds(file)) return fail(`${where}, which is declared or assigned again`);
    if (fn.asteriskToken !== undefined) return fail(`${where}, which is a generator`);
    const [parameter, ...extra] = fn.parameters;
    if (
      parameter === undefined ||
      extra.length > 0 ||
      !isIdentifier(parameter.name) ||
      parameter.dotDotDotToken !== undefined ||
      parameter.initializer !== undefined
    )
      return fail(`${where}, which does not take exactly one plain context parameter`);
    const context = parameter.name.text;
    const body = fn.body;
    if (body === undefined) return fail(`${where}, which has no body`);
    for (const statement of returnsOf(body))
      if (statement.expression !== undefined)
        return fail(`${where}, whose return on line ${line(statement)} returns a value`);

    const hooks: string[] = [];
    const isNameOf = (node: Node, parent: Node) =>
      (isPropertyAccessExpression(parent) && parent.name === node) ||
      (isPropertyAssignment(parent) && parent.name === node) ||
      (isMethodDeclaration(parent) && parent.name === node);
    /** One use of the context parameter: a guard, a reviewed registration or a reviewed query. */
    const readUse = (reference: Node): void => {
      const at = `the use of ${context} on line ${line(reference)} in ${where}`;
      let top: Node = reference;
      const members: string[] = [];
      while (isPropertyAccessExpression(top.parent) && top.parent.expression === top) {
        if (top.parent.questionDotToken !== undefined) fail(at);
        members.push(top.parent.name.text);
        top = top.parent;
      }
      const parent = top.parent;
      if (isPrefixUnaryExpression(parent) && parent.operator === SyntaxKind.ExclamationToken)
        return;
      if (isTypeOfExpression(parent)) return;
      if (!isCallExpression(parent) || parent.expression !== top || parent.questionDotToken)
        fail(at);
      const [first, second, ...more] = parent.arguments;
      const member = members.join(".");
      if (member === "session.get") return;
      if (
        member === "skill.transform" &&
        first !== undefined &&
        second === undefined &&
        isFunctionValue(first)
      ) {
        hooks.push("skill.transform");
        return;
      }
      if (
        member === "session.hook" &&
        first !== undefined &&
        second !== undefined &&
        more.length === 0 &&
        isStringLiteral(first) &&
        /^[a-z][a-z0-9_.]{0,63}$/u.test(first.text) &&
        isFunctionValue(second)
      ) {
        hooks.push(`session.hook.${first.text}`);
        return;
      }
      fail(at);
    };
    const visit = (node: Node): void => {
      if (node.kind === SyntaxKind.ThisKeyword)
        fail(`${where}, which uses this on line ${line(node)}`);
      if (isIdentifier(node) && !isNameOf(node, node.parent)) {
        if (node.text === "arguments" || node.text === "eval")
          fail(`${where}, which uses ${node.text} on line ${line(node)}`);
        if (node.text === context) {
          const parent = node.parent;
          if (
            (isParameterDeclaration(parent) ||
              isVariableDeclaration(parent) ||
              isBindingElement(parent) ||
              isFunctionLikeDeclaration(parent) ||
              isClassLikeDeclaration(parent)) &&
            (parent as { name?: Node }).name === node
          )
            fail(`${where}, which declares ${context} again on line ${line(node)}`);
          readUse(node);
        }
      }
      node.forEachChild((child) => {
        visit(child);
        return undefined;
      });
    };
    body.forEachChild((child) => {
      visit(child);
      return undefined;
    });
    return [...new Set(hooks)].map((hook) => ({ plugin, hook }));
  };

  const plugins = new Map<string, OpenCodePluginHookV1[]>();
  let setup: OpenCodePluginHookV1[] | undefined;

  const readDefault = (statement: ExportAssignment): void => {
    if (statement.isExportEquals) fail(`the export on line ${line(statement)}`);
    const value = unparenthesized(statement.expression);
    if (isIdentifier(value) && plugins.has(value.text)) return;
    if (!isObjectLiteralExpression(value)) fail(`the export on line ${line(statement)}`);
    for (const member of value.properties) {
      const key =
        isPropertyAssignment(member) || isShorthandPropertyAssignment(member)
          ? keyOf(member.name)
          : undefined;
      const initializer = isPropertyAssignment(member) ? member.initializer : undefined;
      if (key === "id" && initializer !== undefined && isStringLiteral(initializer)) continue;
      if (
        key === "server" &&
        initializer !== undefined &&
        isIdentifier(initializer) &&
        plugins.has(initializer.text)
      )
        continue;
      const setupName = isShorthandPropertyAssignment(member)
        ? key
        : initializer !== undefined && isIdentifier(initializer)
          ? initializer.text
          : undefined;
      if (key === "setup" && setup === undefined && setupName !== undefined) {
        setup = setupHooks(setupName);
        continue;
      }
      fail(
        `the default export member ${key ?? `on line ${line(member)}`}: it has no reviewed reading`,
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
  return [...plugins.values(), setup ?? []].flat();
}
