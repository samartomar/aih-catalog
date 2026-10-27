---
name: executable-content-requirements
description: Inspect runtime requirements before running delivered evaluation, browser, image, document, media or OS utility content.
---

# Executable content requirements

1. Run `node workflow.mjs list`, then `node workflow.mjs plan <workflow>` in this
   directory. Read that workflow's requirements and exact platform blocker.
   `byte-delivered` means files arrived; it does not mean they can execute.
2. Read `requirements.json` for the original asset's exact path/hash and selected
   runtime. Read only the corresponding `locks/` projection when evaluating its
   Python dependencies. The three original projection files are labelled as
   projections. The workflow `*-linux-x64.txt` files bind resolved versions and
   artifact hashes; `lock-status.json` records failed resolutions. They establish
   Linux x64 resolution only. Other targets remain blocked. Use binary-only,
   hash-required acquisition; source distributions are never fallback builds.
3. Before acquisition, obtain exact interpreter and package artifacts, verify
   hashes, close dependencies for the actual OS/architecture, and review the
   selected operation's permissions. Use a separate environment per workflow.
   Missing artifacts block execution. Do not substitute an installed interpreter,
   compile missing wheels, search PATH, install global tools or relax TLS/sandbox
   guards to make a fixture pass.
4. Once its exact environment has been independently acquired, an authorized
   operator can run `node workflow.mjs fixture <workflow> <absolute-python> <new-output> <absolute-installed-catalog-root>`
   for mcp-evaluator, skill-authoring, evalview, gif, slides or browser. The
   interpreter must be a virtual environment at the selected exact version.
   The command uses a 30-second process deadline and refuses existing output.
   Retain failed output for diagnosis. Report `fixture-complete` as this fixture's
   result only; native support, upstream workflow equivalence and client loading
   still require their own evidence.

The evaluator stub exercises MCP data and the hash-verified delivered evaluator's
XML parser without backend/API credentials or a paid model call. Skill-authoring
calls the delivered quick validator on valid and invalid temporary skills and
the delivered eval-viewer on an empty workspace; it starts no review server.
Payload bytes and Python sibling closures are verified before loading. The
explicit installed Catalog root is the disposable packed consumer root, never a
product source checkout. EvalView imports only.
GIF produces two frames. Slides produces a one-slide PPTX and a separate PDF,
not a browser-rendered slide deck. Browser starts a loopback ephemeral-port
server, checks one local page and closes its browser and server. The browser
artifact/build/OS libraries must be separately bound; a Python wheel alone is
insufficient. Chrome for Testing is a different route and has no sourced native
Windows arm64 artifact. No browser is installed by this skill.

Remotion, Manim, FFmpeg, AppKit, Graphviz, terminals, observer/guardian, wizard and
visual companion requirements are declared but remain blocked pending exact
artifacts/native proof. Do not launch them automatically. Observer heuristics
cannot establish safe inactivity. POSIX-only scripts require a real POSIX route;
WSL2 does not establish native Windows support. PowerShell and pwsh, and X11 and
Wayland, need separate capability observations. A missing terminal/display has a
text-only fallback: return the proposed argv and blocker instead of launching it.
`node workflow.mjs argv <workflow> <absolute-executable>` emits a harmless
version-probe argv plan for OS utilities; it never runs the probe.

For an explicitly authorized isolated media fixture, `media/` contains a locked
Remotion 4.0.539 project and a two-frame composition. Acquire its exact Node
26.12.1, npm 12.2.1 and browser closure separately; install only in a disposable
copy using the committed npm lock and `--ignore-scripts`. `render.mjs` takes an
absolute browser executable and new absolute output directory. Run it under a
container/process-tree deadline: cancellation is passed to rendering, but it
does not bound webpack bundling or browser startup. This unexecuted fixture
produces PNG frames, not an encoded video. FFmpeg 9.0.2 source identity does not
supply an accepted distributor/codec binary; encoded video remains blocked.

This Catalog-authored companion preserves the 113 upstream executable assets
unchanged. It does not replace their licensing, lifecycle, APIs or instruction
files. The existing modern web-artifacts adaptation is independent. Material
Apply writes this companion only; it never installs dependencies or activates
accounts, hooks, terminals, services, native clients or paid APIs.
