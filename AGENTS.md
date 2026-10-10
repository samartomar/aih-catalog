# AIH Catalog

This repository builds the `@aihq/catalog` content package. The retained
`aih-supported` CLI is historical donor source and is excluded from the package.
[README.md](README.md) owns usage, [CONTRIBUTING.md](CONTRIBUTING.md) owns
contributor checks, and [RELEASING.md](RELEASING.md) owns release gates.
For source, tests, CI or release changes, read [the transition](docs/TRANSITION.md)
for the accepted direction, donor-code disposition and unfinished release gates.
The retained Catalog V2 references describe historical implementation, not a
compatibility requirement or the target public interface.

## Source and safety boundaries

Never run an installed aih-supported against this checkout.
Use direct repository checks and disposable fixture/packed-consumer roots.
Validate boundary input and fail closed on ambiguity. Keep credentials, private
reproductions, machine paths and generated tool state out of committed files.
Source, tests and verified artifacts establish behavior; helper indexes are
optional navigation. Update generated outputs through their owning scripts.

## Engineering workflow

Use Matt Pocock's engineering skills for planning, implementation, debugging and
review, with Extensions for complementary checks. Use /ask-matt for that flow and
/ask-sam for the add-on. Commit locally when authorized, then run Matt's
/code-review against the fixed base and originating requirements before merge;
/ship handles launch readiness. Preserve the owning contribution and release gates.

AGENTS.md is the maintained instruction entry point. The ai-coding directory
retains product contracts and technical references; it does not select another
engineering workflow or require helper installation.

## Issue and delivery routing

Accepted bugs/enhancements, including internally discovered work, use an owning
Catalog issue before implementation. Reuse an existing report for the same
outcome. Use fully qualified `samartomar/aih-catalog#<number>` references and
explicit `--repo samartomar/aih-catalog` on GitHub issue commands. Confidential
reports stay in the verified private route; public text contains no private plans,
reproductions or coordination links.

At pickup identify the delivery issue, actual Git root/worktree, scope and output.
Link the PR and actual release evidence on that issue. Changed content in a
published npm tarball requires a new Catalog package version even when producer
source is unchanged. Identify unpublished local builds by source and artifact digest. Routine successful refreshes use CI/output records;
actionable recurring failures reuse the owning issue.

Before closeout verify merged versus available status. When publication is
required by acceptance, retain it as pending until verified; otherwise name the
release owner and follow-up. Public records stand alone. Private maintainer
instructions travel through an explicit private handoff.

Carry existing authorization within its scope. Tests or instructions alone do not
authorize tracker writes, pushes, merges, signing or publication. Semver/category
labels do not establish triage readiness. Resolve current labels before edits.
