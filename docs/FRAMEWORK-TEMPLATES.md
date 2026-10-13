# A Catalog template you can read

A Catalog template answers three questions: **what is this item, which files belong
to it, and which other items does it need?** The Core recipe beside it answers
**where do those files go and which settings or hooks should Core manage?**

The [complete four-file example](../producer/templates/framework/declaration.json)
is checked by the producer tests. Start there when authoring another framework.

```text
Source files + Catalog declaration + Core recipe
                 ↓ bind exact bytes and hashes
         checked Catalog release candidate
                 ↓ select and configure
        Core installs, updates or removes
```

Catalog does not run an installer or know framework names. The author supplies
client-specific content and ordinary Core operations. The same content works in
Vibe and Enterprise; the host supplies Enterprise's organization boundary.

## The Catalog declaration

This version 2 example describes a complete item. Version 1 skill declarations
continue to work. Version 2 may also carry those existing skill items.

```json
{
  "format": "aihq-catalog-producer-declaration",
  "version": 2,
  "sources": [{
    "id": "example-source",
    "repository": "example/framework",
    "licensePath": "LICENSE",
    "license": "MIT"
  }],
  "items": [{
    "id": "example.framework",
    "source": "example-source",
    "label": "Example framework",
    "kind": "framework",
    "recipePath": "catalog/framework.recipe.json",
    "materials": [
      { "id": "guide", "path": "guide.md" },
      { "id": "license", "path": "LICENSE" }
    ],
    "requires": []
  }]
}
```

- `recipePath` is an explicit file in the pinned source snapshot, not executable
  producer code. Changes to it participate in change detection.
- `materials` names every file the recipe uses. The producer reads each file and
  fills in its hash and byte length. Include and deliver the source license.
- `requires` lists other item IDs. A separate pinned framework is another source
  and another item, not a hidden download in the recipe.
- The recipe supplies its `inputs`, scopes and prerequisites. Catalog copies them
  into the item rather than maintaining another configuration system.

## The Core recipe

Use the ordinary Core recipe schema and meaningful operation IDs. Leave
`materials` empty: Catalog binds that field. For example, its file operations can
write `guide` and `license` into `userHome/.example/`. Hooks use `hook.group`,
individual settings use `config.entries`, and an owned text section uses
`text.block`. These operations carry Core's update and removal ownership rules.

Each declared material must be referenced by a file operation or process
executable; every such reference must be declared. Catalog rejects extra, missing
or ambiguous files. A `file.sha256` check may use this authoring shorthand:

```json
{ "sha256": { "materialSha256": "guide" } }
```

The compiler replaces it with the actual SHA-256 string. All other fields in that
check and recipe remain ordinary Core fields. Catalog validates the completed
recipe against the explicitly supported Core schema; it does not accept arbitrary
future schema identifiers.

Use scalar inputs for deployment-specific values such as a hook command containing
the user's home directory. Core recipe 1.3 adds input-bound hook groups. It requires
Catalog release 1.2; existing release 1.0 and 1.1 contracts remain unchanged.
Never render one new Catalog release per user's home directory.

## Raw sources and rendered sources

For files already committed upstream, the existing candidate command reads their
exact Git pin. `parseDeclaration` and `buildCandidate` also accept a supplied
`SourceTree` for fast offline checks. Produce a dependency source first, then pass
`parseBaseRelease(previous.files)` when producing the dependent source. Keep the
whole dependency graph in the declaration.

Some frameworks transform an agent file for several clients before packaging.
That transformation belongs to the framework author. A rendered tree explicitly
sets `derivation` with:

- `renderer`: its name, version and bytes (combine all renderer source files in a
  deterministic order when it has several modules);
- `inputs`: the complete declared raw input closures, each with its repository
  and full pin (an adapter may select only the framework's used source files);
- `configuration`: JSON such as selected clients, excluding deployment secrets
  and machine paths.

Catalog snapshots those bytes and computes renderer, input-tree and output-tree
digests itself. Derived release sources use `origin.kind: "authored"`, and each
item records the pins, digests and renderer in its upstream metadata. It never
claims transformed files were raw Git blobs. These supplied trees still need a
trusted adapter that verifies the source pins; hashing supplied bytes does not
prove repository history. The final recipe and material hashes bind the actual
bytes consumed by Core.

Rendered inventories must be complete, regular files with no submodule gaps,
unsafe/case-alias paths or nested derivations. Each snapshot is bounded to 65,536
files and 256 MiB; an individual member remains bounded to 16 MiB. Recipe JSON is
bounded to Core's existing one-million-byte limit. A refusal never truncates an
item to fit.

Literal examples such as `${name}` or `[object Object]` remain subject to the
authored-content checks. Version 2 can declare a reviewed example under
`authored[].literalExamples` as `{path, sha256, tokens}`. `path` names the exact
source-relative material file, `sha256` pins its reviewed bytes, and `tokens`
lists only the exact literal strings reviewed in that file. Tokens may contain
spaces and are bounded to 512 characters; control characters are refused.

The producer verifies the derived source identity and maps that source path to
the exact emitted material. The checker then hashes the actual delivered bytes.
No wildcard, source-wide or descendant allowance follows from a literal example.
The same token in another file or operation literal still fails. A byte change,
path change or new token also fails until separately reviewed. Existing
`templatePlaceholders` keeps its previous 64-character, no-whitespace behavior
for intentional source-wide authoring templates; it is not the mechanism for
literal code examples.

## Updates and removal

A changed material or recipe rebuilds its item. Required dependents are checked;
unaffected records, recipes, materials and source pins remain unchanged. A missing
recipe in a complete source inventory withdraws that Catalog item, subject to the
existing dependency checks. An incomplete inventory never means removal.

Withdrawing an item from Catalog is different from removing an installed item.
Core removal is an explicit host policy change against its recorded ownership.
Publication remains blocked during migration; this compiler prepares local
content candidates and does not allocate versions or publish them.
