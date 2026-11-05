---
name: web-artifacts-builder-modern
description: Build a standalone styled React HTML artifact using a locked project-local Vite pipeline.
---

# Standalone web artifacts

Catalog-authored adaptation inspired by Anthropic's web-artifacts-builder at
`anthropics/skills@34040c9c568585f6929bedeaad110ad08f079624`. Original source,
notices, component archive and historical Parcel scripts remain unchanged in
Catalog's separate upstream items. This adaptation contains newly authored code;
it does not unpack or install the upstream component ecosystem.

Use an explicitly selected Node 26.12.1 (compatible range >=26.12.1 <27).
Run `node artifact.mjs init <new-project>` from this skill's directory. It copies
only files, refuses an existing destination and never installs or starts tools.

Acquire **pnpm 12.15.0** into a project/task-local directory through an approved
exact artifact route. The package's platform-specific native executable is part
of its closure; verify its registry integrity too. Do not run a global installer
or enable Corepack globally. Invoke that exact local executable for:

```
pnpm install --frozen-lockfile --ignore-scripts --store-dir <project-local-store>
pnpm run build
```

Here `pnpm` denotes the exact locally acquired executable, not an arbitrary PATH
command. The project declares its identity in packageManager and engines. Keep
cache/runtime/store paths task-local, including XDG_RUNTIME_DIR on sandboxed Linux.
No create-vite/scaffold fetch or dependency lifecycle script is required.
The locks bind Vite 8.3.5, React/react-dom 19.3.1, TypeScript 7.0.2,
@vitejs/plugin-react 6.1.2 and Tailwind/@tailwindcss/vite 4.3.3 with peers.

Edit `src/main.tsx` and `src/style.css`. Tailwind 4 uses `@import "tailwindcss"`
and explicit local source discovery; do not restore the old Tailwind 3 config.
Only trusted project code may be built: Vite plugins and scripts execute locally.

The build typechecks and writes **dist/artifact.html** without an external JS/CSS
bundle. It refuses overwriting that file; remove/move your previous artifact
explicitly before rebuilding. Import images/fonts through source modules or CSS
so Vite inlines their bytes. Do not use publicDir, remote fonts/CDNs, external
scripts, dynamic network fetches or runtime-only asset paths for offline output.
The bounded inliner refuses extra emitted chunks/assets; this is deliberately a
single-entry artifact workflow, not a general site exporter.

Open the file with network disabled. Verify real computed styles, interactions,
images and fonts and record all attempted requests. An author can still write
fetch() or remote URLs: successful bundling alone never proves offline behavior.
Acquire browsers/fonts/codecs separately only when needed. Client skill loading,
Windows/macOS/arm64 and other native qualification remain unobserved unless an
exact platform receipt says otherwise. Material delivery is not activation.

Pass `--components` to `init` only when you need the selected component helpers:
lucide-react 1.61.0 (named icon exports), class-variance-authority 0.7.1, clsx
2.1.1 and tailwind-merge 3.7.0. This selects a separately frozen closure. The
default project installs none of these optional APIs. Radix, charts, calendars,
forms and other upstream component APIs are not installed or qualified here.
