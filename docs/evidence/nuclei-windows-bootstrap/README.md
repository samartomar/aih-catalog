# Windows bootstrap failure evidence

On 2026-10-11 the owner ran the reviewed native Windows wrapper against the exact
[unpublished artifacts](../../nuclei-corrected-artifacts.json). Host/runtime readiness
had passed with native Node 24.19.0, Docker CLI/daemon 29.8.0, Docker Desktop 4.92.0
and the permitted loopback fixture interface. The original window was
22:02:37.489Z–22:17:37.489Z. Execution stopped at 22:03:31.621Z.

The wrapper verified the reviewed inputs and immutable image index, confirmed the
exact amd64 image was absent, pulled it once, and verified its digest/OS/architecture.
That acquisition completed and the image is retained. It must not be silently
repeated as part of recovery.

The next command failed while npm loaded configuration: the wrapper assigned the
same empty file to both `npm_config_userconfig` and `npm_config_globalconfig`.
npm refused to load one file in both roles. The earlier offline dependency audit
used npm Arborist directly and therefore missed the npm CLI configuration boundary.

The consumer contains only the seeded `package.json` and lockfile; package
installation did not begin. The runner never started, **zero assessments** started,
and no native reports exist. Read-only checks at 22:06:47Z confirmed all three
ticket-owned container names and all three network names absent, no runner staging
or evidence directory, and no listener on port 30883. No cleanup mutation was needed.

The correction gives the two configuration roles separate empty files and loads
the actual native npm configuration during readiness. A focused regression executes
the wrapper's own embedded environment setup and bounded launcher against npm's
configuration command. The original configuration reproduces the observed error;
separating only the global file removes it. This config-only check installs no
package and launches no Docker container or assessment.

[execution-summary.json](execution-summary.json) is an explicitly derived public
summary. It records hashes of the original host-specific ledger and relevant logs;
the originals, exact transfer packet and failed output root remain retained privately.
No native report is fabricated or normalized into a success record.

The failure fired the plan's stop condition. Unused assessment starts do not grant
a rerun or window reset. Another bounded Windows execution needs explicit owner
authorization after the correction and actual inputs are reviewed. Catalog #65
remains open for native finding/zero/cancellation and report-preserving cleanup.
Linux acceptance is unchanged and its three-start budget is exhausted. No package
or helper bytes changed, and npm publication remains outside this delivery.
