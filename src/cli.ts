import { runCatalogV2Cli } from "./supported/signed-catalog-v2.js";

process.exitCode = runCatalogV2Cli(process.argv.slice(2));
