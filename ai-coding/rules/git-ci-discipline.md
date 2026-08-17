# Git and CI discipline

Never run an installed aih-supported against this checkout. Review the full
diff and run direct repository checks before committing. Local commits are
allowed when requested; remote, PR, publication, and GitHub changes require
separate explicit approval.

The local pre-commit hook runs typecheck, lint, and tests. CI may perform only
read-only verification and must not run repository initialization.
