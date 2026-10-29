/**
 * Release 1.7 sizes, as the Catalog contract states them: exact bytes and
 * characters per material and per named item part, computed at publish time.
 * Characters are Unicode code points of strictly decoded UTF-8; bytes that are not
 * UTF-8 text have no character count. No tokenizer is chosen yet, so token counts
 * stay empty and are never guessed. Portable: no Node built-ins.
 */

const strict = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

/** The text of exact bytes, or undefined when they are not UTF-8 text. */
function textOf(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) return undefined;
  try {
    return strict.decode(bytes);
  } catch {
    return undefined;
  }
}

/** Unicode code points, not UTF-16 units. */
const codePoints = (text: string): number => [...text].length;

export interface MaterialSize17 {
  readonly bytes: number;
  readonly chars: number | null;
  readonly tokens: readonly { readonly tokenizer: string; readonly count: number }[];
  readonly status: "measured" | "not-text";
}

export function measureMaterial17(bytes: Uint8Array): MaterialSize17 {
  const text = textOf(bytes);
  return text === undefined
    ? { bytes: bytes.byteLength, chars: null, tokens: [], status: "not-text" }
    : { bytes: bytes.byteLength, chars: codePoints(text), tokens: [], status: "measured" };
}

export interface ItemSize17 {
  readonly parts: readonly {
    readonly part: "name" | "description" | "frontmatter" | "body" | "files";
    readonly bytes: number;
    readonly chars: number | null;
  }[];
  readonly tokens: readonly { readonly tokenizer: string; readonly sum: number }[];
}

const textPart = (part: "name" | "description" | "frontmatter" | "body", text: string) => ({
  part,
  bytes: encoder.encode(text).byteLength,
  chars: codePoints(text),
});

/**
 * Measured item parts: the display name and description, the frontmatter and body of
 * the item's primary Markdown text (when it has one), and every other content file.
 * `files` characters are null when any of those files is not text.
 */
export function measureItem17(item: {
  readonly name: string;
  readonly description?: string;
  readonly primary?: string;
  readonly content: readonly { readonly id: string; readonly bytes: Uint8Array }[];
}): ItemSize17 {
  const parts: ItemSize17["parts"][number][] = [textPart("name", item.name)];
  if (item.description !== undefined) parts.push(textPart("description", item.description));
  const primary = item.content.find((member) => member.id === item.primary);
  const primaryText = primary === undefined ? undefined : textOf(primary.bytes);
  if (primaryText !== undefined) {
    const split = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(primaryText);
    parts.push(textPart("frontmatter", split?.[1] ?? ""));
    parts.push(textPart("body", split === null ? primaryText : primaryText.slice(split[0].length)));
  }
  const files = item.content.filter((member) => member !== primary || primaryText === undefined);
  const sizes = files.map((member) => measureMaterial17(member.bytes));
  parts.push({
    part: "files",
    bytes: sizes.reduce((total, size) => total + size.bytes, 0),
    chars: sizes.some((size) => size.chars === null)
      ? null
      : sizes.reduce((total, size) => total + (size.chars as number), 0),
  });
  return { parts, tokens: [] };
}
