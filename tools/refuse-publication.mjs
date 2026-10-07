process.stderr.write(
  "Catalog publication is blocked: this greenfield candidate requires a separately reviewed and authorized release path. See RELEASING.md.\n",
);
process.exitCode = 1;
