process.stderr.write(
  "Catalog publication is blocked: the greenfield release, reader and recipe interfaces are not implemented. See docs/TRANSITION.md.\n",
);
process.exitCode = 1;
