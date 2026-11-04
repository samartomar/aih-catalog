#!/usr/bin/env node
// Ports the three AI setups (code-review-graph, codebase-memory-mcp and Serena) as framework
// content through the ordinary producer, writes their qualifications as separate data, and
// drafts the trio combination recipe. Each upstream is read at its release tag's commit by a
// hookless partial Git fetch of only the files the items name (codebase-memory-mcp's repository
// is larger than a whole-source fetch allows); nothing is executed. The AI setup records and the
// qualifications hold public facts only: artifact names, sizes and sha256, and each
// qualification run's result with the sha256 of the run's own record. A status is the one the
// recorded run gave; nothing here is qualified that a real run did not qualify. `--check`
// rebuilds and compares instead of writing.
//
// usage: npm run port:ai-setup [-- --check]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { buildContent, checkContent } from "../dist/catalog/producer.js";
import { readQualification } from "../dist/catalog/reader.js";
import { findItems } from "../dist/catalog/source.js";
import {
  canonical,
  check,
  discoveredFile,
  encoder,
  portTool,
  root,
  sha256,
  shaOf,
} from "./lib/port.mjs";

for (const arg of process.argv.slice(2))
  if (arg !== "--check") {
    console.error(`port-ai-setup: unexpected argument ${arg}`);
    process.exit(2);
  }

/** Each upstream's release tag and the commit it names. */
const PINS = {
  crg: {
    repository: "https://github.com/tirth8205/code-review-graph",
    tag: "v2.3.9",
    commit: "343ab7cea29d47a3e805381e09f8243a43d43d88",
  },
  cbm: {
    repository: "https://github.com/DeusData/codebase-memory-mcp",
    tag: "v0.12.1",
    commit: "a7158ac2f48ca646b4527341b76f930f2aeff87e",
  },
  serena: {
    repository: "https://github.com/oraios/serena",
    tag: "v2.1.0",
    commit: "5e4f5cd173c7ff3eed37ee3f1de6c266b937c5dc",
  },
};
const ALL_CELLS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "windows-arm64",
  "windows-x64",
];
const QUALIFICATION = "urn:aihq:catalog:qualification:0.1.0";
const { out, fail, writeOrCompare } = portTool("port-ai-setup");

// --- Reading the pinned files --------------------------------------------------------------

const gitEnv = () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  return { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull, GIT_TERMINAL_PROMPT: "0" };
};
function git(cwd, args, input) {
  const result = spawnSync(
    "git",
    [
      "-c",
      `core.hooksPath=${devNull}`,
      "-c",
      "core.fsmonitor=false",
      "-c",
      "protocol.allow=never",
      "-c",
      "protocol.https.allow=always",
      ...args,
    ],
    { cwd, env: gitEnv(), input, maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.status !== 0) fail(`git ${args.join(" ")}: ${String(result.stderr).slice(0, 500)}`);
  return result.stdout;
}

/** The files under `prefixes` at the pin, with modes, sha256 and bytes, read without a checkout. */
function pinnedFiles(name, work, prefixes) {
  const pin = PINS[name];
  const repo = join(work, name);
  mkdirSync(repo);
  git(repo, ["init", "-q", "--bare", "--template="]);
  git(repo, [
    "fetch",
    "-q",
    "--depth=1",
    "--no-tags",
    "--filter=blob:none",
    pin.repository,
    pin.commit,
  ]);
  const tags = String(
    git(repo, ["ls-remote", pin.repository, `refs/tags/${pin.tag}`, `refs/tags/${pin.tag}^{}`]),
  );
  const tagged = tags
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t")[0]);
  if (!tagged.includes(pin.commit)) fail(`${name} ${pin.tag} no longer names ${pin.commit}`);
  const listing = String(git(repo, ["ls-tree", "-r", "-z", pin.commit]))
    .split("\0")
    .filter(Boolean);
  const files = [];
  for (const line of listing) {
    const [meta, path] = line.split("\t");
    const [mode, type] = meta.split(" ");
    if (type !== "blob" || !prefixes.some((prefix) => path === prefix || path.startsWith(prefix)))
      continue;
    if (mode !== "100644" && mode !== "100755") fail(`${name} ${path} has mode ${mode}`);
    const bytes = new Uint8Array(git(repo, ["cat-file", "blob", `${pin.commit}:${path}`]));
    files.push({ path, mode, sha256: sha256(bytes), bytes });
  }
  return files.sort((left, right) => (left.path < right.path ? -1 : 1));
}

const fileOf = (files, path) => files.find((file) => file.path === path) ?? fail(`missing ${path}`);

// --- Qualifications: public facts and the recorded result of each run -----------------------

/** CBM 0.12.1 release archives, checked against the release's own digests, with member modes. */
const CBM_RELEASE = "https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.12.1/";
const NOTICES_UNIX = {
  path: "THIRD_PARTY_NOTICES.md",
  sha256: "85ba0e25610a3d1a71df75c46425141644b416f290de5c8d985ae5d2d02092e4",
  executable: false,
};
const NOTICES_WIN = {
  path: "THIRD_PARTY_NOTICES.md",
  sha256: "3beaf2bc23fed38ae8e926a5bdff1a5d4ea20aa34972bf9a5aa6a8d890a9347c",
  executable: false,
};
const LICENSE_MEMBER = {
  path: "LICENSE",
  sha256: "1f58f9911dc5e3bcb96de28bb28e7b6bb7eb323952d29569c5d7214a152146bb",
  executable: false,
};
const INSTALL_SH = {
  path: "install.sh",
  sha256: "13049c7cc51bc508d68b8ecb8a9fd9574ecb7c6f2c9dd5a19bf7d4c187321145",
  executable: true,
};
const INSTALL_PS1 = {
  path: "install.ps1",
  sha256: "edc5e194702e21b01d38648a25d44d783022bba992b5fb62b08528e2c71ca370",
  executable: false,
};
const cbmArchive = (cell, file, sha, bytes, program, programSha) => ({
  cells: [cell],
  kind: "native-archive",
  file,
  url: `${CBM_RELEASE}${file}`,
  sha256: sha,
  bytes,
  members: [
    { path: program, sha256: programSha, executable: true },
    LICENSE_MEMBER,
    ...(cell.startsWith("windows-") ? [INSTALL_PS1, NOTICES_WIN] : [INSTALL_SH, NOTICES_UNIX]),
  ].sort((left, right) => (left.path < right.path ? -1 : 1)),
});
const CBM_DISTRIBUTIONS = [
  cbmArchive(
    "darwin-arm64",
    "codebase-memory-mcp-darwin-arm64.tar.gz",
    "9bfcbe38414b47969a3e1d1c1999f5357409387c86fa3d24221b5458267660d2",
    49875423,
    "codebase-memory-mcp",
    "a36cfa1f5d10d8c4762501d63feef082711aae4704b9e8f9066db52779a8601e",
  ),
  cbmArchive(
    "darwin-x64",
    "codebase-memory-mcp-darwin-amd64.tar.gz",
    "ca6e64397a8ae80cec898a8205a6aa16750ac798acc05a0c3ed983837944a581",
    50555159,
    "codebase-memory-mcp",
    "f3ba4d7dd462be868eff85f0dccb7375405f58084da800826065df2312b028ab",
  ),
  cbmArchive(
    "linux-arm64",
    "codebase-memory-mcp-linux-arm64-portable.tar.gz",
    "ed0f1f548cd79b121c401c2e9f7841c189a001af26d3768368088c24f6a53533",
    48466763,
    "codebase-memory-mcp",
    "6a64e20e2ca8dc15b4a412e981e5aea60804ed3e952d693ab491c93ccd36ed45",
  ),
  cbmArchive(
    "linux-x64",
    "codebase-memory-mcp-linux-amd64-portable.tar.gz",
    "8c3d0341064301e78ecc84cf7348d4e2c6562a0f57448243ea560aaa34de36c1",
    48920994,
    "codebase-memory-mcp",
    "77745491f0a9c346d6da23eed4d92b5feaa31a27a883c9faa4fa9f47c8183705",
  ),
  cbmArchive(
    "windows-arm64",
    "codebase-memory-mcp-windows-arm64.zip",
    "934ab6bd67a76c6ebd9e110d87b7090ffd629919bedaeddabe5a19175038b063",
    47934918,
    "codebase-memory-mcp.exe",
    "b19816bb88ef3145a0f4b81856665c67a684cc038e06ae696e76960277c67b41",
  ),
  cbmArchive(
    "windows-x64",
    "codebase-memory-mcp-windows-amd64.zip",
    "4e4e0f16b45233af5c757a1fcbe3c3b16e9056375b1fbe2ce020b6de75dedcc0",
    48508123,
    "codebase-memory-mcp.exe",
    "39f6a789cd858d7428561ac5afaefb9a47b018dcba0ad6fa41ae71a45e0ed656",
  ),
];
const CRG_WHEEL = {
  cells: ALL_CELLS,
  kind: "pypi-wheel",
  file: "code_review_graph-2.3.9-py3-none-any.whl",
  url: "https://files.pythonhosted.org/packages/f3/79/f76be5687b87124039255fe70de06b2f266ece877f1038d9a3d0bde4a1c2/code_review_graph-2.3.9-py3-none-any.whl",
  sha256: "908500a23f23fe05566090a2e5fce95f7f177d054090a355b46367546db5d910",
  bytes: 786718,
};
const SERENA_WHEEL = {
  cells: ALL_CELLS,
  kind: "pypi-wheel",
  file: "serena_agent-2.1.0-py3-none-any.whl",
  url: "https://files.pythonhosted.org/packages/6f/95/0905a379bcde1d307b05627a2ff4ccabf18b98af3ed25da4a800c01fbd52/serena_agent-2.1.0-py3-none-any.whl",
  sha256: "cc6ae542c39b4de5d98cdf35a4ceb0b551f316c5f22e9d0f0b0c5f35d6b95d87",
  bytes: 1144652,
};
/** The hash-locked, binary-only closure the code-review-graph run projected for Linux x64. */
const CRG_LINUX_X64_CLOSURE = [
  [
    "aiofile",
    "3.12.3",
    "aiofile-3.12.3-py3-none-any.whl",
    "5c1bcc9e929c50834608e8cc1a4cc1d7503eb60c15a535b779fd39e2f372c017",
  ],
  [
    "annotated-types",
    "0.8.0",
    "annotated_types-0.8.0-py3-none-any.whl",
    "f072f4d804ea359e4eaf198b1af7a8b0943881a87f31bb764f8bf219bb9419e0",
  ],
  [
    "anyio",
    "4.15.1",
    "anyio-4.15.1-py3-none-any.whl",
    "6152fdbbf9a77fdec97731721bebf7c4c44f7c29b424b0065826173efc7ed101",
  ],
  [
    "attrs",
    "26.1.0",
    "attrs-26.1.0-py3-none-any.whl",
    "c647aa4a12dfbad9333ca4e71fe62ddc36f4e63b2d260a37a8b83d2f043ac309",
  ],
  [
    "Authlib",
    "1.9.1",
    "authlib-1.9.1-py2.py3-none-any.whl",
    "8b9be8b1e5174dcbf5520e984f1a22dc2edae5b6e40a61d4cedbf86b97e9e69b",
  ],
  [
    "beartype",
    "0.23.1",
    "beartype-0.23.1-py3-none-any.whl",
    "4461b4dc57e3fdd6c8a8464b22cf118002eea107c33e9fef651c69068ab3cce3",
  ],
  [
    "cachetools",
    "7.2.6",
    "cachetools-7.2.6-py3-none-any.whl",
    "8722e08fc36ae0838a9a0a2ab9935554720de3343a62dad7aae7c595854c8623",
  ],
  [
    "caio",
    "0.12.10",
    "caio-0.12.10-py3-none-any.whl",
    "b34a5483b987d207348ebbf86921bc42f08abcde833b91e0caa8760c7daa2f03",
  ],
  [
    "certifi",
    "2026.10.23",
    "certifi-2026.10.23-py3-none-any.whl",
    "e9b54de76e530bb6cf0ccd036787103acb58fd42ba930ea8bf948ddbaa2f61d1",
  ],
  [
    "cffi",
    "2.1.1",
    "cffi-2.1.1-cp314-cp314-manylinux2014_x86_64.manylinux_2_17_x86_64.whl",
    "b0431303acaea1089ad4b3e9ce4e6518193def1118d4073ca848635ee4ea2e96",
  ],
  [
    "click",
    "8.5.0",
    "click-8.5.0-py3-none-any.whl",
    "255bc9599cf7748b4b1a446ccc735421bd08a2ae529a8b88597d3de5664ee360",
  ],
  [
    "code-review-graph",
    "2.3.9",
    "code_review_graph-2.3.9-py3-none-any.whl",
    "908500a23f23fe05566090a2e5fce95f7f177d054090a355b46367546db5d910",
  ],
  [
    "cryptography",
    "50.0.2",
    "cryptography-50.0.2-cp311-abi3-manylinux_2_28_x86_64.whl",
    "4061c0079120205fb760c58acab6443e217307dcf05e3702cf970e0689972856",
  ],
  [
    "cyclopts",
    "5.3.1",
    "cyclopts-5.3.1-py3-none-any.whl",
    "818258c6d55f8c928f6c3b85fdc94121825f98f6f625c43ae6faabfb121412e1",
  ],
  [
    "dnspython",
    "2.9.0",
    "dnspython-2.9.0-py3-none-any.whl",
    "9a4aedb833c3c1b49214d04d44d3032ab7a9135f7c1d29a549b4ff78fd82fda9",
  ],
  [
    "docstring_parser",
    "0.18.0",
    "docstring_parser-0.18.0-py3-none-any.whl",
    "b3fcbed555c47d8479be0796ef7e19c2670d428d72e96da63f3a40122860374b",
  ],
  [
    "email-validator",
    "2.3.0",
    "email_validator-2.3.0-py3-none-any.whl",
    "80f13f623413e6b197ae73bb10bf4eb0908faf509ad8362c5edeb0be7fd450b4",
  ],
  [
    "exceptiongroup",
    "1.3.1",
    "exceptiongroup-1.3.1-py3-none-any.whl",
    "a7a39a3bd276781e98394987d3a5701d0c4edffb633bb7a5144577f82c773598",
  ],
  [
    "fastmcp",
    "3.4.11",
    "fastmcp-3.4.11-py3-none-any.whl",
    "f50a7aa4cc2a5954d02fcc9672ff1d69daff73a02387f959c2647523cd6d5606",
  ],
  [
    "fastmcp-slim",
    "3.4.11",
    "fastmcp_slim-3.4.11-py3-none-any.whl",
    "24535dd843b3dcb3272b86c88fdf6ada5026c39ec5b56e2426557223c4d2c8bf",
  ],
  [
    "griffelib",
    "2.4.1",
    "griffelib-2.4.1-py3-none-any.whl",
    "76bc562f936ad1ce198d2cf6d0731bd5c92a7d934b69ef828ef22ee0ffdb62ce",
  ],
  [
    "h11",
    "0.16.0",
    "h11-0.16.0-py3-none-any.whl",
    "63cf8bbe7522de3bf65932fda1d9c2772064ffb3dae62d55932da54b31cb6c86",
  ],
  [
    "httpcore",
    "1.0.9",
    "httpcore-1.0.9-py3-none-any.whl",
    "2d400746a40668fc9dec9810239072b40b4484b640a8c38fd654a024c7a1bf55",
  ],
  [
    "httpx",
    "0.28.1",
    "httpx-0.28.1-py3-none-any.whl",
    "d909fcccc110f8c7faf814ca82a9a4d816bc5a6dbfea25d6591d6985b8ba59ad",
  ],
  [
    "httpx-sse",
    "0.4.3",
    "httpx_sse-0.4.3-py3-none-any.whl",
    "0ac1c9fe3c0afad2e0ebb25a934a59f4c7823b60792691f779fad2c5568830fc",
  ],
  [
    "idna",
    "3.20",
    "idna-3.20-py3-none-any.whl",
    "ab7ae7122974553370f0bdb919e1a960b2cd1bc1ef0276416d896db81c14582c",
  ],
  [
    "jaraco.classes",
    "3.4.0",
    "jaraco.classes-3.4.0-py3-none-any.whl",
    "f662826b6bed8cace05e7ff873ce0f9283b5c924470fe664fff1c2f00f581790",
  ],
  [
    "jaraco.context",
    "6.1.2",
    "jaraco_context-6.1.2-py3-none-any.whl",
    "bf8150b79a2d5d91ae48629d8b427a8f7ba0e1097dd6202a9059f29a36379535",
  ],
  [
    "jaraco.functools",
    "4.6.0",
    "jaraco_functools-4.6.0-py3-none-any.whl",
    "99e3dc0060c5cbe8fcd1cdb36258e2a65ca40f1566b2033b12abb1bb44dd3c30",
  ],
  [
    "jeepney",
    "0.9.0",
    "jeepney-0.9.0-py3-none-any.whl",
    "97e5714520c16fc0a45695e5365a2e11b81ea79bba796e26f9f1d178cb182683",
  ],
  [
    "joserfc",
    "1.7.7",
    "joserfc-1.7.7-py3-none-any.whl",
    "06979cfbab78bc802f14c0358f32969826cc26720e13cb38926ffdc86bc0cb2c",
  ],
  [
    "jsonref",
    "1.1.0",
    "jsonref-1.1.0-py3-none-any.whl",
    "590dc7773df6c21cbf948b5dac07a72a251db28b0238ceecce0a2abfa8ec30a9",
  ],
  [
    "jsonschema",
    "4.26.0",
    "jsonschema-4.26.0-py3-none-any.whl",
    "d489f15263b8d200f8387e64b4c3a75f06629559fb73deb8fdfb525f2dab50ce",
  ],
  [
    "jsonschema-path",
    "0.5.0",
    "jsonschema_path-0.5.0-py3-none-any.whl",
    "2790a070bc7abb08ea3dbe4d340ece4efadf639223001f020c7503229ba068e2",
  ],
  [
    "jsonschema-specifications",
    "2025.9.1",
    "jsonschema_specifications-2025.9.1-py3-none-any.whl",
    "98802fee3a11ee76ecaca44429fda8a41bff98b00a0f2838151b113f210cc6fe",
  ],
  [
    "keyring",
    "25.7.0",
    "keyring-25.7.0-py3-none-any.whl",
    "be4a0b195f149690c166e850609a477c532ddbfbaed96a404d4e43f8d5e2689f",
  ],
  [
    "markdown-it-py",
    "4.2.0",
    "markdown_it_py-4.2.0-py3-none-any.whl",
    "9f7ebbcd14fe59494226453aed97c1070d83f8d24b6fc3a3bcf9a38092641c4a",
  ],
  [
    "mcp",
    "1.30.0",
    "mcp-1.30.0-py3-none-any.whl",
    "666edb5009503e1047c9d60346a756f94b261f05cc2625f23d41c728ffc484d0",
  ],
  [
    "mdurl",
    "0.1.2",
    "mdurl-0.1.2-py3-none-any.whl",
    "84008a41e51615a49fc9966191ff91509e3c40b939176e643fd50a5c2196b8f8",
  ],
  [
    "more-itertools",
    "11.2.1",
    "more_itertools-11.2.1-py3-none-any.whl",
    "35a7377edd1dd6608dcb2cdf534ded55ea32d49448875ad042cd3f879fb1ded0",
  ],
  [
    "networkx",
    "3.7",
    "networkx-3.7-py3-none-any.whl",
    "e3fd2c13a7814cee3746340d8d7f8598a67f16a58bf47fb7f8793fab6efca1b0",
  ],
  [
    "openapi-pydantic",
    "0.6.0",
    "openapi_pydantic-0.6.0-py3-none-any.whl",
    "8bd6d548a250da37db96f461bcd52b3468e8834ad7d6db14b00a6b2ebbd163a3",
  ],
  [
    "opentelemetry-api",
    "1.45.1",
    "opentelemetry_api-1.45.1-py3-none-any.whl",
    "b31553efa588ae44bc306f863c785c5333a9ecc091248c6ee68b4b6c87fdedfb",
  ],
  [
    "packaging",
    "26.3",
    "packaging-26.3-py3-none-any.whl",
    "d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c",
  ],
  [
    "pathable",
    "0.6.0",
    "pathable-0.6.0-py3-none-any.whl",
    "82c4ca6c98c502ad12e0d4e9779b6210afee93c38990988c8c5d1b49bdcdf566",
  ],
  [
    "platformdirs",
    "4.13.5",
    "platformdirs-4.13.5-py3-none-any.whl",
    "53d3ec4280b815c1e0b02edad7f9ee8fda1ba9c0865dd9c2e6e63849ce82fc1e",
  ],
  [
    "py-key-value-aio",
    "0.4.6",
    "py_key_value_aio-0.4.6-py3-none-any.whl",
    "820b30c7959fc738ea3d00160cdb10cd258f51e38737b2add530defeea1ded77",
  ],
  [
    "pycparser",
    "3.12",
    "pycparser-3.12-py3-none-any.whl",
    "a076f3f489b39b43ed13563a1dafe42447445bec2e294154ec5c57fcdda4c85e",
  ],
  [
    "pydantic",
    "2.14.1",
    "pydantic-2.14.1-py3-none-any.whl",
    "9195d967ec791692a04438115466764fb8b9a27b31f14a760437694f40d6b454",
  ],
  [
    "pydantic-settings",
    "2.16.1",
    "pydantic_settings-2.16.1-py3-none-any.whl",
    "30f5313340da4e8f1b440d1910b92a5bc3ccbb6b4ba70ec2b8395bc921f418f5",
  ],
  [
    "pydantic_core",
    "2.50.1",
    "pydantic_core-2.50.1-cp314-cp314-manylinux_2_17_x86_64.manylinux2014_x86_64.whl",
    "42b54c2c90ad348b5e3a85e03e715d572c1fde357ef104cdfe3b03b697a404ea",
  ],
  [
    "Pygments",
    "2.21.0",
    "pygments-2.21.0-py3-none-any.whl",
    "2363c69b61c4a97c838da3b130dcd6468f4848992b21a82f2a63ec34377137d9",
  ],
  [
    "PyJWT",
    "2.15.1",
    "pyjwt-2.15.1-py3-none-any.whl",
    "42d59d631f7768a1028a64c7ff581a9bf7519804daf91fc5b6c56e30eec5e193",
  ],
  [
    "pyperclip",
    "1.11.0",
    "pyperclip-1.11.0-py3-none-any.whl",
    "299403e9ff44581cb9ba2ffeed69c7aa96a008622ad0c46cb575ca75b5b84273",
  ],
  [
    "python-dotenv",
    "1.2.4",
    "python_dotenv-1.2.4-py3-none-any.whl",
    "42269a8a5b3fd54ffa6f3d84b18abed50064717576b4ecf03dc4a55d8aa04fdc",
  ],
  [
    "python-multipart",
    "0.0.32",
    "python_multipart-0.0.32-py3-none-any.whl",
    "ff6d3f776f16878c894e52e107296ffc890e913c611b1a4ec6c44e2821fe2e23",
  ],
  [
    "PyYAML",
    "6.0.3",
    "pyyaml-6.0.3-cp314-cp314-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl",
    "c458b6d084f9b935061bc36216e8a69a7e293a2f1e68bf956dcd9e6cbcd143f5",
  ],
  [
    "referencing",
    "0.37.0",
    "referencing-0.37.0-py3-none-any.whl",
    "381329a9f99628c9069361716891d34ad94af76e461dcb0335825aecc7692231",
  ],
  [
    "rich",
    "15.0.0",
    "rich-15.0.0-py3-none-any.whl",
    "33bd4ef74232fb73fe9279a257718407f169c09b78a87ad3d296f548e27de0bb",
  ],
  [
    "rich-rst",
    "2.2.0",
    "rich_rst-2.2.0-py3-none-any.whl",
    "1ea1c43813dc4a8d86475fce27ffb74e0ada3d4656c9f8130ba2a59868055fe9",
  ],
  [
    "rpds-py",
    "2026.9.1",
    "rpds_py-2026.9.1-cp314-cp314-manylinux_2_17_x86_64.manylinux2014_x86_64.whl",
    "eac2f5dbafd585dfe31f86a23ebf0d3ba480a9d49ebc87947267b5608d4ea0cd",
  ],
  [
    "SecretStorage",
    "3.5.0",
    "secretstorage-3.5.0-py3-none-any.whl",
    "0ce65888c0725fcb2c5bc0fdb8e5438eece02c523557ea40ce0703c266248137",
  ],
  [
    "sse-starlette",
    "3.6.0",
    "sse_starlette-3.6.0-py3-none-any.whl",
    "e4dfa4d237d2712cb2b4d4918eda9b457cd6b44bbecdc838af75de836565bafd",
  ],
  [
    "starlette",
    "1.10.0",
    "starlette-1.10.0-py3-none-any.whl",
    "478c0ab3b4ced6e82719849c118fa406f0278a3499c1a898cd15cd31bdc38ce4",
  ],
  [
    "tree-sitter",
    "0.26.0",
    "tree_sitter-0.26.0-cp314-cp314-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl",
    "f665510f0fcf4636fb9696f1f7853bed7a3bd764b7bb0cb8494e619c14ed5a0c",
  ],
  [
    "tree-sitter-c-sharp",
    "0.23.5",
    "tree_sitter_c_sharp-0.23.5-cp310-abi3-manylinux1_x86_64.manylinux_2_28_x86_64.manylinux_2_5_x86_64.whl",
    "aa88a780204cd153c4c1ae2d59c654cee1402212fa0d069823d6d34301587438",
  ],
  [
    "tree-sitter-embedded-template",
    "0.25.0",
    "tree_sitter_embedded_template-0.25.0-cp310-abi3-manylinux1_x86_64.manylinux_2_28_x86_64.manylinux_2_5_x86_64.whl",
    "a7c88c3dd8b94b3c9efe8ae071ff6b1b936a27ac5f6e651845c3b9631fa4c1c2",
  ],
  [
    "tree-sitter-language-pack",
    "0.13.0",
    "tree_sitter_language_pack-0.13.0-cp310-abi3-manylinux2014_x86_64.whl",
    "0d4f261fce387ae040dae7e4d1c1aca63d84c88320afcc0961c123bec0be8377",
  ],
  [
    "tree-sitter-yaml",
    "0.7.2",
    "tree_sitter_yaml-0.7.2-cp310-abi3-manylinux1_x86_64.manylinux_2_28_x86_64.manylinux_2_5_x86_64.whl",
    "f1a5c60c98b6c4c037aae023569f020d0c489fad8dc26fdfd5510363c9c29a41",
  ],
  [
    "typing-inspection",
    "0.4.4",
    "typing_inspection-0.4.4-py3-none-any.whl",
    "65b8397ba37ccbce054456aaccddfc91e6e3083c92824df348d96ca832f3f147",
  ],
  [
    "typing_extensions",
    "4.16.0",
    "typing_extensions-4.16.0-py3-none-any.whl",
    "481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8",
  ],
  [
    "uncalled-for",
    "0.4.1",
    "uncalled_for-0.4.1-py3-none-any.whl",
    "b611b38879d9fe5088297e7bb28f2ddd12d2d73dad933d93da107fb63eb4058e",
  ],
  [
    "uvicorn",
    "0.54.0",
    "uvicorn-0.54.0-py3-none-any.whl",
    "505bdb0f318731d45f1f712071fc781a8981f6847a31c902c9f5e652d4f67faf",
  ],
  [
    "watchdog",
    "6.0.0",
    "watchdog-6.0.0-py3-none-manylinux2014_x86_64.whl",
    "20ffe5b202af80ab4266dcd3e91aae72bf2da48c0d33bdb15c66658e685e94e2",
  ],
  [
    "watchfiles",
    "1.3.0",
    "watchfiles-1.3.0-cp310-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64.whl",
    "b5768b49e426fd5b550b012c866db347cdf15c398ef98dc557b6e6b72fa74cd1",
  ],
  [
    "websockets",
    "17.3",
    "websockets-17.3-cp314-cp314-manylinux1_x86_64.manylinux_2_28_x86_64.manylinux_2_5_x86_64.whl",
    "8dbb3862aa649de95660b6337d97101977f160b5b354d07b82fe309874d2c8bc",
  ],
].map(([name, version, file, sha]) => ({ name, version, file, sha256: sha }));

const artifactOf = (distribution) => ({
  file: distribution.file,
  sha256: distribution.sha256,
  bytes: distribution.bytes,
});
const record = (aiSetup, version, cell, observed, result) => ({
  schema: QUALIFICATION,
  subject: { aiSetup, version, cell },
  observed,
  result,
});
/**
 * Each qualification as its run recorded it. `run` is the sha256 of that run's own record,
 * which stays with the evidence; the result is never upgraded here.
 */
const QUALIFICATIONS = [
  // codebase-memory-mcp: the Linux x64 portable executable passed an isolated native CLI and MCP
  // run (manual indexing, watcher, UI and diagnostics off, root and link refusal, cleanup).
  record(
    "cbm.ai-setup.codebase-memory-mcp",
    "0.12.1",
    "linux-x64",
    {
      artifact: artifactOf(CBM_DISTRIBUTIONS[3]),
      members: CBM_DISTRIBUTIONS[3].members,
      closure: null,
      interpreter: null,
    },
    {
      status: "qualified",
      run: "a5db607fe7e748e044eeac9afd50b4b324d8c2fd2646c04c07315b6a7fc8a049",
      date: "2026-10-27",
    },
  ),
  // The other five archives were downloaded and every member hashed; none was run natively.
  ...CBM_DISTRIBUTIONS.filter((entry) => entry.cells[0] !== "linux-x64").map((entry) =>
    record(
      "cbm.ai-setup.codebase-memory-mcp",
      "0.12.1",
      entry.cells[0],
      { artifact: artifactOf(entry), members: entry.members, closure: null, interpreter: null },
      {
        status: "unknown",
        reason:
          "artifact and members verified against the release digests; not run natively on this cell",
        run: "29cafd8ab5b9f0fd320d504b57a75932fd96a05a14371feaa67e200988bb070a",
        date: "2026-10-27",
      },
    ),
  ),
  // code-review-graph: every wheel of the Linux x64 closure was acquired and verified, but the
  // run's exact interpreter had no download, so nothing ran natively.
  record(
    "crg.ai-setup.code-review-graph",
    "2.3.9",
    "linux-x64",
    { artifact: artifactOf(CRG_WHEEL), closure: CRG_LINUX_X64_CLOSURE, interpreter: null },
    {
      status: "blocked",
      reason:
        "no interpreter artifact: uv's catalogue had no download for the run's CPython 3.14.10, so the verified wheel closure was never run natively",
      run: "f012bb893739f98c06d9cdfd6d409072bea9cb6c95019ea86d375d7bfd3177b7",
      date: "2026-10-27",
    },
  ),
  // code-review-graph rerun on the latest CPython in its range: the interpreter was acquired and
  // verified, but two of the closure's packages publish no wheel for it, so nothing ran.
  record(
    "crg.ai-setup.code-review-graph",
    "2.3.9",
    "linux-x64",
    {
      artifact: artifactOf(CRG_WHEEL),
      closure: null,
      interpreter: {
        version: "3.15.2",
        file: "cpython-3.15.2+20261026-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz",
        sha256: "7b03163a980c607ba8194709d4a4086735a7a9c488cc475b098157306927b36b",
        bytes: 38129918,
      },
    },
    {
      status: "blocked",
      reason:
        "no binary-only closure on CPython 3.15.2, the latest release in >=3.10: pyyaml 6.0.3 and tree-sitter 0.26.0, the latest of each on PyPI on 2026-11-04, publish no cp315 or abi3 Linux x86_64 wheel, only source distributions; a source build is not accepted, so nothing ran natively",
      run: "f4c3647cd168bccfd05775a57e8cd0f1c0ca765a334a5596d91871bb06daeb7f",
      date: "2026-11-04",
    },
  ),
  // Serena: no binary-only closure exists, so nothing ran.
  record(
    "serena.ai-setup.serena",
    "2.1.0",
    "linux-x64",
    { artifact: artifactOf(SERENA_WHEEL), closure: null, interpreter: null },
    {
      status: "blocked",
      reason:
        "no binary-only closure: proxy-tools 0.1.0 publishes only a source distribution, and serena-agent 2.1.0 pins pyyaml 6.0.2, which has no CPython 3.14 wheel; a source build is not accepted, so nothing ran natively",
      run: "65ea61da2d1c7ef2c0f2747fa1a8448c6a7f2cc13810ae6c9d23244c348332a8",
      date: "2026-10-27",
    },
  ),
];
const accepted = (id) =>
  QUALIFICATIONS.filter((entry) => entry.subject.aiSetup === id)
    .map(shaOf)
    .sort();

// --- The three frameworks ---------------------------------------------------------------------

const SERENA_ARGS = (context) => [
  "start-mcp-server",
  "--project-from-cwd",
  "--context",
  context,
  "--agent-interface",
  "tools",
  "--enable-web-dashboard",
  "false",
  "--open-web-dashboard",
  "false",
  "--enable-gui-log-window",
  "false",
  "--tool-timeout",
  "240",
];
const settingsOff = (key) => ({
  argv: ["config", "set", key, "false"],
  readback: { argv: ["config", "get", key], expected: "false" },
});

async function crg(work) {
  const files = pinnedFiles("crg", work, ["skills/", ".mcp.json", "LICENSE"]);
  const found = findItems(
    files.filter((file) => file.path.startsWith("skills/") || file.path === "LICENSE"),
    { framework: "crg", sourceId: "crg" },
  );
  if (found.status !== "ok") fail(`findItems crg: ${JSON.stringify(found)}`);
  const id = "crg.ai-setup.code-review-graph";
  const items = [
    ...found.items,
    {
      id: "crg.mcp.code-review-graph",
      kind: "mcp",
      files: [
        discoveredFile("crg", fileOf(files, ".mcp.json"), {
          cut: {
            pointer: "/mcpServers/code-review-graph",
            as: "mcp",
            version: "2.3.9",
            description:
              "code-review-graph MCP server: a local knowledge graph of the repository for token-efficient code review.",
          },
        }),
      ],
      dependencies: [id],
      env: { CRG_TOOL_TIMEOUT: "120", PYTHONUTF8: "1" },
      startupSeconds: 30,
      callSeconds: 300,
    },
    {
      id,
      kind: "ai-setup",
      name: "code-review-graph",
      description:
        "code-review-graph 2.3.9: a local knowledge graph of the repository for token-efficient code review, served over MCP.",
      files: [],
      aiSetup: {
        version: "2.3.9",
        distributions: [CRG_WHEEL],
        runtime: { python: ">=3.10", closure: "uv-lock" },
        executable: "code-review-graph",
        launch: { args: ["serve"] },
        mcpItem: "crg.mcp.code-review-graph",
        settings: { commands: [], files: [] },
        doNotRun: [["code-review-graph", "install"]],
        qualifications: accepted(id),
      },
    },
  ];
  return build("crg", "code-review-graph", files, items);
}

async function cbm(work) {
  const files = pinnedFiles("cbm", work, ["server.json", "LICENSE"]);
  const id = "cbm.ai-setup.codebase-memory-mcp";
  const items = [
    {
      id: "cbm.mcp.codebase-memory-mcp",
      kind: "mcp",
      files: [discoveredFile("cbm", fileOf(files, "server.json"))],
      dependencies: [id],
      env: { CBM_DIAGNOSTICS: "false" },
      startupSeconds: 45,
      callSeconds: 600,
    },
    {
      id,
      kind: "ai-setup",
      name: "codebase-memory-mcp",
      description:
        "codebase-memory-mcp 0.12.1: a native codebase knowledge graph with architecture and decision records, served over MCP.",
      files: [],
      aiSetup: {
        version: "0.12.1",
        distributions: CBM_DISTRIBUTIONS,
        executable: "codebase-memory-mcp",
        launch: { args: ["--ui=false"] },
        mcpItem: "cbm.mcp.codebase-memory-mcp",
        settings: {
          commands: ["watcher_enabled", "auto_watch", "auto_index"].map(settingsOff),
          files: [],
        },
        doNotRun: [
          ["codebase-memory-mcp", "install"],
          ["codebase-memory-mcp", "uninstall"],
          ["install.sh"],
          ["install.ps1"],
        ],
        qualifications: accepted(id),
      },
    },
  ];
  return build("cbm", "codebase-memory-mcp", files, items);
}

async function serena(work) {
  const files = pinnedFiles("serena", work, ["server.json", "LICENSE", "LICENSES/"]);
  const id = "serena.ai-setup.serena";
  const items = [
    {
      id: "serena.mcp.serena",
      kind: "mcp",
      files: [discoveredFile("serena", fileOf(files, "server.json"))],
      dependencies: [id],
      startupSeconds: 60,
      callSeconds: 300,
    },
    {
      id,
      kind: "ai-setup",
      name: "serena",
      description:
        "Serena 2.1.0: semantic code retrieval and editing through language servers, served over MCP.",
      files: [],
      aiSetup: {
        version: "2.1.0",
        distributions: [SERENA_WHEEL],
        runtime: { python: ">=3.11,<3.15", closure: "uv-lock" },
        executable: "serena",
        // Serena's own built-in contexts, chosen per client; dashboards and the GUI log stay off.
        launch: {
          args: SERENA_ARGS("ide"),
          clis: {
            antigravity: SERENA_ARGS("antigravity"),
            "claude-code": SERENA_ARGS("claude-code"),
            codex: SERENA_ARGS("codex"),
            copilot: SERENA_ARGS("copilot-cli"),
          },
        },
        mcpItem: "serena.mcp.serena",
        settings: { commands: [], files: [] },
        doNotRun: [["serena", "setup"], ["serena-hooks"]],
        qualifications: accepted(id),
      },
    },
  ];
  return build("serena", "Serena", files, items);
}

async function build(framework, name, files, items) {
  const pin = PINS[framework];
  const built = await buildContent(
    { kind: "git", repository: pin.repository, commit: pin.commit },
    files,
    items,
    {
      framework: { id: framework, name },
    },
  );
  if (built.status !== "ok")
    fail(`buildContent ${framework}: ${JSON.stringify(built).slice(0, 4000)}`);
  const generated = built.generated.map((file) => ({
    sourceId: `${framework}-generated`,
    path: file.path,
    mode: file.executable ? "100755" : "100644",
    sha256: file.sha256,
    bytes: file.bytes,
  }));
  const checked = await checkContent(built.content, [...files, ...generated]);
  if (checked.status !== "ok")
    fail(`checkContent ${framework}: ${JSON.stringify(checked).slice(0, 2000)}`);
  return { framework, built, files };
}

// --- The trio, as a draft combination recipe (completed by naming a data commit) --------------

const TRIO = {
  schema: "urn:aihq:catalog:recipe:0.1.0",
  id: "code-intelligence-trio",
  kind: "combination",
  frameworks: ["cbm", "crg", "serena"],
  content: Object.fromEntries(
    ["cbm", "crg", "serena"].map((id) => [
      id,
      { repository: PINS[id].repository, commit: PINS[id].commit },
    ]),
  ),
  routes: {},
  members: [
    { item: "cbm.ai-setup.codebase-memory-mcp", preTicked: true },
    { item: "crg.ai-setup.code-review-graph", preTicked: true },
    { item: "serena.ai-setup.serena", preTicked: true },
  ],
  // Each tool keeps what it is best at: code-review-graph reviews changes, Serena works on
  // symbols, and codebase-memory-mcp keeps architecture and decision records.
  aiSetup: {
    "cbm.ai-setup.codebase-memory-mcp": {
      enabledTools: [
        "check_index_coverage",
        "get_architecture",
        "get_code_snippet",
        "get_graph_schema",
        "index_repository",
        "index_status",
        "list_projects",
        "manage_adr",
        "query_graph",
        "search_graph",
        "trace_path",
      ],
      disabledTools: [
        "compare_graphs",
        "delete_project",
        "detect_changes",
        "get_file_outline",
        "ingest_traces",
        "search_code",
      ],
    },
    "crg.ai-setup.code-review-graph": {
      enabledTools: [
        "build_or_update_graph_tool",
        "detect_changes_tool",
        "get_impact_radius_tool",
        "get_minimal_context_tool",
        "get_review_context_tool",
        "query_graph_tool",
      ],
    },
    "serena.ai-setup.serena": {
      enabledTools: [
        "activate_project",
        "find_declaration",
        "find_implementations",
        "find_referencing_symbols",
        "find_symbol",
        "get_diagnostics_for_file",
        "get_symbols_overview",
        "initial_instructions",
        "insert_after_symbol",
        "insert_before_symbol",
        "rename_symbol",
        "replace_symbol_body",
        "restart_language_server",
        "safe_delete_symbol",
      ],
    },
  },
};

// ---------------------------------------------------------------------------------------------

const work = mkdtempSync(join(tmpdir(), "aih-catalog-ai-setup-"));
try {
  const results = [await cbm(work), await crg(work), await serena(work)];
  for (const { framework, built } of results) {
    writeOrCompare(`data/${framework}/content.json`, built.bytes);
    for (const file of built.generated)
      writeOrCompare(`data/${framework}/generated/${file.path}`, file.bytes);
  }
  const folder = join(root, "data", "qualifications");
  const expected = new Set();
  for (const entry of QUALIFICATIONS) {
    const bytes = encoder.encode(canonical(entry));
    const read = readQualification(bytes);
    if (read.status !== "ok") fail(`qualification: ${JSON.stringify(read)}`);
    expected.add(`${read.sha256}.json`);
    writeOrCompare(`data/qualifications/${read.sha256}.json`, bytes);
  }
  if (existsSync(folder))
    for (const name of readdirSync(folder))
      if (!expected.has(name)) {
        if (check) out.drift.push(`data/qualifications/${name}`);
        else rmSync(join(folder, name));
      }
  const report = {
    pins: PINS,
    items: Object.fromEntries(
      results.map(({ framework, built }) => [
        framework,
        built.content.items.map((item) => item.id).sort(),
      ]),
    ),
    qualifications: QUALIFICATIONS.map((entry) => ({
      sha256: shaOf(entry),
      ...entry.subject,
      status: entry.result.status,
    })).sort((left, right) =>
      left.aiSetup === right.aiSetup
        ? left.cell < right.cell
          ? -1
          : 1
        : left.aiSetup < right.aiSetup
          ? -1
          : 1,
    ),
    recipes: [TRIO],
    combinationQualifications: [],
    notPorted: {
      "crg hooks/hooks.json":
        "the session-start and post-edit hooks run the tool on every session or edit; not ported as items (a hook is never pre-ticked and Claude keeps hooks in a shared list-valued settings file)",
      "crg code-review-graph-vscode/": "a VS Code extension, not an AI client item",
      "cbm graph-ui/, Claude marketplace file":
        "the graph UI is switched off (--ui=false); the marketplace file installs through the upstream installer",
      "serena contexts, modes and Docker image":
        "the plan starts Serena with its own built-in contexts per client; no Catalog context file is written",
    },
    notes: {
      "cbm.mcp.codebase-memory-mcp":
        "the upstream server.json at the v0.12.1 tag still names version 0.12.0 and its npm and PyPI wrappers; a managed plan starts the acquired 0.12.1 executable and never runs a wrapper",
    },
  };
  writeOrCompare("port-report/ai-setup.json", encoder.encode(canonical(report)));
  if (check) {
    if (out.drift.length > 0) fail(`drift in ${out.drift.join(", ")}`);
    console.log(`port-ai-setup: data and report match (${QUALIFICATIONS.length} qualifications)`);
  } else
    console.log(
      `port-ai-setup: wrote ${out.written.length} files (${QUALIFICATIONS.length} qualifications)`,
    );
} finally {
  rmSync(work, { recursive: true, force: true });
}
