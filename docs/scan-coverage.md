# Catalog Scan coverage

**630 of 1069 distinct Scan keys have a published report. 439 are pending.**

This snapshot covers 960 Catalog items and 1182 references across 14 families. It includes client editions, runtime bundles, and plugin folders. See the [sources and refresh instructions](#sources-and-refresh).

- **Published** means a listed public Scan release indexes a report for these exact paths, bytes and file modes. A report can describe findings or incomplete inspection. The installation decision stays with you or your organization.
- **Pending** means this snapshot found no indexed public report for that key.
- **No Scan key** identifies an AI setup whose platform-specific evidence is recorded in [Catalog qualifications](../README.md#data).

## Families

The totals count distinct keys. Items, editions and plugins can share a key, even across families. The overall row counts each shared key once.

| Family | Items | Distinct keys | Published | Pending | No key |
| --- | ---: | ---: | ---: | ---: | ---: |
| **All families** | 960 | 1069 | 630 | 439 | 3 |
| [anthropic](#anthropic) | 18 | 24 | 14 | 10 | 0 |
| [cbm](#cbm) | 2 | 1 | 1 | 0 | 1 |
| [crg](#crg) | 9 | 8 | 8 | 0 | 1 |
| [ecc](#ecc) | 698 | 775 | 517 | 258 | 0 |
| [egm](#egm) | 18 | 21 | 8 | 13 | 0 |
| [extensions](#extensions) | 66 | 67 | 37 | 30 | 0 |
| [gstack](#gstack) | 61 | 61 | 0 | 61 | 0 |
| [guide](#guide) | 2 | 4 | 4 | 0 | 0 |
| [modern-web-guidance](#modern-web-guidance) | 2 | 2 | 0 | 2 | 0 |
| [project-basics](#project-basics) | 3 | 3 | 3 | 0 | 0 |
| [pstack](#pstack) | 61 | 83 | 29 | 54 | 0 |
| [serena](#serena) | 2 | 1 | 1 | 0 | 1 |
| [superpowers](#superpowers) | 17 | 18 | 8 | 10 | 0 |
| [web-artifacts](#web-artifacts) | 1 | 1 | 0 | 1 | 0 |

## Look up an item or edition

Open your family below and search for an item ID, client edition (such as `@codex`), or Scan key. Follow a numbered link to a public release and find your key in its `index.json`. The entry gives the archive name and the summary's path in that archive. An item marked upstream-only is fetched at its upstream pin.

### anthropic

| Catalog reference | Kind | Scan key | Report availability |
| --- | --- | --- | --- |
| `anthropic.skill.academy-guide` | skill | `git-sha1:000a59a077cd8391e096ecdbde10c75fc73efead` | Published ([1][release-1], [2][release-2]) |
| `anthropic.skill.algorithmic-art` | skill | `git-sha1:086a9e136b108f1a3938a9efb533e81c0b681b02` | Published ([1][release-1]) |
| `anthropic.skill.brand-guidelines` | skill | `git-sha1:a2111dd8f4e19e140d57e0a18db959178adcbfd6` | Published ([1][release-1], [2][release-2]) |
| `anthropic.skill.canvas-design` | skill | `git-sha1:88f3b802f8f13606ed2d4ee73c8ce38c6bddc3f3` | Published ([1][release-1]) |
| `anthropic.skill.discernment-nudge` | skill | `git-sha1:46fd3fb3f29de5bab6bb56cbd36783255c2cc92f` | Published ([1][release-1], [2][release-2]) |
| `anthropic.skill.doc-coauthoring` · upstream-only | skill | `git-sha1:d9df960e61fe2bafe9183e37de6f9f6b73b74087` | Pending |
| `anthropic.skill.docx` | skill | `git-sha1:4f5ead96dfd8c1ac013e9329ba559de140bd3076` | Pending |
| `anthropic.skill.frontend-design` | skill | `git-sha1:28af03c1c2b14d1ebe9ae5e4358a18498cc83b8c` | Published ([1][release-1], [2][release-2]) |
| `anthropic.skill.internal-comms` | skill | `git-sha1:f0bff641eb05526cab58520f1326affa7dfa42a9` | Published ([1][release-1], [2][release-2]) |
| `anthropic.skill.mcp-builder` | skill | `git-sha1:5664bc861088a02aa8d85cfccdc0232d0f8a7b9e` | Pending |
| `anthropic.skill.pdf` | skill | `git-sha1:d4afd805e96aaca502cb6e8ea4d59f1a8461e195` | Pending |
| `anthropic.skill.pptx` | skill | `git-sha1:54478b9969a0f5a8eb5def07dcb81d8a1e972e9d` | Pending |
| `anthropic.skill.skill-creator` | skill | `git-sha1:2dbe4624b5232616cd7caca42c5da67cbc07d683` | Published ([1][release-1]) |
| `anthropic.skill.slack-gif-creator` | skill | `git-sha1:9f65f8718c944d16e3f44a704f01b9c6792b2035` | Published ([1][release-1]) |
| `anthropic.skill.theme-factory` | skill | `git-sha1:132a443faafbcc8bc98c835b2413deb0efb10dcd` | Published ([1][release-1], [2][release-2]) |
| `anthropic.skill.web-artifacts-builder` | skill | `git-sha1:ad1315fd446989986c6cbe097951e7a56451ec3a` | Published ([1][release-1], [2][release-2]) |
| `anthropic.skill.webapp-testing` | skill | `git-sha1:9bfca583d996c835ecf0b672f76ecea4cf9f36aa` | Published ([1][release-1], [2][release-2]) |
| `anthropic.skill.xlsx` | skill | `git-sha1:35a958321e37b1de7b23418b9018e2d3d1beade4` | Pending |
| `anthropic.plugin.academy-guide` | Plugin | `git-sha1:944b143a5eb57be1346df00b3d47a3cc87ec62c7` | Published ([1][release-1], [2][release-2]) |
| `anthropic.plugin.academy-guide:full-folder` | Full plugin folder | `git-sha1:d495c40fdd16cfe817a71aa05ecc1969ba98e925` | Pending |
| `anthropic.plugin.claude-api` | Plugin | `git-sha1:d166c5cbe5309b00f7242c92817b29fb557e41e3` | Pending |
| `anthropic.plugin.claude-api:full-folder` | Full plugin folder | `git-sha1:d495c40fdd16cfe817a71aa05ecc1969ba98e925` | Pending |
| `anthropic.plugin.discernment-nudge` | Plugin | `git-sha1:f2e94f4d5d5386fc6b8ab8c955257e7c74df0af9` | Published ([1][release-1], [2][release-2]) |
| `anthropic.plugin.discernment-nudge:full-folder` | Full plugin folder | `git-sha1:d495c40fdd16cfe817a71aa05ecc1969ba98e925` | Pending |
| `anthropic.plugin.document-skills` | Plugin | `git-sha1:177364894f2e869a4cb154f553e7b67eb9ee3d06` | Pending |
| `anthropic.plugin.document-skills:full-folder` | Full plugin folder | `git-sha1:d495c40fdd16cfe817a71aa05ecc1969ba98e925` | Pending |
| `anthropic.plugin.example-skills` | Plugin | `git-sha1:b6558596b06c5a9cd33f8d4a21669b228d869eb3` | Pending |
| `anthropic.plugin.example-skills:full-folder` | Full plugin folder | `git-sha1:d495c40fdd16cfe817a71aa05ecc1969ba98e925` | Pending |

### cbm

| Catalog reference | Kind | Scan key | Report availability |
| --- | --- | --- | --- |
| `cbm.ai-setup.codebase-memory-mcp` | ai-setup | — | No Scan key |
| `cbm.mcp.codebase-memory-mcp` | mcp | `git-sha1:3ac428156faa9fab79eaced65f9e468b97b660e1` | Published ([1][release-1], [2][release-2]) |

### crg

| Catalog reference | Kind | Scan key | Report availability |
| --- | --- | --- | --- |
| `crg.ai-setup.code-review-graph` | ai-setup | — | No Scan key |
| `crg.mcp.code-review-graph` | mcp | `git-sha1:ae7c646051997d2c05685741e1fe624d7cda0ded` | Published ([1][release-1], [2][release-2]) |
| `crg.skill.build-graph` | skill | `git-sha1:595569736f131c379b86d726b050a31bf028e6c3` | Published ([1][release-1], [2][release-2]) |
| `crg.skill.debug-issue` | skill | `git-sha1:d429602de54d8d59956ffd418398dbd1f036ee09` | Published ([1][release-1], [2][release-2]) |
| `crg.skill.explore-codebase` | skill | `git-sha1:268b416d26049d1326dce3859e730c7c6749a5d1` | Published ([1][release-1], [2][release-2]) |
| `crg.skill.refactor-safely` | skill | `git-sha1:b99050886c7b4ea73ba1c86b8d3a56c3f48385a9` | Published ([1][release-1], [2][release-2]) |
| `crg.skill.review-changes` | skill | `git-sha1:b3748b592585deb76192a0765f75e135f491dc9c` | Published ([1][release-1], [2][release-2]) |
| `crg.skill.review-delta` | skill | `git-sha1:298b694fe23a46f8ceb037f6eb0211ea39a1b21e` | Published ([1][release-1], [2][release-2]) |
| `crg.skill.review-pr` | skill | `git-sha1:b43690bcc1ef34c4d38a4575f3f9ac721e38f2d4` | Published ([1][release-1], [2][release-2]) |

### ecc

| Catalog reference | Kind | Scan key | Report availability |
| --- | --- | --- | --- |
| `ecc.agent.a11y-architect` | agent | `git-sha1:e647941431b1cac5895798d4e2dce11b16515fe9` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.agent-evaluator` | agent | `git-sha1:2a4d802d110da1f0e55a34463a208e082494414c` | Pending |
| `ecc.agent.architect` | agent | `git-sha1:a18b75650cca862ab903bffa96aed4cbed368565` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.architect@kiro` | Edition | `git-sha1:db01fcd12b312b2945c935e16cd8b635484aaf1a` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.bengali-reviewer` | agent | `git-sha1:52ec961cdf5140bdb04ef5f4b1b4c73f249a0567` | Pending |
| `ecc.agent.build-error-resolver` | agent | `git-sha1:54df7501baee053059a8195808520a32406b3a9b` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.build-error-resolver@kiro` | Edition | `git-sha1:fad71665491c801ef9e24ebc6c1e8da56051e80e` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.chief-of-staff` | agent | `git-sha1:9ac6b4209ab9ea624d8aaadbba08119564bfec52` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.chief-of-staff@kiro` | Edition | `git-sha1:e4ec0756da18b46aa5f5f70d15917cd3a4f3cc3e` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.code-architect` | agent | `git-sha1:cc04629232332670ea8d75f2a85ae449136ef6ae` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.code-explorer` | agent | `git-sha1:4001aab073b634a108879ed5e39e989b6cfbeb76` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.code-reviewer` | agent | `git-sha1:df7308c0d5f34afd12d3e807bcba06ceb86063a8` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.code-reviewer@kiro` | Edition | `git-sha1:bc2738697a357613cde113498715b2e6a01cc31c` | Published ([1][release-1]) |
| `ecc.agent.code-simplifier` | agent | `git-sha1:9008d2c30796ba9ccc8f20631537ff50a3e41475` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.comment-analyzer` | agent | `git-sha1:2e25d5d0919550b15563b870696183b64d0084d4` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.commit-reviewer` | agent | `git-sha1:9fac5db4f3098bfb84e4e33f5b2e85f453e8f698` | Pending |
| `ecc.agent.conversation-analyzer` | agent | `git-sha1:b89a034993531d0c497566ec564f0ff8b8033eed` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.cpp-build-resolver` | agent | `git-sha1:f8c2cee97e18190637f8968fc412103d8c458e79` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.cpp-build-resolver@kiro` | Edition | `git-sha1:16eac61594add9bc7f1ab5419a8c03cb0a7c693c` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.cpp-reviewer` | agent | `git-sha1:ff3af6abb3c1d3330649d4c66abdb9ab7c0636bb` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.cpp-reviewer@kiro` | Edition | `git-sha1:eb683479e017f7fe00ba3ebb9e83eb2a103137c1` | Published ([1][release-1]) |
| `ecc.agent.csharp-reviewer` | agent | `git-sha1:d0bb4d86617c7075fe5ee32f9cd287923230c819` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.dart-build-resolver` | agent | `git-sha1:bb6f6d00d46be43904dd66d26ae65f1f5ce48e14` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.database-reviewer` | agent | `git-sha1:ff9579cc1e866ee7f155e5bed39d492f77c8cca7` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.database-reviewer@kiro` | Edition | `git-sha1:13e312d63ec4fb2ffb47cb6c3bd758935bbe4fac` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.django-build-resolver` | agent | `git-sha1:3ad85bde26756e1f289d17439429c72b30bc05fb` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.django-reviewer` | agent | `git-sha1:86c8db4a4d049e4eb39f26baa17d207229893195` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.django-reviewer@kiro` | Edition | `git-sha1:f866c3a4e3d82ba21589d02e21dabf9397363e86` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.doc-updater` | agent | `git-sha1:9db7ff305e703d5fb7ef5fbd3c72d6f248bc14d2` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.doc-updater@kiro` | Edition | `git-sha1:b1032ad578857dacdfdaa4c65fc31d2e635b9d80` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.docs-lookup` | agent | `git-sha1:505629c2a5e00e9e497b120d6dfdcbf21640886c` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.e2e-runner` | agent | `git-sha1:a75dc9ecee9e92514877b5ea7e6f7fb5606ea08a` | Pending |
| `ecc.agent.e2e-runner@kiro` | Edition | `git-sha1:a38798999d6b2fde6d06d4697321ef8208f59aff` | Pending |
| `ecc.agent.fastapi-reviewer` | agent | `git-sha1:72292761502d69f46e7b1cd79b853abf752a35ff` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.flutter-reviewer` | agent | `git-sha1:2edcf83273d082ede68dcabc35a9101380a1dc97` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.fsharp-reviewer` | agent | `git-sha1:00659da5c8388a0ddd9b92001e5eaddd27af9e89` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.fsharp-reviewer@kiro` | Edition | `git-sha1:20511da36010fbe076f8014bae108baa7352a499` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.gan-evaluator` | agent | `git-sha1:c6ce97ed92f43c10924be2be39adb1d1d0a397a8` | Pending |
| `ecc.agent.gan-generator` | agent | `git-sha1:ba9924585cb7313281a1a645c1d668fd1466e5b3` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.gan-planner` | agent | `git-sha1:c7d3f0e6972e6847eb294f3b9c6fd0b97b127098` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.gdscript-reviewer` | agent | `git-sha1:d67428c7c7d61b2997f5597fa65ddd42110dbf2e` | Pending |
| `ecc.agent.go-build-resolver` | agent | `git-sha1:137fb3d15f7bd68cfe1d2e0b89d25a9a670007c1` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.go-build-resolver@kiro` | Edition | `git-sha1:01593bf32f488e70c1111bec40ccf8805af76b87` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.go-reviewer` | agent | `git-sha1:07bff6982205c3d107c3f87a26de642aef70c0dd` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.go-reviewer@kiro` | Edition | `git-sha1:4fe3824097676d457f3242162614c7d915cc2de0` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.harmonyos-app-resolver` | agent | `git-sha1:9418d8e4edaef02e7df5dde0317444a4903f2d80` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.harness-optimizer` | agent | `git-sha1:199e9c2e9f0ec29223e5effe9babd61391d3ad08` | Pending |
| `ecc.agent.harness-optimizer@kiro` | Edition | `git-sha1:6730e95d9c559340a0f8baf34159f4e8cd4db5a7` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.healthcare-reviewer` | agent | `git-sha1:ca8eea3d520954b9265031109266fdf6fbcdde46` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.homelab-architect` | agent | `git-sha1:7a54968e55f2e57cf26b3c0d2a2c828f78b3507f` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.java-build-resolver` | agent | `git-sha1:081c612d668de69a9b4ea40487da127e6bb9112d` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.java-build-resolver@kiro` | Edition | `git-sha1:430e48670347a05920c04f5d8d6f226d0e771658` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.java-reviewer` | agent | `git-sha1:2d2cfaead4f6a914c3bd037ff3c045787ef4a04e` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.java-reviewer@kiro` | Edition | `git-sha1:f2bfd35c256ec667f2d656ed299c10d0138e0e01` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.kotlin-build-resolver` | agent | `git-sha1:f9fc0651eae244fe1884e8b1fe21ddfd26e9a908` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.kotlin-build-resolver@kiro` | Edition | `git-sha1:d8ec4a934628772b6232a810bbbac15366625287` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.kotlin-reviewer` | agent | `git-sha1:350714a7a0381185b0fe6d28deeb618ec640e06f` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.kotlin-reviewer@kiro` | Edition | `git-sha1:1eaf8b34ecc56bfcc1a7df65b4d7efd830a7bb62` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.loop-operator` | agent | `git-sha1:5519c343700d6f036a835f3419d73991a4d55872` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.loop-operator@kiro` | Edition | `git-sha1:f4408d6c1cd9d00606c5b1cb4600c1f4511e2956` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.marketing-agent` | agent | `git-sha1:d9805d23804a39de29b987862849465a5cbe8292` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.mle-reviewer` | agent | `git-sha1:46f7e9a4dead2855b092f2480db6b18fa8ecba83` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.mle-reviewer@kiro` | Edition | `git-sha1:33b825c3017eada6f30b85eea57b228ab2b86867` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.network-architect` | agent | `git-sha1:8aab5c173bcd1a66caa81bc3575e0cf512a7bc9d` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.network-config-reviewer` | agent | `git-sha1:063658bcbc885026515359540b4f218f8e420c25` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.network-troubleshooter` | agent | `git-sha1:851f30137b489edc93114b3e249a67f6b38aab45` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.opensource-forker` | agent | `git-sha1:7709dbf60a5d9addf588c04174c9831c3b97e6a2` | Pending |
| `ecc.agent.opensource-packager` | agent | `git-sha1:2ea1f7c73a93bbefde03579ccf470032448e8a11` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.opensource-sanitizer` | agent | `git-sha1:5300fbc252f1df60169d5730efa702abcca19f6b` | Pending |
| `ecc.agent.performance-optimizer` | agent | `git-sha1:78439995eb6f37b4734086bd1a3c0d3bcd660779` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.performance-optimizer@kiro` | Edition | `git-sha1:00c972a0e23aa389afb3bcaadc03bc74af301be1` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.php-reviewer` | agent | `git-sha1:8b49fb2377d9e57dfaddf819a22d6b3bb1de7b34` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.planner` | agent | `git-sha1:6d0e6a840f91ffe200ebbcc36fb89febe90e8847` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.planner@kiro` | Edition | `git-sha1:ecc49efdec8f8e1cbc8dd1de612949c190a2d5f4` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.pr-test-analyzer` | agent | `git-sha1:9777a91ee7792776b6d2f014b8aaf9e6036e6bb5` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.python-reviewer` | agent | `git-sha1:5e2448c5d70d5c26795a55b2bbfde3972a3b202d` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.python-reviewer@kiro` | Edition | `git-sha1:7f2eb3287a6601e42e3690e29b76003d400c441a` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.pytorch-build-resolver` | agent | `git-sha1:02131454bd0991cf36fa51fa72de756973418e70` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.pytorch-build-resolver@kiro` | Edition | `git-sha1:cfc6f6d7acbdfc812abadad1aa2f0f70db9819d6` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.rag-pipeline-reviewer` | agent | `git-sha1:b0a5247f0d3399efe398e06818cc229fa496843a` | Pending |
| `ecc.agent.react-build-resolver` | agent | `git-sha1:2c48eabaefbad7b68d02394451e334fb1589d2df` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.react-build-resolver@kiro` | Edition | `git-sha1:573bdadb25291088d0bc7fa8b0ed3d6c7074fa94` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.react-reviewer` | agent | `git-sha1:b8d11bf73f0d1632dec52d88a70619f08793f5f1` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.react-reviewer@kiro` | Edition | `git-sha1:8fe9c7186ceea17376682d66b1435e884b401280` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.refactor-cleaner` | agent | `git-sha1:8f61fb8eaf2973f1e8bef20de0bcd612ab2cb89b` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.refactor-cleaner@kiro` | Edition | `git-sha1:41a1795ab8c4252054fbb6101bb4fa169990beb2` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.ruby-reviewer` | agent | `git-sha1:4ba19fa2860f2ee2a5d00c882aedfbd9ab6e8866` | Pending |
| `ecc.agent.rust-build-resolver` | agent | `git-sha1:690b30bffac9b6baa6308a3eaebf5b05635dfa43` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.rust-build-resolver@kiro` | Edition | `git-sha1:8780f407ecdc203327cec23789602bab1ee1e9ae` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.rust-reviewer` | agent | `git-sha1:26b62d5ef66e3fdf86671a797470facfdc650aea` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.rust-reviewer@kiro` | Edition | `git-sha1:18d11b3375369ef9a48b14118943d491fecab2d9` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.security-reviewer` | agent | `git-sha1:51cca8db1af39f0179b1a369b304cf0326aaccef` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.security-reviewer@kiro` | Edition | `git-sha1:841ade746f38f5df0b20210b6672f0db29f3a486` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.seo-specialist` | agent | `git-sha1:f689b53f7879e92dee192b6f57ad06bf523d3a29` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.silent-failure-hunter` | agent | `git-sha1:548e318af04072fbba6a2d354f01ea8540dc5a3f` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.spec-miner` | agent | `git-sha1:427a2db40296d941e7331b65e355699873c065b0` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.swift-build-resolver` | agent | `git-sha1:ba40eb3717713d6ba8fb9d7bbf27bbbe3b10bfa9` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.swift-reviewer` | agent | `git-sha1:9430b9e3a32aefdefc5596b5d7a14a40e12c89f7` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.swift-reviewer@kiro` | Edition | `git-sha1:957cb31bee5962858b4c9a75aeaaa5ae08fced79` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.tdd-guide` | agent | `git-sha1:df44f88ea1169818280c8837ffc9d3012383ab5a` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.tdd-guide@kiro` | Edition | `git-sha1:3d91ed5f0463e9f9124bbb971e86a064cb823ec4` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.type-design-analyzer` | agent | `git-sha1:10cf30661ea7e6a4182e3c5a167eb2ff1a5d18cc` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.typescript-reviewer` | agent | `git-sha1:a2d060a3beb36fa38f498b19aa951de3d9b7374c` | Pending |
| `ecc.agent.typescript-reviewer@kiro` | Edition | `git-sha1:408faa19215cd29a92cef48f40557ff4e50571c7` | Published ([1][release-1], [2][release-2]) |
| `ecc.agent.vue-reviewer` | agent | `git-sha1:689ef37ffc955de4b29bd9fca956c76bb6ba71e5` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.auto-format` | hook | `git-sha1:e04b0ff0fe88e9b122c2c2ed9598973e64aaa816` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.auto-format@kiro` | Edition | `git-sha1:e04b0ff0fe88e9b122c2c2ed9598973e64aaa816` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.code-review-on-write` | hook | `git-sha1:f01fd8a780bde13f4e5c2887a6bb88c43e3e9d25` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.code-review-on-write@kiro` | Edition | `git-sha1:f01fd8a780bde13f4e5c2887a6bb88c43e3e9d25` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.console-log-check` | hook | `git-sha1:38550ac570f840ee2d5ac257727fc30bfef1b7c9` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.console-log-check@kiro` | Edition | `git-sha1:38550ac570f840ee2d5ac257727fc30bfef1b7c9` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.doc-file-warning` | hook | `git-sha1:d57a7a2fa50aac88ce0757e192731af30dd17beb` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.doc-file-warning@kiro` | Edition | `git-sha1:d57a7a2fa50aac88ce0757e192731af30dd17beb` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.extract-patterns` | hook | `git-sha1:bb7507032f451910dea5d272d3db8689f8d39b26` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.extract-patterns@kiro` | Edition | `git-sha1:bb7507032f451910dea5d272d3db8689f8d39b26` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.git-push-review` | hook | `git-sha1:8a86ec6e797c7c2e87604d2ce7ffc77bc1cc7077` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.git-push-review@kiro` | Edition | `git-sha1:8a86ec6e797c7c2e87604d2ce7ffc77bc1cc7077` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.post-dispatcher-async` | hook | `git-sha1:b055bf03503d241fbab88949a5af61ec55ac87aa` | Pending |
| `ecc.hook.post-dispatcher-async@claude-code` | Edition | `git-sha1:b055bf03503d241fbab88949a5af61ec55ac87aa` | Pending |
| `ecc.hook.post-dispatcher-sync` | hook | `git-sha1:8901d06944fbf68a9906621f2668b94e7189a464` | Pending |
| `ecc.hook.post-dispatcher-sync@claude-code` | Edition | `git-sha1:8901d06944fbf68a9906621f2668b94e7189a464` | Pending |
| `ecc.hook.post-mcp-health-check` | hook | `git-sha1:bf20dd65b95ed66b2f3d391bdd8edd7662474ea3` | Pending |
| `ecc.hook.post-mcp-health-check@claude-code` | Edition | `git-sha1:bf20dd65b95ed66b2f3d391bdd8edd7662474ea3` | Pending |
| `ecc.hook.post-skill-track` | hook | `git-sha1:f1431c58b45283fb0ced635ead8d0c5ca663394f` | Pending |
| `ecc.hook.post-skill-track@claude-code` | Edition | `git-sha1:f1431c58b45283fb0ced635ead8d0c5ca663394f` | Pending |
| `ecc.hook.pre-bash-dispatcher` | hook | `git-sha1:b4700486c5fae8c6d2e63402dfc0dcf673d3994d` | Pending |
| `ecc.hook.pre-bash-dispatcher@claude-code` | Edition | `git-sha1:b4700486c5fae8c6d2e63402dfc0dcf673d3994d` | Pending |
| `ecc.hook.pre-compact` | hook | `git-sha1:0739f9f549c6c1dc153aeb9ed36b09292cfdce07` | Pending |
| `ecc.hook.pre-compact@claude-code` | Edition | `git-sha1:0739f9f549c6c1dc153aeb9ed36b09292cfdce07` | Pending |
| `ecc.hook.pre-config-protection` | hook | `git-sha1:350c8c515a9ad8cc066644cb7ef6cbe9a8f69ff2` | Pending |
| `ecc.hook.pre-config-protection@claude-code` | Edition | `git-sha1:350c8c515a9ad8cc066644cb7ef6cbe9a8f69ff2` | Pending |
| `ecc.hook.pre-edit-write-gateguard-fact-force` | hook | `git-sha1:8ccf192fc68826d75a4e0f84be1e9eac13c0efa1` | Pending |
| `ecc.hook.pre-edit-write-gateguard-fact-force@claude-code` | Edition | `git-sha1:8ccf192fc68826d75a4e0f84be1e9eac13c0efa1` | Pending |
| `ecc.hook.pre-edit-write-suggest-compact` | hook | `git-sha1:ba10df8f56db92bb72a0b46f1fbd75b5d9201b2b` | Pending |
| `ecc.hook.pre-edit-write-suggest-compact@claude-code` | Edition | `git-sha1:ba10df8f56db92bb72a0b46f1fbd75b5d9201b2b` | Pending |
| `ecc.hook.pre-governance-capture` | hook | `git-sha1:d114135d7b15ecf4ad336f225651944a0f515259` | Pending |
| `ecc.hook.pre-governance-capture@claude-code` | Edition | `git-sha1:d114135d7b15ecf4ad336f225651944a0f515259` | Pending |
| `ecc.hook.pre-hookify-runtime` | hook | `git-sha1:d8c647797addf63a3efc04f692455095d194e460` | Pending |
| `ecc.hook.pre-hookify-runtime@claude-code` | Edition | `git-sha1:d8c647797addf63a3efc04f692455095d194e460` | Pending |
| `ecc.hook.pre-mcp-health-check` | hook | `git-sha1:713b8eef58dd8b4219351a109f454dab569c41e2` | Pending |
| `ecc.hook.pre-mcp-health-check@claude-code` | Edition | `git-sha1:713b8eef58dd8b4219351a109f454dab569c41e2` | Pending |
| `ecc.hook.pre-observe-continuous-learning` | hook | `git-sha1:1edd5a6db5c65ac53020e345e34ad0ee5ec6d6fb` | Pending |
| `ecc.hook.pre-observe-continuous-learning@claude-code` | Edition | `git-sha1:1edd5a6db5c65ac53020e345e34ad0ee5ec6d6fb` | Pending |
| `ecc.hook.pre-powershell-gateguard-fact-force` | hook | `git-sha1:4e4ed50f94b1079103bcba9dea77d4f1f4338922` | Pending |
| `ecc.hook.pre-powershell-gateguard-fact-force@claude-code` | Edition | `git-sha1:4e4ed50f94b1079103bcba9dea77d4f1f4338922` | Pending |
| `ecc.hook.pre-write-doc-file-warning` | hook | `git-sha1:a2f0599b1942cfd3a734f4681ca80fc85f58e6dd` | Pending |
| `ecc.hook.pre-write-doc-file-warning@claude-code` | Edition | `git-sha1:a2f0599b1942cfd3a734f4681ca80fc85f58e6dd` | Pending |
| `ecc.hook.prompt-hookify-runtime` | hook | `git-sha1:e1383ad8726e48c1e6b4cc4459392dc40db56400` | Pending |
| `ecc.hook.prompt-hookify-runtime@claude-code` | Edition | `git-sha1:e1383ad8726e48c1e6b4cc4459392dc40db56400` | Pending |
| `ecc.hook.python-lint-on-edit` | hook | `git-sha1:bc3daf689c7dc6789e8edfbc7177b6983a68453a` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.python-lint-on-edit@kiro` | Edition | `git-sha1:bc3daf689c7dc6789e8edfbc7177b6983a68453a` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.quality-gate` | hook | `git-sha1:4b2cd86f440b55191bf649425c1bc4e1008e5bbf` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.quality-gate@kiro` | Edition | `git-sha1:4b2cd86f440b55191bf649425c1bc4e1008e5bbf` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.rust-check-on-edit` | hook | `git-sha1:6d44db0e99b47c45938502c3518147d9fafe4186` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.rust-check-on-edit@kiro` | Edition | `git-sha1:6d44db0e99b47c45938502c3518147d9fafe4186` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.security-check-on-create` | hook | `git-sha1:4b2cb1f2b43d4da5b7133f147576196a04d41aa3` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.security-check-on-create@kiro` | Edition | `git-sha1:4b2cb1f2b43d4da5b7133f147576196a04d41aa3` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.session-end-marker` | hook | `git-sha1:c7e25f23239b46ae3b8460827251102950ccd375` | Pending |
| `ecc.hook.session-end-marker@claude-code` | Edition | `git-sha1:c7e25f23239b46ae3b8460827251102950ccd375` | Pending |
| `ecc.hook.session-start` | hook | `git-sha1:882bcfd63967925a484f95183353f2ee0454ec44` | Pending |
| `ecc.hook.session-start@claude-code` | Edition | `git-sha1:882bcfd63967925a484f95183353f2ee0454ec44` | Pending |
| `ecc.hook.session-start@codex` | Edition | `git-sha1:5d9ea5bfa8e91f022c7ca0f6f85bff50163ff8dc` | Pending |
| `ecc.hook.session-start-plan-canvas-sessions` | hook | `git-sha1:bfd13ff89c562e45146b1d5be9442bb02aa4cd5d` | Pending |
| `ecc.hook.session-start-plan-canvas-sessions@claude-code` | Edition | `git-sha1:bfd13ff89c562e45146b1d5be9442bb02aa4cd5d` | Pending |
| `ecc.hook.session-summary` | hook | `git-sha1:44beffffbc0bfb8135d2a5b15e61d2838caaac47` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.session-summary@kiro` | Edition | `git-sha1:44beffffbc0bfb8135d2a5b15e61d2838caaac47` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.stop-check-console-log` | hook | `git-sha1:c6cb7cc3abbe70d9e2d0f20c393bb45423d0f6a5` | Pending |
| `ecc.hook.stop-check-console-log@claude-code` | Edition | `git-sha1:c6cb7cc3abbe70d9e2d0f20c393bb45423d0f6a5` | Pending |
| `ecc.hook.stop-cost-tracker` | hook | `git-sha1:b8c49a0e9659516355c3f2a2c29b5c9883bc3178` | Pending |
| `ecc.hook.stop-cost-tracker@claude-code` | Edition | `git-sha1:b8c49a0e9659516355c3f2a2c29b5c9883bc3178` | Pending |
| `ecc.hook.stop-desktop-notify` | hook | `git-sha1:ad465ec8f26cfb7646b11b48cf323bd7758d623c` | Pending |
| `ecc.hook.stop-desktop-notify@claude-code` | Edition | `git-sha1:ad465ec8f26cfb7646b11b48cf323bd7758d623c` | Pending |
| `ecc.hook.stop-evaluate-session` | hook | `git-sha1:b67438467cc0b2c3698c41d440dac1deb985907c` | Pending |
| `ecc.hook.stop-evaluate-session@claude-code` | Edition | `git-sha1:b67438467cc0b2c3698c41d440dac1deb985907c` | Pending |
| `ecc.hook.stop-format-typecheck` | hook | `git-sha1:b126f7c2e0e26f5e768e5d47be6dce6baae053bc` | Pending |
| `ecc.hook.stop-format-typecheck@claude-code` | Edition | `git-sha1:b126f7c2e0e26f5e768e5d47be6dce6baae053bc` | Pending |
| `ecc.hook.stop-hookify-runtime` | hook | `git-sha1:90053ef90e88fccaf858fc49fb5d9e928db022b9` | Pending |
| `ecc.hook.stop-hookify-runtime@claude-code` | Edition | `git-sha1:90053ef90e88fccaf858fc49fb5d9e928db022b9` | Pending |
| `ecc.hook.stop-plan-canvas-pending` | hook | `git-sha1:59fa8bb86e91f0e549d504cfb3c86d3a9338b0f6` | Pending |
| `ecc.hook.stop-plan-canvas-pending@claude-code` | Edition | `git-sha1:59fa8bb86e91f0e549d504cfb3c86d3a9338b0f6` | Pending |
| `ecc.hook.stop-session-end` | hook | `git-sha1:5211e493c149178995b2d5d4264bdc1258da7818` | Pending |
| `ecc.hook.stop-session-end@claude-code` | Edition | `git-sha1:5211e493c149178995b2d5d4264bdc1258da7818` | Pending |
| `ecc.hook.tdd-reminder` | hook | `git-sha1:8550ea85c53eeab9c241421997379fec7073fbd9` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.tdd-reminder@kiro` | Edition | `git-sha1:8550ea85c53eeab9c241421997379fec7073fbd9` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.typecheck-on-edit` | hook | `git-sha1:9bba5f6d00c5d1ed3d62237d3bb4ed8ecdd26413` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.typecheck-on-edit@kiro` | Edition | `git-sha1:9bba5f6d00c5d1ed3d62237d3bb4ed8ecdd26413` | Published ([1][release-1], [2][release-2]) |
| `ecc.hook.user-prompt-context-gate` | hook | `git-sha1:8346671f2538d6abf02f2c1bc9befe465a4d8cc8` | Pending |
| `ecc.hook.user-prompt-context-gate@claude-code` | Edition | `git-sha1:8346671f2538d6abf02f2c1bc9befe465a4d8cc8` | Pending |
| `ecc.mcp.arcmira` | mcp | `git-sha1:6662c9c2f56bde1327b390ae90ba3f054af7bdf9` | Pending |
| `ecc.mcp.browser-use` | mcp | `git-sha1:dd1777b6ade38ed2f4dfd74f58aec6e3c46dc410` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.clickhouse` | mcp | `git-sha1:f4c66793754d1cb90591357b17e52d5f30a6d641` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.cloudflare-docs` | mcp | `git-sha1:b1d43b99296ab1215411a7c2c5eb4e3d34424bf1` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.cloudflare-observability` | mcp | `git-sha1:36b1ab6bcb43a7f0799f94cd70ce98e3da485b9a` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.cloudflare-workers-bindings` | mcp | `git-sha1:38dde3f2fc72b8fc87caf83313a243e3dbe6b581` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.cloudflare-workers-builds` | mcp | `git-sha1:7407b71d8e3501847937d2c6248326314a799694` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.codescene` | mcp | `git-sha1:dda44ff3ff0bb0b44b1441bdde67fead427bb7f8` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.confluence` | mcp | `git-sha1:1c81fef4761da532ec21c10fb6be30074bbbb479` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.context7` | mcp | `git-sha1:d977050a7c1554ac62dda68daf09ad8583a83344` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.deja-vu` | mcp | `git-sha1:fa74d783d961868336cb9681053fab09138644a7` | Pending |
| `ecc.mcp.devfleet` | mcp | `git-sha1:06223c274c355f357ce2c49b5d3d6e1e5d4396f6` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.exa-web-search` | mcp | `git-sha1:224b3be2f8d8c627c486c7d39d8768843dd279f2` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.fal-ai` | mcp | `git-sha1:23168427536d01571f72553a6bba81823bd26306` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.filesystem` | mcp | `git-sha1:c507d4fae61b02f2f37287bfe7fce8dc5fb5ecd9` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.firecrawl` | mcp | `git-sha1:5b5c1d02c4148d46aecf3fe36b823f117d6eb4a8` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.jira` | mcp | `git-sha1:aba1f2b7ace3393a1c764a1d163fb3778d5734f0` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.laraplugins` | mcp | `git-sha1:e639989bfe2a3489f8cdafdf3825a205c67abd47` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.magic` | mcp | `git-sha1:1be5efc70837bac079a0f0b7285a29a752420f55` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.memory` | mcp | `git-sha1:41cc7561bd89fbc32433708ac3b8d810f75223bb` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.memxus` | mcp | `git-sha1:9eff9c6fa5c15ae74affc7378ea8aef7519e443e` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.mnemosyne-os` | mcp | `git-sha1:e7131be0f71f454fa0d4d8afabebf633dea7503a` | Pending |
| `ecc.mcp.omega-memory` | mcp | `git-sha1:16ace1a725795ca587434fd5e555b3b38202e007` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.parallel-search` | mcp | `git-sha1:e591e885aaf929d3ccb3497230f75b068716811e` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.playwright` | mcp | `git-sha1:6497637601f6eea77180299ea034b1550f6fcc55` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.sequential-thinking` | mcp | `git-sha1:1035146fff81b47329f1550585e26b70f2c0cde8` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.supabase` | mcp | `git-sha1:8461596178782b687bffac1b8c833842b962a35e` | Published ([1][release-1], [2][release-2]) |
| `ecc.mcp.vercel` | mcp | `git-sha1:1dc5e7b3ddeda5e2ca3fc4166f0937004c6912d0` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.angular.coding-style` | rule | `git-sha1:91a0d5ae4bb3df1f96b02f1ebb17f94697fdf72f` | Published ([1][release-1]) |
| `ecc.rule.angular.hooks` | rule | `git-sha1:d06099b8f4579ee1d36885b1389a9cbb0adebaf9` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.angular.patterns` | rule | `git-sha1:6f297cafefc4248f1aec272a73cba32615834364` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.angular.security` | rule | `git-sha1:40e6cd3a99c90c8846e2aedec17232f58fbe0a80` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.angular.testing` | rule | `git-sha1:11e1d72691ddbf0d76106c749180990abd2f7787` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.arkts.coding-style` | rule | `git-sha1:0e281ca0e91acb6577147bdefa946d8383fc59e7` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.arkts.hooks` | rule | `git-sha1:1efa45e4b45acf86a8bacdcb7567b367cd0f1a1d` | Published ([1][release-1]) |
| `ecc.rule.arkts.patterns` | rule | `git-sha1:22df3cd88c87ea127007ba28ba4366dd430b0e4c` | Published ([1][release-1]) |
| `ecc.rule.arkts.security` | rule | `git-sha1:67513c52aeded37d1dfabe67997d64df03bf8acd` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.arkts.testing` | rule | `git-sha1:4b9175c20fc11309af965ad3e3ff4f52809f4bde` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.common.agents` | rule | `git-sha1:8d1a96c15b23820d53cfd84eb80246d963a026e5` | Pending |
| `ecc.rule.common.code-review` | rule | `git-sha1:56653b8c2b0a452aa47a5021e2a3c0c57b1d66f2` | Pending |
| `ecc.rule.common.coding-style` | rule | `git-sha1:a7ad566b0d89adbc72363ba09c6213ce66356560` | Pending |
| `ecc.rule.common.development-workflow` | rule | `git-sha1:838c312f8ae185bdd451da12e0e26effae6021b5` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.common.git-workflow` | rule | `git-sha1:18c05b6a1d6ae10102f4ead9bce5ec0054666dd6` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.common.hooks` | rule | `git-sha1:b710a9421bd9b74594723ae7c2476e0eb25b695b` | Pending |
| `ecc.rule.common.patterns` | rule | `git-sha1:e15d7bb685f365a21e0278192c273323afab6442` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.common.performance` | rule | `git-sha1:730b0a42fbfd01bd1ea2f016092652f080e81bda` | Pending |
| `ecc.rule.common.security` | rule | `git-sha1:9a100354c87d48c9e8424c7e43ec78e005629067` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.common.testing` | rule | `git-sha1:63fbd2792eea25bad3d339459a030936b1240096` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.cpp.coding-style` | rule | `git-sha1:43cf1665fc2814cd45fa52a6840b60485e8795b3` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.cpp.hooks` | rule | `git-sha1:cc05117ee9ef9015ff07d6455b118a1e784582e8` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.cpp.patterns` | rule | `git-sha1:3a7f723097096be4672e80922203a884757a7ff9` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.cpp.security` | rule | `git-sha1:6cc1a233441d1c8fb00791bfdd63f9c6a320898f` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.cpp.testing` | rule | `git-sha1:44e560b77c498e97ca5ed282eeb7e26dd80d6989` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.csharp.coding-style` | rule | `git-sha1:2fd0f71d927805f608a219be731d20c66c439658` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.csharp.hooks` | rule | `git-sha1:6f3329472451fcbcdd0c572ba4433d0aeb1c5bcf` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.csharp.patterns` | rule | `git-sha1:48905bbb20ae3e34bd32cd0a65d12ae0bc37a1ad` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.csharp.security` | rule | `git-sha1:a3a9b9ad181187a3002a573c1529b04926e1cd06` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.csharp.testing` | rule | `git-sha1:43ee4f748491fd85ea811961b17b24b502611c10` | Pending |
| `ecc.rule.dart.coding-style` | rule | `git-sha1:fdc013d503df4408bb241f13ff3c713ac0225e3d` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.dart.hooks` | rule | `git-sha1:203fd60d18303e83b146606cc0dd163f762513c7` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.dart.patterns` | rule | `git-sha1:b0ee14c28c2bb2d698e9eaf7437903d7399975bc` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.dart.security` | rule | `git-sha1:b31aa1b02c9d7dbac32bfdfe7f68cb3a3d233acd` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.dart.testing` | rule | `git-sha1:423a8010702cb8aa210fc2d446e9cdba1ec5c4bc` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.fsharp.coding-style` | rule | `git-sha1:b0e0a4523a2bb21c965638acffa638c8a82bfd1e` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.fsharp.hooks` | rule | `git-sha1:4f82dcf0bf80e56dbf658ccf0450dbd203f9794c` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.fsharp.patterns` | rule | `git-sha1:0e8ac7e59ff251f6097ebe2174d5bd951d217d7c` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.fsharp.security` | rule | `git-sha1:1e0dbbef40e1f2f569db279b49061b42450ec594` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.fsharp.testing` | rule | `git-sha1:99658132eeaf2fcfb834a6f5ef9af55ec48de2dc` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.golang.coding-style` | rule | `git-sha1:e8b503c4578a3aecec7397f37127faa5ac22bbc1` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.golang.hooks` | rule | `git-sha1:ee6188d5159a598e8445532facd8f21597900b31` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.golang.patterns` | rule | `git-sha1:677e1b50fc62d9ae2837cb901d90d9872efbed6d` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.golang.security` | rule | `git-sha1:b568f9fa2cfd1df2c3dce944eae7a0fbfe35b700` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.golang.testing` | rule | `git-sha1:ea834f9789edcbbdab3b25c6456a3898f0c4db16` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.java.coding-style` | rule | `git-sha1:0639533040f60ab0cce46fc18394eeaaf563447b` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.java.hooks` | rule | `git-sha1:894cfac4c5468ab5d6884d407ea837fe56701e10` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.java.patterns` | rule | `git-sha1:14963632911c491db290f8938cf821a1943dcd12` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.java.security` | rule | `git-sha1:8a71414e31d26eaeddcdcae2ba741dc2bb238f16` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.java.testing` | rule | `git-sha1:cfbcddff135118416779636c7393f65035001374` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.kotlin.coding-style` | rule | `git-sha1:df162a600eba692809a9d4b9cea8312a19b8658e` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.kotlin.hooks` | rule | `git-sha1:bf4912044ac5ea2d800ff36b63120bbdca953732` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.kotlin.patterns` | rule | `git-sha1:1d5d575891dd27e4733c7c3146b629c070dfd08c` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.kotlin.security` | rule | `git-sha1:a8c2c5e1df72faaee15fe3293cc4f0060acee6a2` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.kotlin.testing` | rule | `git-sha1:c2b94a17bfadd138fb29e348959335d2166b5d47` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.nuxt.coding-style` | rule | `git-sha1:4830479374b650cd0c80223c0f2643d5a413e11d` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.nuxt.hooks` | rule | `git-sha1:8e549c351e7f34a8bb67376b2ddbad1e6c3fed3c` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.nuxt.patterns` | rule | `git-sha1:609769daaad28fa607783f914964a2c3b3b72f63` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.nuxt.security` | rule | `git-sha1:86b0f7af14038644a69ceee534606d8d7aba5011` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.nuxt.testing` | rule | `git-sha1:dc5e38f7ff6c21a5efb8aed3887a95c452c11aa3` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.perl.coding-style` | rule | `git-sha1:d405f384e4a230d90fb328366081b0f886490c5e` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.perl.hooks` | rule | `git-sha1:6ff85244ca3d1079e394dd55a0e00f9e6f224a18` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.perl.patterns` | rule | `git-sha1:5ce2604cfc7e91865a9b5cefbc991cb4ce6efef2` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.perl.security` | rule | `git-sha1:4b248c27f46d06464754de2ba9d2e1e2746fef89` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.perl.testing` | rule | `git-sha1:7f3306d4bf0885e328211ea5a92e8da2c825814a` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.php.coding-style` | rule | `git-sha1:38004003e539f8ed149093906c1e497479505c50` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.php.hooks` | rule | `git-sha1:1a92584a6126d77427b82060b0503faebbf04161` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.php.patterns` | rule | `git-sha1:e0da1b2c614291c1d8547f8be2ad3b5734458d93` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.php.security` | rule | `git-sha1:d1e3d8a77fca3ee5cc690f568c05a4565011d756` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.php.testing` | rule | `git-sha1:3cb22d8c7fec2ae6798b22c775cc27dc5aeb9f44` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.python.coding-style` | rule | `git-sha1:24fbb995b0c106ab50551980c62ad33e47a33854` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.python.fastapi` | rule | `git-sha1:973ba4046749b735c1477d5d1f0bcf9375e68f23` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.python.hooks` | rule | `git-sha1:9511b41806c6df6f90094234b8ffd4df973e8da3` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.python.patterns` | rule | `git-sha1:72e3f4c36856d522ea43e0884a06e339479bc48c` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.python.security` | rule | `git-sha1:e1fdd182b3b4efa3ebe723b354eab6a944c68419` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.python.testing` | rule | `git-sha1:0391991499c5c8775a14654e207fd1131970177f` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.react-native.accessibility` | rule | `git-sha1:684696470039017a6579e4101833d57fce9327e2` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.react-native.coding-style` | rule | `git-sha1:e08402dcd4056d9da7d50835f495010a98c1e105` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.react-native.hooks` | rule | `git-sha1:432bc8425a9078f66a403c6f9e3732d1fee0ee12` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.react-native.patterns` | rule | `git-sha1:82063bf1b5d8d327e6fd20c96df9ac1ac011c701` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.react-native.performance` | rule | `git-sha1:e51c9514d2d5700c01e960abc8819ba892132388` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.react-native.production-readiness` | rule | `git-sha1:b805db0fae710a4aa83b7c72fd425b03da691883` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.react-native.security` | rule | `git-sha1:b0d9b01eb5ee0fc601c89ef1f868e7af7cd9997a` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.react-native.testing` | rule | `git-sha1:8e11d1610045f8b1081c4d7ca24f3f5c8de09ccb` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.react.coding-style` | rule | `git-sha1:98f421219fd2f2fa966e1a847dc7db3345bef1b2` | Published ([1][release-1]) |
| `ecc.rule.react.hooks` | rule | `git-sha1:20c20434a6be68bb805e555a2ba3a1efffc68882` | Published ([1][release-1]) |
| `ecc.rule.react.patterns` | rule | `git-sha1:3dd6ec1ecef77c7353c1fa2b0a77e0e5f8b9849d` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.react.security` | rule | `git-sha1:c50db5abc11fc68d9efef3de4b8340aa7a67f8e2` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.react.testing` | rule | `git-sha1:324b26d1bb02835661de0a9640d4c3c1fd81b3da` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.ruby.coding-style` | rule | `git-sha1:2494af831aee9306eda73820025d92ca16f2d625` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.ruby.hooks` | rule | `git-sha1:335f12b3030f688866db500a36af99fad041f6a2` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.ruby.patterns` | rule | `git-sha1:3a121b46b6fd95d8e18ccca750c50107fa9efd67` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.ruby.security` | rule | `git-sha1:6039b0208f77d3f59dea997045fac330a0f96244` | Pending |
| `ecc.rule.ruby.testing` | rule | `git-sha1:8bec84d66574eb115a8577ba0103b0dc54f61549` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.rust.coding-style` | rule | `git-sha1:8bbecd68c27ef4e2d8d18d917bb425789c5ce8d9` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.rust.hooks` | rule | `git-sha1:97c972f44452d6107dab7f9179a0ca048a606657` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.rust.patterns` | rule | `git-sha1:14d5bd531ac4c0635f135a7b8220bb4a2632c6d4` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.rust.security` | rule | `git-sha1:4dc7bab029d0ad3791ff922fdb5fd0b971a67f1c` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.rust.testing` | rule | `git-sha1:85404854f5a3fb1a6a5e3694b3659045940ed124` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.coding-style` | rule | `git-sha1:dc90dd74781598bc3d325cfc0df4989046a73ca4` | Pending |
| `ecc.rule.steering.coding-style@kiro` | Edition | `git-sha1:dc90dd74781598bc3d325cfc0df4989046a73ca4` | Pending |
| `ecc.rule.steering.cpp-patterns` | rule | `git-sha1:cb0981afaf1538c90c0610c5e6993e97e23aee9e` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.cpp-patterns@kiro` | Edition | `git-sha1:cb0981afaf1538c90c0610c5e6993e97e23aee9e` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.dev-mode` | rule | `git-sha1:5749bef4203fff97288ad4aad5674249e249825e` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.dev-mode@kiro` | Edition | `git-sha1:5749bef4203fff97288ad4aad5674249e249825e` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.development-workflow` | rule | `git-sha1:e59a22c6efa623deadd0d28e51637df798be1316` | Pending |
| `ecc.rule.steering.development-workflow@kiro` | Edition | `git-sha1:e59a22c6efa623deadd0d28e51637df798be1316` | Pending |
| `ecc.rule.steering.git-workflow` | rule | `git-sha1:64f2464bbaafa770daceced0d1e91f61c43bb7c8` | Pending |
| `ecc.rule.steering.git-workflow@kiro` | Edition | `git-sha1:64f2464bbaafa770daceced0d1e91f61c43bb7c8` | Pending |
| `ecc.rule.steering.golang-patterns` | rule | `git-sha1:8ba682e51e466b8c655c78bb2b0c010159d9d09f` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.golang-patterns@kiro` | Edition | `git-sha1:8ba682e51e466b8c655c78bb2b0c010159d9d09f` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.java-patterns` | rule | `git-sha1:d68da88aebe588d6bd9a59408032ccce89e8cfac` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.java-patterns@kiro` | Edition | `git-sha1:d68da88aebe588d6bd9a59408032ccce89e8cfac` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.kotlin-patterns` | rule | `git-sha1:eec763025272ae9c0d03629ea847f57f16699c90` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.kotlin-patterns@kiro` | Edition | `git-sha1:eec763025272ae9c0d03629ea847f57f16699c90` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.lessons-learned` | rule | `git-sha1:904b18f4b61b5c2f37973db0f3e269ad9df04e42` | Pending |
| `ecc.rule.steering.lessons-learned@kiro` | Edition | `git-sha1:904b18f4b61b5c2f37973db0f3e269ad9df04e42` | Pending |
| `ecc.rule.steering.patterns` | rule | `git-sha1:fd2e6dc71136f255e10b7118b3a5d25a713a0123` | Pending |
| `ecc.rule.steering.patterns@kiro` | Edition | `git-sha1:fd2e6dc71136f255e10b7118b3a5d25a713a0123` | Pending |
| `ecc.rule.steering.performance` | rule | `git-sha1:483207e3cdeab7171906baf1421c9930b1388f31` | Pending |
| `ecc.rule.steering.performance@kiro` | Edition | `git-sha1:483207e3cdeab7171906baf1421c9930b1388f31` | Pending |
| `ecc.rule.steering.php-patterns` | rule | `git-sha1:98e3576540bb1daa298fe9c5d8c9d37f4d09e644` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.php-patterns@kiro` | Edition | `git-sha1:98e3576540bb1daa298fe9c5d8c9d37f4d09e644` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.python-patterns` | rule | `git-sha1:287453b4e991f5429643d68c11e3427fa6a2f618` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.python-patterns@kiro` | Edition | `git-sha1:287453b4e991f5429643d68c11e3427fa6a2f618` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.research-mode` | rule | `git-sha1:f51fee111a95265211665447e07a65d15f256b9f` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.research-mode@kiro` | Edition | `git-sha1:f51fee111a95265211665447e07a65d15f256b9f` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.review-mode` | rule | `git-sha1:c06940b64e2a34e648761649c2301c40d796ac8d` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.review-mode@kiro` | Edition | `git-sha1:c06940b64e2a34e648761649c2301c40d796ac8d` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.ruby-patterns` | rule | `git-sha1:fe096358cb4d1848fcc9eb88e59e210e8580add4` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.ruby-patterns@kiro` | Edition | `git-sha1:fe096358cb4d1848fcc9eb88e59e210e8580add4` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.rust-patterns` | rule | `git-sha1:8151de28b03daa477ed02ef673b8c4460f3b114d` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.rust-patterns@kiro` | Edition | `git-sha1:8151de28b03daa477ed02ef673b8c4460f3b114d` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.security` | rule | `git-sha1:eb38aa57beb74c99abd03396e80089a19461f7e4` | Pending |
| `ecc.rule.steering.security@kiro` | Edition | `git-sha1:eb38aa57beb74c99abd03396e80089a19461f7e4` | Pending |
| `ecc.rule.steering.swift-patterns` | rule | `git-sha1:721c47acc1dde21248b9b937f70b4eafc6a6ffa3` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.swift-patterns@kiro` | Edition | `git-sha1:721c47acc1dde21248b9b937f70b4eafc6a6ffa3` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.testing` | rule | `git-sha1:d75a7d87e643c184af61ed628d0f2261df73f46e` | Pending |
| `ecc.rule.steering.testing@kiro` | Edition | `git-sha1:d75a7d87e643c184af61ed628d0f2261df73f46e` | Pending |
| `ecc.rule.steering.typescript-patterns` | rule | `git-sha1:86f4f485e0d7e7ce3a277ff1b291b9b68c6a45f1` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.typescript-patterns@kiro` | Edition | `git-sha1:86f4f485e0d7e7ce3a277ff1b291b9b68c6a45f1` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.steering.typescript-security` | rule | `git-sha1:9a9b8f616ebe9355f7460b34961a8bc03a4e4904` | Published ([1][release-1]) |
| `ecc.rule.steering.typescript-security@kiro` | Edition | `git-sha1:9a9b8f616ebe9355f7460b34961a8bc03a4e4904` | Published ([1][release-1]) |
| `ecc.rule.swift.coding-style` | rule | `git-sha1:79884b8f35951e70991f3765168f20aa6e1376c4` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.swift.hooks` | rule | `git-sha1:01e0a6d9f6d94bbf9f4804bf703ac47b85a05430` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.swift.patterns` | rule | `git-sha1:4e42b9911d1ceb6cc26f70ebae8a0d6734e5d3a2` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.swift.security` | rule | `git-sha1:08ad7c573302920fed1bce53c9aed6fcc39d697e` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.swift.testing` | rule | `git-sha1:e6549c47997143d886002404c5e277be64538cac` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.typescript.coding-style` | rule | `git-sha1:398f5db387fd808a3df22a428e004854cac3b7cf` | Published ([1][release-1]) |
| `ecc.rule.typescript.hooks` | rule | `git-sha1:66f9c66d8d8b9ba1f459323ff959a47efae29c64` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.typescript.patterns` | rule | `git-sha1:42eb30e068b5e243f36d2dc866456c749dfdb918` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.typescript.security` | rule | `git-sha1:4db3c8aea5da01061dd2312191ecd467bdd53f9c` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.typescript.testing` | rule | `git-sha1:877b87799b0958fe104dbce21a1e9346d5298d50` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.vue.coding-style` | rule | `git-sha1:e9fcc4e2dd2e7789bef3d01e54a865172d173cc5` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.vue.hooks` | rule | `git-sha1:4a850da21476bbfda28b1a2ee31e4d664a23ae12` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.vue.patterns` | rule | `git-sha1:9134da30184d147bbca29342651b6bcd0e5a246c` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.vue.security` | rule | `git-sha1:69f905904bd35dd3ecac4147c427c349839ffcdb` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.vue.testing` | rule | `git-sha1:ac1f37c677c01a7d423b6c175f5661a6d9612b30` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.web.coding-style` | rule | `git-sha1:ea7b0c455947edc2c4d1efa70257f03de7eff55a` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.web.design-quality` | rule | `git-sha1:506df12b4e9d364376f3c9c21654f2e6bc904066` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.web.hooks` | rule | `git-sha1:88c4f8df3a2ac20f6334b29d9006daf6d487366e` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.web.patterns` | rule | `git-sha1:962ea571be4fc79549e0496bf313a7c044e6ea5a` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.web.performance` | rule | `git-sha1:96e387ef8c4bc5a629e70fa837f1992239a41dd9` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.web.security` | rule | `git-sha1:5aba963b2a445f99f0945ba0f3b81cb547333cb0` | Published ([1][release-1], [2][release-2]) |
| `ecc.rule.web.testing` | rule | `git-sha1:7045e0833248d82b61b071f11e4c0494cb9fb60b` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.accessibility` | skill | `git-sha1:41955f8292f74100f383461d655d0c7b2832fc8a` | Pending |
| `ecc.skill.agent-architecture-audit` | skill | `git-sha1:ca010515a0a51075982cb9b7f2c23fd25d08278e` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.agent-eval` | skill | `git-sha1:441ec6d618f25c67be2d2ee3a6498f15e10bd023` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.agent-harness-construction` | skill | `git-sha1:5b2f55ab8709a5eb1893c1c2c00ed9a93b32dfab` | Pending |
| `ecc.skill.agent-introspection-debugging` | skill | `git-sha1:462c22a06871221b14db9930b5e07f72b6b06373` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.agent-payment-x402` | skill | `git-sha1:d40e0607a44a606aaa0d25cebe0f8c067fded92b` | Pending |
| `ecc.skill.agent-runtime-gateway-smoke-test` | skill | `git-sha1:331f606d30c516430af0bc6627fcf049961b1b2e` | Pending |
| `ecc.skill.agent-security-hardening` | skill | `git-sha1:a26d9d6b369d56f65a3b542d571ccf54787dbe99` | Pending |
| `ecc.skill.agent-self-evaluation` | skill | `git-sha1:d93476eb8183aec69d1aff8716ff7f73444254ee` | Pending |
| `ecc.skill.agent-sort` | skill | `git-sha1:2fbe885710968e83ad677d1a179fb8c9eba13973` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.agentic-engineering` | skill | `git-sha1:d4096ad47d79ef18ed04794b6f8ed1f904d7bf37` | Pending |
| `ecc.skill.agentic-engineering@kiro` | Edition | `git-sha1:09afdea8fed8841f8f4fbd213bf818142a6246ac` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.agentic-os` | skill | `git-sha1:a38ae0e32c7c0bd0b55b668c888b508381f8b8d7` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.ai-first-engineering` | skill | `git-sha1:f026d056d3c04d71da1e00f85ccc59ebd338652e` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.ai-regression-testing` | skill | `git-sha1:1fa70383b8fdc718fd202ec33bb6b141ef1315c5` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.android-clean-architecture` | skill | `git-sha1:bbe7734ca66a473a4cc1438835154ba187a74667` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.angular-developer` | skill | `git-sha1:4290dad6007ee8fcae32a91a914bdb10fd5bbfbf` | Published ([1][release-1]) |
| `ecc.skill.api-connector-builder` | skill | `git-sha1:0282c47c1c5113c398527a515e251b143067ca2b` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.api-design` | skill | `git-sha1:cf2611776c37ed6a4855866e28e48074a780bb91` | Pending |
| `ecc.skill.api-design@kiro` | Edition | `git-sha1:29379eb6b675ee8a3f9218b0627d9ec7060b7c93` | Published ([1][release-1]) |
| `ecc.skill.architecture-decision-records` | skill | `git-sha1:8ef1b47817b880d5c5668fbd3ab8cd231e4fc960` | Pending |
| `ecc.skill.article-writing` | skill | `git-sha1:8151e4103578c0c00541436af592f39620f458ce` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.aside` | skill | `git-sha1:5b39cd2c6acdf12a8f9aa717f579f5d630efb237` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.astra-review` | skill | `git-sha1:af119046152aa5fdb62de3bd74e67f92754ea344` | Pending |
| `ecc.skill.auto-update` | skill | `git-sha1:ed02c05aede625843746ce1821b9cd355589e31d` | Pending |
| `ecc.skill.automation-audit-ops` | skill | `git-sha1:033c68cb6ae757717d0011cae086929d0dbd954b` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.autonomous-agent-harness` | skill | `git-sha1:8a6e9b5c7f8756ba86a0166cb46052adc9622a5b` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.autonomous-loops` | skill | `git-sha1:4f9c0b4b730aa426695a610d1b06f0cbf977cd50` | Pending |
| `ecc.skill.autonomous-loops@kiro` | Edition | `git-sha1:0eb38d2f4aef7905e522f834f581604d928a4db1` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.backend-patterns` | skill | `git-sha1:70475f53e26735e2bed243107ff921c2c32cdca5` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.backend-patterns@kiro` | Edition | `git-sha1:cf6dfcb31c8d07d17ae84741ad6e180319ebf914` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.benchmark` | skill | `git-sha1:c87e63b49db036c5925b0bb4b3f97b4df8c1081e` | Pending |
| `ecc.skill.benchmark-methodology` | skill | `git-sha1:d51323f667a6cf8783e44818ee49f7d727c21f7b` | Pending |
| `ecc.skill.benchmark-optimization-loop` | skill | `git-sha1:51c6739150da3e2d2261a3d1ab49c5aa6e850d33` | Pending |
| `ecc.skill.bengali-nlp` | skill | `git-sha1:96bb38d3f31795986437a73d23cd64142f9a6a91` | Pending |
| `ecc.skill.blender-motion-state-inspection` | skill | `git-sha1:c5d0e9c54d9cb8eee94e808300ff7de3e070949e` | Pending |
| `ecc.skill.blueprint` | skill | `git-sha1:b6445650a8e88b3d0c88d10bb97f8a83d97f3dfa` | Pending |
| `ecc.skill.brand-discovery` | skill | `git-sha1:388d50c8a13c3a1866495d8a94940048dd7d2f28` | Pending |
| `ecc.skill.brand-voice` | skill | `git-sha1:78b3180226b2ee7cf9601543dad449b5bd0d52fb` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.brownfield-retrospective` | skill | `git-sha1:f328c21e3c39a2d3c3b34685cb39317138a2f849` | Pending |
| `ecc.skill.browser-qa` | skill | `git-sha1:371ff8a5c853716727e095429f6de9248b3ac194` | Pending |
| `ecc.skill.build-fix` | skill | `git-sha1:d81a9afac5c741ae9c492a0bffa85774f1dcce9b` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.bun-runtime` | skill | `git-sha1:c108e88a8d3dd5c98054edeca32a171416d79211` | Pending |
| `ecc.skill.canary-watch` | skill | `git-sha1:a5a8cbb11c833a99499ba40f2c890de8387dad1c` | Pending |
| `ecc.skill.carrier-relationship-management` · upstream-only | skill | `git-sha1:328f54df01c19596773e05c7f978f352c62f3124` | Pending |
| `ecc.skill.change-impact` | skill | `git-sha1:e3fb4dd684715bf86d02ed8d2c3d280f345e0767` | Pending |
| `ecc.skill.checkpoint` | skill | `git-sha1:bb98b813297f889c10dc50ab45cc91d9cd8f50e1` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.cisco-ios-patterns` | skill | `git-sha1:c60a23a6e4d5e7765c612aa4fd1e36963b84780b` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.ck` | skill | `git-sha1:866b0682f0ceaad32a16726f78f8f1f2b0d66d4f` | Pending |
| `ecc.skill.click-path-audit` | skill | `git-sha1:759065819e6c95b9c89f7807f5209b4c46d88c87` | Published ([1][release-1]) |
| `ecc.skill.clickhouse-io` | skill | `git-sha1:e348878fe6b4ab2d22a7ed015b2e30c6d3357de0` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.code-review` | skill | `git-sha1:087f31622b23dd00eca10e9558f3801fcea6f5e6` | Pending |
| `ecc.skill.code-tour` | skill | `git-sha1:43f77e87d04a7459abacc3ef7d08a59a434b8f35` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.codebase-onboarding` | skill | `git-sha1:0b07c79e5f5b4d54047eaeaffb484a30d6332012` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.codehealth-mcp` | skill | `git-sha1:bc4880e6f81bc3ba7ff7cf269c05573ca3a64cf8` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.coding-standards` | skill | `git-sha1:cba68c74a296bc865d33e6178cb07abc39bb94d6` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.coding-standards@kiro` | Edition | `git-sha1:b438adb4682a5b4ae7090939ddba8a49fde6fcf9` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.competitive-platform-analysis` | skill | `git-sha1:a97383b1a82d181f0a2938a72c1430ea17bef088` | Pending |
| `ecc.skill.competitive-report-structure` | skill | `git-sha1:a04ff350122367757934c6fb64d32b6fdce6fed9` | Pending |
| `ecc.skill.compose-multiplatform-patterns` | skill | `git-sha1:1f77d9232774a7812e1be3022a1bb060ffbde8d0` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.config-gc` | skill | `git-sha1:df044bc8c6a2d4f130555a029c81c317d5ecbe91` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.config-health` | skill | `git-sha1:b08d8433cce2799d3ecf706881a98fef6c4252f0` | Pending |
| `ecc.skill.configure-ecc` | skill | `git-sha1:7d6c6ecbb57bfdbb320a381ba4fba265baa2bb4f` | Pending |
| `ecc.skill.connections-optimizer` | skill | `git-sha1:e71e2c90cd89c0dbf9b67d52661e3e4febf04675` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.content-engine` | skill | `git-sha1:e56fbcb5a355f44c63ddfe90090bf8523905b7fe` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.content-hash-cache-pattern` | skill | `git-sha1:59eaf12aade8f5fc48b2d7e77c96d8807c8b5bf8` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.content-hash-cache-pattern@kiro` | Edition | `git-sha1:ef20271dee79cae86b20e435307b91de7be8b50a` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.context-and-decisions` | skill | `git-sha1:1400d09a46db787d7e23b0e72da5bcfb8e1bb56e` | Pending |
| `ecc.skill.context-budget` | skill | `git-sha1:ffcf71f3546d131bc4ef9d23491f7d722cf3e272` | Pending |
| `ecc.skill.continuous-agent-loop` | skill | `git-sha1:5c3a4875fa105cd82e1b6784c7f78504eab1b943` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.continuous-learning` | skill | `git-sha1:0d6877dc9114d8775755d41fcd4d9072dcac3ecc` | Pending |
| `ecc.skill.continuous-learning-v2` | skill | `git-sha1:da5ce98fbf33b1fc2b311680a6179e123581e323` | Pending |
| `ecc.skill.contract-first` | skill | `git-sha1:29e194d1f3010f43875c0918cfa3a1951872dd9a` | Pending |
| `ecc.skill.conventional-commit-review` | skill | `git-sha1:928d0cea6d762344ffce8418e31781fc2b830e24` | Pending |
| `ecc.skill.cost-aware-llm-pipeline` | skill | `git-sha1:e34c5789a5f01ee4144eb9886733c7ca2f0dcca5` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.cost-report` | skill | `git-sha1:759ee0b6cebf1251a195515bfdcf66969fd9abf6` | Pending |
| `ecc.skill.cost-tracking` | skill | `git-sha1:68ccee1273eb1596c837ccb465ba5b8f1d4d8b60` | Pending |
| `ecc.skill.council` | skill | `git-sha1:a2faead77c2db3c18e20f00b888e8fa79b4b37ab` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.council-multi-model` | skill | `git-sha1:065ae8348aad27b1fc332807a8778b2abc5ee7ef` | Published ([1][release-1]) |
| `ecc.skill.counterparty-channel-discipline` | skill | `git-sha1:140918471f17c268c795c190020b038bad6c0ed3` | Pending |
| `ecc.skill.cpp-build` | skill | `git-sha1:f61601e7ad2bb218d34f130c261ac7de4f1a98db` | Published ([1][release-1]) |
| `ecc.skill.cpp-coding-standards` | skill | `git-sha1:f61788dbce2ff996ec7d71764f890298f784afb9` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.cpp-coding-standards@kiro` | Edition | `git-sha1:84ccb47f24540e81c1fc424f570d92fb7383e3f9` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.cpp-review` | skill | `git-sha1:cec0c6bc5891f3b1297555fa27c1ead4529451bf` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.cpp-test` | skill | `git-sha1:d56536a88815f08799f8f94620400318352bbdae` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.cpp-testing` | skill | `git-sha1:2c27de53011040cae5673d8acfa2f0a592c242f7` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.cpp-testing@kiro` | Edition | `git-sha1:51f75d4a0ddbc7e7881f37ac5fb865aa6b45f007` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.crosspost` | skill | `git-sha1:9aeefada92d4697bc5f8ba02fad878be207284d7` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.csharp-testing` | skill | `git-sha1:013a35ba2160a6f7723f5f26495dd4a35d440078` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.customer-billing-ops` | skill | `git-sha1:57880f82b8e33431c1d0c0f34ae9cd6350ebd84f` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.customs-trade-compliance` · upstream-only | skill | `git-sha1:e85ccd0fd63d7c0ee55beec4c414fb1ec044b823` | Pending |
| `ecc.skill.dart-flutter-patterns` | skill | `git-sha1:92253cbba0298bda6e359517abd4bc97196cc03f` | Pending |
| `ecc.skill.dashboard-builder` | skill | `git-sha1:9f05adcf569e07051e316bdcbb00df0788a3e7b2` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.data-scraper-agent` | skill | `git-sha1:0b95d1d50d829a29d34964ec5ac08ecdf403b481` | Pending |
| `ecc.skill.data-throughput-accelerator` | skill | `git-sha1:69f445408d16c35daad8ce81b84eee7bae81ee87` | Pending |
| `ecc.skill.database-migrations` | skill | `git-sha1:d47f6297495a3b1554426fc232af843c439e2103` | Pending |
| `ecc.skill.database-migrations@kiro` | Edition | `git-sha1:ed8bbe64f33df2449f7d7da72fc4bc2d34121848` | Pending |
| `ecc.skill.deep-research` | skill | `git-sha1:47d50406a0d09855f2e8b6d43f432dbcc45593e9` | Pending |
| `ecc.skill.deep-research@kiro` | Edition | `git-sha1:dc3906e697e9e0c936f56fa6b411b91c888ce16b` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.deepseek-harness-setup` | skill | `git-sha1:d4a3f8f31a8301a1f8bc9144cba905395c3d5c19` | Pending |
| `ecc.skill.defi-amm-security` | skill | `git-sha1:c0cf0230363c6a84703b367da81f9c0fd16a1908` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.delivery-gate` | skill | `git-sha1:f96c28a980213248b707df617883fe3eaaee4cf0` | Pending |
| `ecc.skill.deployment-patterns` | skill | `git-sha1:55265cfe9c4b8a8db109533e1b111fd7cbf9b2f6` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.deployment-patterns@kiro` | Edition | `git-sha1:52ad41eaf72c25dcd20b8d4d491a02acc76f9bf3` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.design-system` | skill | `git-sha1:4a894196d13121f98e730522e93444a9bbc31aa6` | Pending |
| `ecc.skill.dev-team` | skill | `git-sha1:0cb0b6106366226c45d4db53d5b2bbf5a4084c19` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.devfleet` | skill | `git-sha1:bd48266814d37deb0d6e2247c138d3ba7492c362` | Pending |
| `ecc.skill.django-celery` | skill | `git-sha1:d3816595ac4fb4dc60512a0e8d392279706ce818` | Pending |
| `ecc.skill.django-patterns` | skill | `git-sha1:e7288aaa1e251d9bbfa5d38220ece107a6914778` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.django-patterns@kiro` | Edition | `git-sha1:d48dfdc4c50a5097b19d17476fcd3920d862e53b` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.django-security` | skill | `git-sha1:929374eadfccbf16f8a32b14ddeb8332a30dd7d3` | Pending |
| `ecc.skill.django-security@kiro` | Edition | `git-sha1:9e9d517decfda3ba7795a33773148457a15c44c2` | Pending |
| `ecc.skill.django-tdd` | skill | `git-sha1:e98966e762d0f4b00a7ed4514175e72a2d13b184` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.django-verification` | skill | `git-sha1:33b7fb5e94f18b4d4a679cb71e8b3bbbafad9abf` | Pending |
| `ecc.skill.dmux-workflows` | skill | `git-sha1:b5dc98c24f22ca4b1ce338e2b15c721f869ac527` | Pending |
| `ecc.skill.docker-patterns` | skill | `git-sha1:d48762112d567a7d61bff5775fd96ead018ffb88` | Pending |
| `ecc.skill.docker-patterns@kiro` | Edition | `git-sha1:a2e18312d5367ae0a57aa0d6ac197ae00e3b2f9d` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.docs-governance` | skill | `git-sha1:82c0c25d944a5724073a6cf0a208be0d4637be6b` | Pending |
| `ecc.skill.documentation-lookup` | skill | `git-sha1:6cc1cb204bb266cb747d3b466c3da5120b11ef7e` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.dotnet-patterns` | skill | `git-sha1:72562d3bd2cad1c68ecd1203e208578dbb7707e7` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.dynamic-workflow-mode` | skill | `git-sha1:28642fa8aaf560b1210a6a3b47b6eb8a35bf595f` | Pending |
| `ecc.skill.e2e-testing` | skill | `git-sha1:e09a865ccb75967d1159adddec1090c26eb7df30` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.e2e-testing@kiro` | Edition | `git-sha1:1f29708b0389918d779e4efceb51aaf22f15db21` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.ecc-contribution-review` | skill | `git-sha1:63233d40eacbd422922dafcd7607e1929020bb1e` | Pending |
| `ecc.skill.ecc-guide` | skill | `git-sha1:b9d9c3e73efd65d66bccf478e9b1bca3b55ea0d3` | Pending |
| `ecc.skill.ecc-recipes` | skill | `git-sha1:1ca0c74f0d8207f81a4777720aa17c12e072587d` | Pending |
| `ecc.skill.ecc-tools-cost-audit` | skill | `git-sha1:f61819850d1103967f55a858da2a79d74aff22e0` | Pending |
| `ecc.skill.email-ops` | skill | `git-sha1:23f29f46007425d200e7a6152b04154b712f75ff` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.energy-procurement` · upstream-only | skill | `git-sha1:ceed9a1321322b1945bc43ad90d3069ebe9621bb` | Pending |
| `ecc.skill.enterprise-agent-ops` | skill | `git-sha1:67477e52c07e2331d2c3701c08b8136337f92270` | Pending |
| `ecc.skill.epic-claim` | skill | `git-sha1:61c4c524680abef3776da2a91adeec3d014ebb34` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.epic-decompose` | skill | `git-sha1:2095719ac1968c55d1f5135d6b8d37b6e3a890f7` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.epic-publish` | skill | `git-sha1:70777271678dc770249b40b08f042b79de77aee8` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.epic-review` | skill | `git-sha1:ba80c1d6740fa1cfad1058922665360488d45be4` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.epic-sync` | skill | `git-sha1:ac408931fb3bb2f91c292ee68ed10b262f1b9329` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.epic-unblock` | skill | `git-sha1:661fb2bf0208c88e9ffdb7d2f8212a5f1a6f646e` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.epic-validate` | skill | `git-sha1:c82be75f88c7904940ccb33aeee4ca8135f9f69e` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.error-handling` | skill | `git-sha1:9020de9e00f6b271ca8e89313546e0123f40642f` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.esign-field-placement` | skill | `git-sha1:6e860c18bb737c3310b3f7e5f5f08fb4c60df48b` | Pending |
| `ecc.skill.eval-harness` | skill | `git-sha1:e789f27d151eb784113fb631ece2c08ca8eca32e` | Pending |
| `ecc.skill.evm-token-decimals` | skill | `git-sha1:500c7291d329439fbe0f3d1b8b556ae7d98f3b3a` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.evolve` | skill | `git-sha1:89b01127586f67a9b99337e17eac9881e629ac11` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.exa-search` | skill | `git-sha1:2c59b9f7f46ffff9b45c656e7bc0bb07468729cc` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.fal-ai-media` | skill | `git-sha1:65009a4cc1c8573ab3b74a941666bcc59f99d6a6` | Pending |
| `ecc.skill.fastapi-patterns` | skill | `git-sha1:df69f4aa698df06662dbd3ffc23f8fadaa272c61` | Pending |
| `ecc.skill.fastapi-patterns@kiro` | Edition | `git-sha1:211e3a0da9ef17a4b90be8484402e4f6c129b3d4` | Published ([1][release-1]) |
| `ecc.skill.fastapi-review` | skill | `git-sha1:99dea5a86fbe15eff95c0913664765bc474799d1` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.feature-dev` | skill | `git-sha1:841aedf77d8f460a3dab6f4d553d2ed91e8ed3c1` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.finance-billing-ops` | skill | `git-sha1:01738bb09e3e211b1cb60db171f25ce7aabd9dd7` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.flox-environments` | skill | `git-sha1:ea3cb3b6e2080011c636888da6161505ff3aba4f` | Pending |
| `ecc.skill.flutter-build` | skill | `git-sha1:16bab25b4aedb500c565204c696b382265c4b9ae` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.flutter-dart-code-review` | skill | `git-sha1:97d34be246dbda5172b3e482b6ffd0de6be0294f` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.flutter-review` | skill | `git-sha1:f2c44be1d41c07a9f64f00d081eb092f6c608165` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.flutter-test` | skill | `git-sha1:d0e701a6dd179d9482785e221e4150a69b0710e0` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.foundation-models-on-device` | skill | `git-sha1:c7f0ff3caad90771751d4d90499814ba8e40d8fd` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.frontend-a11y` | skill | `git-sha1:a7db5965d4d074a40736c60418d01aad8454edac` | Pending |
| `ecc.skill.frontend-design-direction` | skill | `git-sha1:1f7d7c0db5b1ac65534567f8b76d35155dd192d1` | Pending |
| `ecc.skill.frontend-patterns` | skill | `git-sha1:380b1cf11c65e7b2f99631ca67176ffefb9c9a63` | Published ([1][release-1]) |
| `ecc.skill.frontend-patterns@kiro` | Edition | `git-sha1:6095ffaa4a07ca0e40767b24261e7f22fb758bbc` | Published ([1][release-1]) |
| `ecc.skill.frontend-slides` | skill | `git-sha1:a8b6bfa128a6fcab805a04a2cc414798c6ff5ea8` | Pending |
| `ecc.skill.fsharp-testing` | skill | `git-sha1:6291768255ca0207b1de9c2d3ea8421fd87b9812` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.gan-build` | skill | `git-sha1:e92f241fa1d89096ac9521f96a6d881721157160` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.gan-design` | skill | `git-sha1:94d2d0a2a7b15b6ee508cabd61a20a2df0032187` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.gan-style-harness` | skill | `git-sha1:884db96efc730466e01e6770d610b9b4ea79538c` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.gateguard` | skill | `git-sha1:16fbd231060479606a6b6219785370e01231655a` | Pending |
| `ecc.skill.generating-python-installer` | skill | `git-sha1:daac569f4db4a27116eadfb510186715a84955d3` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.git-workflow` | skill | `git-sha1:05020055c65f40ef9f0ba6d0dc141355a6089bf0` | Pending |
| `ecc.skill.github-ops` | skill | `git-sha1:180f9663a261f74a52bfb5fcfe19917dfce074aa` | Pending |
| `ecc.skill.go-build` | skill | `git-sha1:94736b079da48172d2134cd2c71ec852c0b2c724` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.go-review` | skill | `git-sha1:2d5d2f4c7bf2624c93d0acaaa3fdf2eb64363f37` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.go-test` | skill | `git-sha1:0be716fceddc296a82c695eb7610cceabc4513cb` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.godot-patterns` | skill | `git-sha1:290cfe06ccff84703f8054ba4aefd4252412385e` | Pending |
| `ecc.skill.godot-testing` | skill | `git-sha1:2136a22daf6463d4adad82f830d7bf36f7aecf83` | Pending |
| `ecc.skill.golang-patterns` | skill | `git-sha1:fbd2f84c5c5476f604c18eef61dd8adca35a9798` | Pending |
| `ecc.skill.golang-patterns@kiro` | Edition | `git-sha1:d9ac5d2b40925a651699964ded6ffd3a5460a525` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.golang-testing` | skill | `git-sha1:ec79dd0b5aa1df23d7362a3c22c1f0a7bd4bb594` | Published ([1][release-1]) |
| `ecc.skill.golang-testing@kiro` | Edition | `git-sha1:320c1cf5db21006faf1a2437bc81143930b7de33` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.google-workspace-ops` | skill | `git-sha1:99a6898ed7455b6b573bd6f2b7819656af21e02a` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.gradle-build` | skill | `git-sha1:60f814a5da922ad916fb4aab38c27cb0f1d627d5` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.growth-log` | skill | `git-sha1:dbbba9f9ffa98970284698020390a78976d378fb` | Pending |
| `ecc.skill.harness-audit` | skill | `git-sha1:0b259ba2cca975a21e94c9ff4950c8dfaa2c5897` | Pending |
| `ecc.skill.healthcare-cdss-patterns` | skill | `git-sha1:fe1ea4871e146b74e945bb6a84a3a0803af52dcd` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.healthcare-emr-patterns` | skill | `git-sha1:80475642a10f03324deaa2325dded8ae76fca456` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.healthcare-eval-harness` | skill | `git-sha1:f6d9ed25f0687ea1a7e47d9b4c4262aec579f257` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.healthcare-phi-compliance` | skill | `git-sha1:0e896c1c19bee8e9f51d6b383869688d4bafd402` | Pending |
| `ecc.skill.hermes-imports` | skill | `git-sha1:0c1ef913ff1f6bba9164fa90f6ee7744e025428e` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.hexagonal-architecture` | skill | `git-sha1:cc5a6b588875ee9b278cb7432127237824cbadfe` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.hipaa-compliance` | skill | `git-sha1:e83039c46ae34eff341feae4355bb678654f56ff` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.homelab-network-readiness` | skill | `git-sha1:7204afc81136da5607c51b925b44dd18590a609b` | Pending |
| `ecc.skill.homelab-network-setup` | skill | `git-sha1:30148bd833d6e33bb1bd6d7ab29b1e3adff4b18f` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.homelab-pihole-dns` | skill | `git-sha1:646f9639476072f4cc6325fc519e8412a1e49e1b` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.homelab-vlan-segmentation` | skill | `git-sha1:bc296a9958e0174abd84c0597d318d1615efb122` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.homelab-wireguard-vpn` | skill | `git-sha1:f109a9bb7ed59cdc820528327e160cbeb3442f6c` | Published ([1][release-1]) |
| `ecc.skill.hookify` | skill | `git-sha1:56dc8d715d0ecc19b5bb15941261c055a00eb2a5` | Pending |
| `ecc.skill.hookify-configure` | skill | `git-sha1:9f3d1d69460abca6b763c995d14441dade89a2a0` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.hookify-help` | skill | `git-sha1:121c1179628d8bc9d3302736e8fb97f6f60e0cfb` | Pending |
| `ecc.skill.hookify-list` | skill | `git-sha1:b87dff117c0c97dde859d9cdbd4f5f648f36b6c1` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.hookify-rules` | skill | `git-sha1:a1ace7c5e590ac0ea7087151bae27e718982bb60` | Pending |
| `ecc.skill.i18n-sync` | skill | `git-sha1:5714ec311c5588b6d3f49442cc9de5e37d3eb81f` | Pending |
| `ecc.skill.inherit-legacy-style` | skill | `git-sha1:3c97fa7e4448e930874481bfcd364ae54dbb1008` | Pending |
| `ecc.skill.instinct-export` | skill | `git-sha1:0f8db4996f7d2215e8e471231b6120594700734f` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.instinct-import` | skill | `git-sha1:cd9f152bcf2c608407424df17b58d0bcb698f86a` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.instinct-status` | skill | `git-sha1:362449111c89b49759361f85a876b0c020100445` | Pending |
| `ecc.skill.intent-driven-development` | skill | `git-sha1:7d8a0da878bcc2d458f46be0f02fbb325c98f6f0` | Pending |
| `ecc.skill.inventory-demand-planning` · upstream-only | skill | `git-sha1:2e1f19d1ce993adbc4b8182390555d612a505022` | Pending |
| `ecc.skill.investor-materials` | skill | `git-sha1:41aded60d8eb9cd402eeae54f3cb762e0970520c` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.investor-outreach` | skill | `git-sha1:daff345bfb4c170805c37fd60f263b1feebe560a` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.ios-icon-gen` | skill | `git-sha1:94fc961bf5b241b26b8d766a0f377ab113e2c373` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.issue-review` | skill | `git-sha1:bbfeaa744ac56c4987fb9487509899a1ac760734` | Pending |
| `ecc.skill.iterative-retrieval` | skill | `git-sha1:1f1e8d67cf41d72acf2315dc7e6edeac0fc231a6` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.ito-baskets` | skill | `git-sha1:677c49a096c0617fcbe89711f1860a8897dc31b0` | Published ([1][release-1]) |
| `ecc.skill.ito-compute` | skill | `git-sha1:eafd6082b3b7fc5393daaef22bb57dc41f1beba0` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.ito-inference` | skill | `git-sha1:c6b0903e6f5f322fa37a03a609e9210d55a25c97` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.ito-training` | skill | `git-sha1:2f04ae4a40ee809480906f61baae693b648cd2a7` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.java-coding-standards` | skill | `git-sha1:82d6c06731702476735e392fcb016274d8845191` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.java-coding-standards@kiro` | Edition | `git-sha1:3af5d8d7228af3efdd7ef82a910947091c8f0c54` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.jira` | skill | `git-sha1:659d595d2433d8d5de1944c39b835b9bf3ac36e4` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.jira-integration` | skill | `git-sha1:ccda3cb3c8fd4c3ce5b4997a2a61082b9841ffda` | Pending |
| `ecc.skill.jpa-patterns` | skill | `git-sha1:9034c5c2be68fdf6d13ed7f495949495bdf46f1b` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.jpa-patterns@kiro` | Edition | `git-sha1:5ff096997bef2b6187ea6adb06420e5ac4a85951` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.knowledge-ops` | skill | `git-sha1:f84974727800a98a74c714568bab435dac268132` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.kotlin-build` | skill | `git-sha1:a43807d8af9fc892d33180d477b953f6989d71a8` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.kotlin-coroutines-flows` | skill | `git-sha1:c95b48ef96193698a2e57ca2f0a53b9126bc3f08` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.kotlin-exposed-patterns` | skill | `git-sha1:c32f1dd6b155584d827476c51ecffe29a3c43be9` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.kotlin-ktor-patterns` | skill | `git-sha1:2408c3384551f01e45c8f7764790198d074e460f` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.kotlin-patterns` | skill | `git-sha1:2697a080732edb070db208bdb5a0b33eb434facd` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.kotlin-patterns@kiro` | Edition | `git-sha1:22f7eda9353c5a2df5d10bd95ab23de1c5b49438` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.kotlin-review` | skill | `git-sha1:ecdf982370bafa22fa4923407af5d03caa5777da` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.kotlin-test` | skill | `git-sha1:024a4fd4f35c9133b8f19da19269fe077aa7ed8f` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.kotlin-testing` | skill | `git-sha1:1ba730dbefe847fac0f3bcc2ff7d2800e56f283f` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.kotlin-testing@kiro` | Edition | `git-sha1:93f88d0e11f5463f6378a076542f779007b5a104` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.kubernetes-patterns` | skill | `git-sha1:3f69ff50ed3db99cae446ef6abc48adec0a51d65` | Pending |
| `ecc.skill.laravel-patterns` | skill | `git-sha1:1de36d796ac60c388d0cb1d5413c0e4b4196fca9` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.laravel-plugin-discovery` | skill | `git-sha1:a567ea664b6ac4c6e7f36e0b60d2df5248ef424c` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.laravel-security` | skill | `git-sha1:7fc3d8334af9ae381f771abb091c03523e0d4532` | Pending |
| `ecc.skill.laravel-tdd` | skill | `git-sha1:3a25e9b9ff67004233e0c3d0b52600f6d08a148e` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.laravel-verification` | skill | `git-sha1:a9f05de117bc1bfadbc64641843913d8d9c8904c` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.latency-critical-systems` | skill | `git-sha1:952ab7443393f558f7c9e8b1abfa58d4507113bc` | Pending |
| `ecc.skill.lead-intelligence` | skill | `git-sha1:0472626fc7b64d7839a7f608cd5476ee1b747a08` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.leanrea` | skill | `git-sha1:98f4efc1920093fa4df2d2f0a8c4377d2601707c` | Pending |
| `ecc.skill.learn` | skill | `git-sha1:116c25b9040d6fa3efbb44e35f054d2f3978f2ca` | Pending |
| `ecc.skill.learn-eval` | skill | `git-sha1:483a48043570b795140b1abbd3851a00ad9c6675` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.liquid-glass-design` | skill | `git-sha1:98ecb5980c1c9330b1610b4d8b568612b2f04e4a` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.living-docs-governance` | skill | `git-sha1:921841c42990023e3651699bfab24bdca2ace092` | Pending |
| `ecc.skill.llm-trading-agent-security` | skill | `git-sha1:87fe38dcae8fd692b4036efb3505a56e2372d621` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.logistics-exception-management` · upstream-only | skill | `git-sha1:fc53442b7c707d020f75c1f4b36f053550f70747` | Pending |
| `ecc.skill.loop-design-check` | skill | `git-sha1:692bbecec7e9782e4cfa92c1a193231914593f96` | Pending |
| `ecc.skill.loop-start` | skill | `git-sha1:448cb7cea461df994e643ae4f9c22eaba915f176` | Pending |
| `ecc.skill.loop-status` | skill | `git-sha1:0ef3d030c3ced58b956e7ad919f81f4a25904007` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.mailtrap-email-integration` | skill | `git-sha1:7b602bf38e9c75cc7656d0cbe4838d97c1de84f7` | Published ([1][release-1]) |
| `ecc.skill.make-interfaces-feel-better` | skill | `git-sha1:e4da7e59af9087fa750ec7359fba7e85b7a70808` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.manim-video` | skill | `git-sha1:5bfc2096a0ef4fd1a489bcd8615a1c1ab4e491c3` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.market-research` | skill | `git-sha1:2fbbd54db33f7ac0ab8ca5d8c17e33357a0df424` | Pending |
| `ecc.skill.marketing-campaign` | skill | `git-sha1:9320e2aac6c35cf5d30b538c5845f0e0fdcd0ce1` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.master-agreement-generator` | skill | `git-sha1:61d168919804fcdfe5f23dae15c009fc92ad14e4` | Pending |
| `ecc.skill.mcp-dependency-review` | skill | `git-sha1:eda57816b27f15d26811d28ccc977ff699633d04` | Pending |
| `ecc.skill.mcp-server-patterns` | skill | `git-sha1:fc7007dfcae735eb2fe464d13b39c7d9cddd4131` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.messages-ops` | skill | `git-sha1:32e359b8537d47923d2cfc1017a1a897fd6f57f9` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.ml-adoption-playbook` | skill | `git-sha1:89210a8fad7288c3d33bff9c4e65011a04fc2e14` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.mle-workflow` | skill | `git-sha1:3ceb8888f01d772b4ef926a6d5a27d76d068f88d` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.mle-workflow@kiro` | Edition | `git-sha1:9842067f7a2c6abc21c07a21bb5c04cfefccaa7a` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.model-route` | skill | `git-sha1:09f9efd8447b188b3506b55e61ac7a5e035108f0` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.module-governance` | skill | `git-sha1:ce4dd68650f8fd10546b6e8b431049fc2ee05332` | Pending |
| `ecc.skill.module-regression` | skill | `git-sha1:9e2e3e8e9c30b13294aab0a399a79cc02a245cec` | Pending |
| `ecc.skill.motion-advanced` | skill | `git-sha1:c699827c6bd3cca1e8354922fc294fb958e9feaa` | Published ([1][release-1]) |
| `ecc.skill.motion-foundations` | skill | `git-sha1:f07d4208762c7e9b66953ee5e227a4dfbd29cc61` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.motion-patterns` | skill | `git-sha1:199eab69a0e7ffc90748358e225f242c61f5e159` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.multi-backend` | skill | `git-sha1:91e8a1e7eb13f087f2897e94fdb8f68f40fcad96` | Pending |
| `ecc.skill.multi-execute` | skill | `git-sha1:db1022a5e3867dd5f5a6d31e1ec8e9e148693ed6` | Pending |
| `ecc.skill.multi-frontend` | skill | `git-sha1:1f4af7b46dcd0eab38ac1f9aa8aab7840099b7a6` | Pending |
| `ecc.skill.multi-plan` | skill | `git-sha1:608a94144edfb550c1aa724876389e3681d85d1e` | Pending |
| `ecc.skill.multi-workflow` | skill | `git-sha1:4d876584a22443fbc16afbe2980e5db116b8ac67` | Pending |
| `ecc.skill.mybatis-patterns` | skill | `git-sha1:7a8357b809b99267e0733472c943b23331b291e2` | Pending |
| `ecc.skill.mysql-patterns` | skill | `git-sha1:40372262b0bfa032b06296c17bdf2b5ecf231eac` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.nanoclaw-repl` | skill | `git-sha1:10d8cd5b2a58853046e9f9807d1e8a61d4d5d80e` | Pending |
| `ecc.skill.nasiko-control-plane` | skill | `git-sha1:b37345dab19db091273f36b5ae6e433b15ce0334` | Pending |
| `ecc.skill.nestjs-patterns` | skill | `git-sha1:54b35d7008963cdb5d7cbd87b00df9a4a0d8ced3` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.nestjs-patterns@kiro` | Edition | `git-sha1:fe72d416623f06b801ee40a0048df75d6644222d` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.netmiko-ssh-automation` | skill | `git-sha1:66c5927425d012747d307534eee40ec563a32bb0` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.network-bgp-diagnostics` | skill | `git-sha1:3a3d74b403be3150b826601bb16d4f9f7a96fbe0` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.network-config-validation` | skill | `git-sha1:9782175a197c528bfff2820d80da3b37da916c4e` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.network-interface-health` | skill | `git-sha1:c276ee2cd06838a3b1b35ccd54819b6aaacd78e7` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.nextjs-turbopack` | skill | `git-sha1:66a39fcf4a029fc34d360437b13f12d953f3a7c6` | Pending |
| `ecc.skill.nextjs-turbopack@kiro` | Edition | `git-sha1:6bc4513f2638c1266cdecb87f40b208421e71100` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.nodejs-keccak256` | skill | `git-sha1:69f4a0a16718920a42b050d0beb23987d0a00f13` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.nutrient-document-processing` | skill | `git-sha1:280d2f702970e90fa1adc0be20725cd89b5f0b24` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.nuxt4-patterns` | skill | `git-sha1:7b1041b9ed14311622c1ae78b19033dbf3d6a35e` | Published ([1][release-1]) |
| `ecc.skill.openclaw-persona-forge` | skill | `git-sha1:b80123a9812e15a454f6769457ff897883771ce0` | Pending |
| `ecc.skill.opensource-pipeline` | skill | `git-sha1:2efa06f1527126943887df337a35f59f13d36a29` | Pending |
| `ecc.skill.operator-approval-loop` | skill | `git-sha1:8e301c65d4a963b0e918951378ae9fbcea89d1e1` | Pending |
| `ecc.skill.orch-add-feature` | skill | `git-sha1:4171089a24539aa824b9abb2f227901612dfc1cb` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.orch-build-mvp` | skill | `git-sha1:c6862981187a5d7daff78ed65ab390016cb27098` | Pending |
| `ecc.skill.orch-change-feature` | skill | `git-sha1:403286fdcd9c102a5be3cb0955cc5f89ac3baf8b` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.orch-fix-defect` | skill | `git-sha1:c0332a1080409727cea307daaee364f96b8d6b41` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.orch-pipeline` | skill | `git-sha1:6fe50c06d385bddafbe2fb66ae956ae006a9bdc0` | Pending |
| `ecc.skill.orch-refine-code` | skill | `git-sha1:459ade3b2349fbfb682a9e8061bacddcf2627757` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.orch-review` | skill | `git-sha1:84d15a253dd3488ee3d1e7f6de2b945f1d74e540` | Pending |
| `ecc.skill.osint-investigation` | skill | `git-sha1:7168d54281fae5b32839cd32708b71067250df61` | Pending |
| `ecc.skill.parallel-execution-optimizer` | skill | `git-sha1:4f06a093d796f93766f6789b5c5b36bc2f415567` | Pending |
| `ecc.skill.perl-patterns` | skill | `git-sha1:6b41d4b3a3a0281e550e6c0fbd8e24ba3c86e1fb` | Published ([1][release-1]) |
| `ecc.skill.perl-security` | skill | `git-sha1:a21ca91716bdde04503eba7d54702c9156652230` | Pending |
| `ecc.skill.perl-testing` | skill | `git-sha1:3e1a50480da93705543b232d9844a38584e29e32` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.plan` | skill | `git-sha1:ff003aeffea907a03557948b352391a04c3c360d` | Pending |
| `ecc.skill.plan-canvas` | skill | `git-sha1:3d86e4938730e35b9de4715fab1f584a0b5734a2` | Pending |
| `ecc.skill.plan-orchestrate` | skill | `git-sha1:b127cd9f32e11c018f26d5b297552b02e995d050` | Pending |
| `ecc.skill.plan-prd` | skill | `git-sha1:dd771f0b846af528d50e577879ab2b16aa2a1789` | Pending |
| `ecc.skill.plankton-code-quality` | skill | `git-sha1:51fb726ccd3ea18e0a679f86143343ef2f5129c8` | Pending |
| `ecc.skill.platform-factory` | skill | `git-sha1:239deac3f0642358add24a1f501483b7dd6132ec` | Pending |
| `ecc.skill.pm2` | skill | `git-sha1:d3321cee00410656dff1e8d81aac9f35fa0041c4` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.postgres-patterns` | skill | `git-sha1:363862ac5bb33ec6621d63565bcf5d7f92db6be6` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.postgres-patterns@kiro` | Edition | `git-sha1:7ecd3fefc556d40ad2283aaa890dd9afb120089a` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.pr` | skill | `git-sha1:22ec685e8f51a9276793e11058ae159abc812b50` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.prediction-market-oracle-research` | skill | `git-sha1:93ca12eaf731c73128b91c343a1b6f2cc4687709` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.prediction-market-risk-review` | skill | `git-sha1:cd904734933a8a9804004053a3f21429390658fa` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.prisma-patterns` | skill | `git-sha1:9519f5f8fb5a1c3b972635d3b1aeb90d94e58957` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.product-capability` | skill | `git-sha1:09ea16cb2d6add2c29f114878266addf180e750a` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.product-lens` | skill | `git-sha1:5b531ca8600e7020c19e3e68e845b929efa35e19` | Pending |
| `ecc.skill.production-audit` | skill | `git-sha1:79fc1dcd7b600500b198fb9860c99f1cef3a1a17` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.production-scheduling` · upstream-only | skill | `git-sha1:75939097512ab23eef3a4680c655b2531659cfd2` | Pending |
| `ecc.skill.project-flow-ops` | skill | `git-sha1:89950f9c9ae9e0b3903410cd9298985ed7643b29` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.project-init` | skill | `git-sha1:62f48aecbc75401e194182b39c1e3430e5d9edca` | Pending |
| `ecc.skill.projects` | skill | `git-sha1:37515b667ed7dd23a13066462922a739579f39bf` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.promote` | skill | `git-sha1:a587f8d44e44ad6b51d773a1056a79dd1462690c` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.prompt-caching-strategy` | skill | `git-sha1:b5a25b042ac7c7126251ad3b22e6aec27cdd4af8` | Pending |
| `ecc.skill.prompt-optimizer` | skill | `git-sha1:da11319a1805b919fbe0b76bf67f2800faa47410` | Pending |
| `ecc.skill.prp-commit` | skill | `git-sha1:e7b5a3282731f7e0198ec394e2ad7ebb5772c5db` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.prp-implement` | skill | `git-sha1:c92a4cb79c52f713a801ec0be366648a91c2eae4` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.prp-plan` | skill | `git-sha1:6a64280c6451bfbe8580bfacde6bfebb0c52d1c1` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.prp-pr` | skill | `git-sha1:c25d087493670ecd9b322099cfb3f3d2c10faa06` | Pending |
| `ecc.skill.prp-prd` | skill | `git-sha1:2b58aac3acc2962597b131914b2186b4e2611965` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.prune` | skill | `git-sha1:4c8f2ae6116dce2adf9bce413ec4b8145713726d` | Pending |
| `ecc.skill.python-patterns` | skill | `git-sha1:a760f82665c97712722cf849f7b0d24872678a70` | Published ([1][release-1]) |
| `ecc.skill.python-patterns@kiro` | Edition | `git-sha1:114c27672ffb64f63c1e755a864810567a45faa7` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.python-review` | skill | `git-sha1:272e5a24a5aebc9cc7a0223eef013ca115bb274d` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.python-testing` | skill | `git-sha1:695c8c3ca6b758d9c98f324d064f8263d70afd68` | Pending |
| `ecc.skill.python-testing@kiro` | Edition | `git-sha1:f87cb423f7a7285231c384cc637c6d5a2d442f34` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.pytorch-patterns` | skill | `git-sha1:380f3287dc3e7b1fc7e2f231aee68674e9a7ef0d` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.pytorch-patterns@kiro` | Edition | `git-sha1:e14d9a75ff47b312ef0e49a20358e054a32029e8` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.quality-gate` | skill | `git-sha1:e650e8ce33e52cb7571e4b16cc6f9f98bf29a833` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.quality-nonconformance` · upstream-only | skill | `git-sha1:d85158cb735408fe437fb7622e7a942f2fa67a82` | Pending |
| `ecc.skill.quarkus-patterns` | skill | `git-sha1:597a0aa853c1a260756d7151e4bcc5d0bb7000ae` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.quarkus-security` | skill | `git-sha1:58086dd779e16cefb2f2e451fbb9fcb9dfa8b541` | Pending |
| `ecc.skill.quarkus-tdd` | skill | `git-sha1:9144368237b1784385468708724c58ad86ce0098` | Published ([1][release-1]) |
| `ecc.skill.quarkus-verification` | skill | `git-sha1:1209215272bf509b084a684778341f71b1dbb1e6` | Pending |
| `ecc.skill.rails-patterns` | skill | `git-sha1:f8c87f7ea3cf6bf099aeb9322d540e2d2b648b4a` | Pending |
| `ecc.skill.rails-security` | skill | `git-sha1:f8757ec71e4e526aba0502a35a314faaf3cf4274` | Pending |
| `ecc.skill.ralphinho-rfc-pipeline` | skill | `git-sha1:f27188d03de814bd34cbbdf61aa6b79754edb356` | Pending |
| `ecc.skill.react-build` | skill | `git-sha1:d176d45709814807de3e4ffd1b83e2e4c9bc1861` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.react-native-patterns` | skill | `git-sha1:a3b27a5b867fa035aebf6a1baf00a6eabab443a4` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.react-patterns` | skill | `git-sha1:eda27679d5af43c3d76ce4653851a46b7d2aee21` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.react-patterns@kiro` | Edition | `git-sha1:9c19e5b65dd29cf8d12a52ffda906ce1541991a9` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.react-performance` | skill | `git-sha1:90ad71c0ec53c3a73f8b220b502b7e4edda88f99` | Published ([1][release-1]) |
| `ecc.skill.react-review` | skill | `git-sha1:689db883cd7330aa9731e55555bf09987f4edd82` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.react-test` | skill | `git-sha1:dabf4329ad4e1c75eb2211efe26d34ad2712582d` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.react-testing` | skill | `git-sha1:36ad005d734fe78115e1969a4e8c2ff973b0a96c` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.react-testing@kiro` | Edition | `git-sha1:1be84cb782f483b7531d4079d12481cb600d140a` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.recsys-pipeline-architect` | skill | `git-sha1:db89c161ae7c4ee62f233e5725446821fe33f8ee` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.recursive-decision-ledger` | skill | `git-sha1:c9410858f80423dceea1c6ef6eebf1c96361a265` | Pending |
| `ecc.skill.redis-patterns` | skill | `git-sha1:dfbb31c13a1b6509f91cde18ba82e52c10502305` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.refactor-clean` | skill | `git-sha1:1d06e55d30f8915b6c8ac79984cc89816224464a` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.regex-vs-llm-structured-text` | skill | `git-sha1:653c3f4bd73779a019b1096f95226473b539b6ee` | Pending |
| `ecc.skill.remotion-video-creation` | skill | `git-sha1:3d5d01a8d996c502677559beb220a5b909cca874` | Pending |
| `ecc.skill.repo-scan` | skill | `git-sha1:04cdbe8c6208462ddb7cff7a456c702302c234c4` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.research-ops` | skill | `git-sha1:aed56959f38e9d0a343eaae8644f0de436085324` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.resume-session` | skill | `git-sha1:047c7dea95778709b9251aa74f0787b9dbefcfee` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.returns-reverse-logistics` · upstream-only | skill | `git-sha1:0c0e29853368b075735272360c6c586c1e4900d6` | Pending |
| `ecc.skill.review-pr` | skill | `git-sha1:9c4afd0c05f3cb1b7894db639f9ba7a8a35be626` | Pending |
| `ecc.skill.roundhouse-x402` | skill | `git-sha1:b0bff4d84eaa29eac8fc1f47c5f50b2fbbb32538` | Pending |
| `ecc.skill.rules-distill` | skill | `git-sha1:2f202b59e901599215bdedb0d2b426bad45655e3` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.rust-build` | skill | `git-sha1:efbe6c39cd37f10a09090c2b0909c24c1499fa77` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.rust-patterns` | skill | `git-sha1:88e647924a1f29d7c75a7a15f3e40dce4b68146e` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.rust-patterns@kiro` | Edition | `git-sha1:b4982484114c8a3e73dd31965ce5777507a1102b` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.rust-review` | skill | `git-sha1:1912ec29849c4c937942a2ccfac9ee612fe5f1ed` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.rust-test` | skill | `git-sha1:75c67e67ccb3803c1913b3af409632770b7d0574` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.rust-testing` | skill | `git-sha1:168d8a24ffec489070a6da1bf8af19716ba356bc` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.rust-testing@kiro` | Edition | `git-sha1:d1a20de880fd1146afd6f895c26e3a2fee9b445e` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.safety-guard` | skill | `git-sha1:41c77bc833a92fd8a3c8b51086995dc78f3bc6a3` | Pending |
| `ecc.skill.santa-loop` | skill | `git-sha1:c9a7c89837e1e59402711fc66e3e9f60e8ebaa82` | Pending |
| `ecc.skill.santa-method` | skill | `git-sha1:80fcda4eba4cae9f961eae95c6e59f7416a96927` | Pending |
| `ecc.skill.save-session` | skill | `git-sha1:120a731cbbff42f1ff6c3165a74037c69d612f54` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.scientific-db-openalex-database` | skill | `git-sha1:9b26a905942784da5982872f0862813db29f51bd` | Pending |
| `ecc.skill.scientific-db-pubmed-database` | skill | `git-sha1:16bf30891b8ff585fb0c52c647ba1f47a3dd6a1e` | Pending |
| `ecc.skill.scientific-db-uspto-database` | skill | `git-sha1:144fc6f97afdece0e41d7fd967a7ce4e44a66c85` | Pending |
| `ecc.skill.scientific-pkg-gget` | skill | `git-sha1:17b070280e8d22f50221149e085bf90d01c67855` | Pending |
| `ecc.skill.scientific-thinking-literature-review` | skill | `git-sha1:f6d2afa330c9a2a3b6223a968090d534301e145d` | Pending |
| `ecc.skill.scientific-thinking-scholar-evaluation` | skill | `git-sha1:a2bcfbf4f4839adcea45356495a44ee535f368ca` | Pending |
| `ecc.skill.search-first` | skill | `git-sha1:3ac0daf42ee5c7d0cbe28c399f02ff057283b889` | Pending |
| `ecc.skill.search-first@kiro` | Edition | `git-sha1:778a8d588150a06c3d71874cdd01a0ecfafb12b5` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.security-bounty-hunter` | skill | `git-sha1:b51413ceb0704436cc0fe07dbb6e616fc40a3038` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.security-review` | skill | `git-sha1:a9093c56a78f65afa417f28ea04abda05eb199a5` | Pending |
| `ecc.skill.security-review@kiro` | Edition | `git-sha1:ac1f16c8d684f478c8dd88ba4cc619a79b4c5164` | Pending |
| `ecc.skill.security-scan` | skill | `git-sha1:47b5f23d868b55f8f00e4e44619e8f0f3dc36999` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.seo` | skill | `git-sha1:14c7dc40594663db67a8032d4ad5d3e472076dc6` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.sessions` | skill | `git-sha1:966f6a3a3dbb10902614753b2bd4fdc05dd2bdaf` | Pending |
| `ecc.skill.setup-pm` | skill | `git-sha1:d6bdd517ba81dc8dbb289672295599b043c3acf9` | Pending |
| `ecc.skill.short-video-distribution` | skill | `git-sha1:3e099ec0b21076bb58e004972728f8fe6d5b340d` | Pending |
| `ecc.skill.skill-comply` | skill | `git-sha1:30a8141aa83f444d239a7d6ea543246f7c973007` | Pending |
| `ecc.skill.skill-create` | skill | `git-sha1:7809c3cadef8b665b40373a022590bb22e898ae9` | Pending |
| `ecc.skill.skill-health` | skill | `git-sha1:c0efbc8b4cadc6e39013c87548f2c0338d9c46e9` | Pending |
| `ecc.skill.skill-host-compat` | skill | `git-sha1:41550ecdd79ff6dcd09980ef347dc15bd0f08d6e` | Pending |
| `ecc.skill.skill-scout` | skill | `git-sha1:3b5d1b5eed92eb5bb947a76dadf4b5be9b337ed8` | Pending |
| `ecc.skill.skill-stocktake` | skill | `git-sha1:a54bf9f7165c5d63152196dd9241e7e6725a8823` | Pending |
| `ecc.skill.social-graph-ranker` | skill | `git-sha1:8356eae4e78927fe552b9862dfc8023b1b788c5b` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.social-publisher` | skill | `git-sha1:3a9a332ab44c749a9428000ba5c10b295313f87f` | Pending |
| `ecc.skill.springboot-patterns` | skill | `git-sha1:c5ea2e78864dae862e9add17aea0f1c21f592bf4` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.springboot-patterns@kiro` | Edition | `git-sha1:7258b250fc2dd341effb3f7a51dfdf4cda86b6f4` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.springboot-security` | skill | `git-sha1:7f9b93f7fc95d5f490744e8a20ac34644faab007` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.springboot-security@kiro` | Edition | `git-sha1:d089e1ee0ecc4efee207c5568d2526848988eb51` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.springboot-tdd` | skill | `git-sha1:0dbe04e4ce6ed7d11c5eac60f01d12fcfbc040ec` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.springboot-verification` | skill | `git-sha1:9aec763a4e53885ac9f38557280011ba029101f7` | Pending |
| `ecc.skill.story-lifecycle` | skill | `git-sha1:cf7c6575c2b1b976b9dc403f0d5a0a52b643e034` | Pending |
| `ecc.skill.strategic-compact` | skill | `git-sha1:e6aaaf15b106aca085d9adddff245e8344f02ce7` | Pending |
| `ecc.skill.strategic-compact@kiro` | Edition | `git-sha1:7289c49cb7485841c7e33cdb1746dc81950070d5` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.swift-actor-persistence` | skill | `git-sha1:022e55c5196a83deca83d7ef754896898b0a5d60` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.swift-actor-persistence@kiro` | Edition | `git-sha1:e715d087e33a054a7db15e2e2440cc501cab481a` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.swift-concurrency-6-2` | skill | `git-sha1:b21b0bfec2eabb70f577ab9661ec6ed6831972fa` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.swift-protocol-di-testing` | skill | `git-sha1:4c492a7cbebbdff8d351be9b1aecd0c17f310cda` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.swift-protocol-di-testing@kiro` | Edition | `git-sha1:08187058eee9c0ef072a65b0fbe1a5cb5f25b994` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.swiftui-patterns` | skill | `git-sha1:16261476dd3e09b576688acb65772c3986049055` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.taste` | skill | `git-sha1:d8db5d5cf3e1aaf8f513750c8d05d4c09e556b12` | Pending |
| `ecc.skill.taste-application` | skill | `git-sha1:17c19514fb9aae3c93eefe647e7373113f3d9246` | Pending |
| `ecc.skill.taste-distillation` | skill | `git-sha1:e7411da15907e5a82e77a73adecc014ceff71d3f` | Pending |
| `ecc.skill.tasteforge-video` | skill | `git-sha1:44d23c1555e52edc03685b43cf4fc189fca7900a` | Pending |
| `ecc.skill.tdd-workflow` | skill | `git-sha1:454be0464271721c6b45c8f02be012b9670127df` | Pending |
| `ecc.skill.tdd-workflow@kiro` | Edition | `git-sha1:c8e53ffc9a1832bf0260eeacab6fdc850d4ff894` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.team-agent-orchestration` | skill | `git-sha1:ca197c9ae2121fdd4427beabd00467e1c9eb63d8` | Pending |
| `ecc.skill.team-builder` | skill | `git-sha1:6496c599ee710dcc2e38753ed102ba9ac014492c` | Pending |
| `ecc.skill.terminal-opener` | skill | `git-sha1:511f4234ce7e9e122a9cd2a7d90a0dad7cedc549` | Published ([1][release-1]) |
| `ecc.skill.terminal-ops` | skill | `git-sha1:d560cec0951bb85b08b01c388ebcf7f2299cf3cb` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.terraform-patterns` | skill | `git-sha1:227d27cfa89f802f97bee348de282d167ebc30f2` | Pending |
| `ecc.skill.test-collaboration` | skill | `git-sha1:4b9f00244b7d2b7e8bc99ca4ec160c7b9cc2e4c6` | Pending |
| `ecc.skill.test-coverage` | skill | `git-sha1:94476afc97b172c6749cc65abc71b5983f745acb` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.tinystruct-patterns` | skill | `git-sha1:58d5355dbd3e810f0e98f2c233a20daa4f5fbb3d` | Pending |
| `ecc.skill.token-budget-advisor` | skill | `git-sha1:9b133e1e12a07c73d297f4865b2638ec40550f41` | Pending |
| `ecc.skill.token-card` | skill | `git-sha1:6112a84afa9680023f4101dcb4192e67be9d64ef` | Pending |
| `ecc.skill.typescript-patterns` | skill | `git-sha1:17645d0bb211c5efded3e00d649ac3ab6356b81e` | Pending |
| `ecc.skill.ui-canvas` | skill | `git-sha1:e60b84f2f822937e4cf16e5c3f6c9b5c76bc57d4` | Pending |
| `ecc.skill.ui-demo` | skill | `git-sha1:547dacf6a9bac67280c0e14b84f2d94fd9ed0490` | Published ([1][release-1]) |
| `ecc.skill.ui-to-vue` | skill | `git-sha1:e73fec1365ab3eb0a2b95a4a3bccfe0c0b229c60` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.uncloud` | skill | `git-sha1:23861a21f75f0d0231064c54466181cebe8d12c9` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.unified-memory` | skill | `git-sha1:ceca05fd06baf5c051e2068f1573db8568a5df9c` | Pending |
| `ecc.skill.unified-notifications-ops` | skill | `git-sha1:7169f943de9d60446adacc5e2414b81902a919a0` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.update-codemaps` | skill | `git-sha1:a25b57cc711c19faed34842c2892ab8776c7cad4` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.update-docs` | skill | `git-sha1:3c70bceefe63d0d6f0763572a554bf8d78e76a77` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.verification-loop` | skill | `git-sha1:39868fe42ac9cfbda008f2428744baf4904702e7` | Pending |
| `ecc.skill.verification-loop@kiro` | Edition | `git-sha1:8335c727c42ffd29f98a255760200508e78f2048` | Pending |
| `ecc.skill.video-editing` | skill | `git-sha1:f5459a91f7d8670c807c4e95b72ad8f0b4c48848` | Pending |
| `ecc.skill.videodb` | skill | `git-sha1:e91b449bab5d42b0ec9413e13f4772678f683e20` | Pending |
| `ecc.skill.visa-doc-translate` | skill | `git-sha1:1a1ef042f257be055220280876da7981e27ec097` | Pending |
| `ecc.skill.vite-patterns` | skill | `git-sha1:7163274f4f95b4247af61bf02e0ecd9348fd0091` | Published ([1][release-1]) |
| `ecc.skill.vue-patterns` | skill | `git-sha1:a49423adce6e0dd29a1fc8de7b3b73dd0ec326ad` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.vue-review` | skill | `git-sha1:0de34bde55feeb4bb9240eb11c1851e4248a16e5` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.web-perimeter-owasp-2025-audit` | skill | `git-sha1:6b68cbe2ec27e137e4dc4c625a5f98eed51c79c8` | Pending |
| `ecc.skill.windows-desktop-e2e` | skill | `git-sha1:2b4ca69e40cbdb24c6a9e6be9958e334b3640c2c` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.workspace-surface-audit` | skill | `git-sha1:cb171c84727d1419c5155a251b750caf5454188e` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.x-api` | skill | `git-sha1:77d5c4da7e79eed794072846ecc2243035952bbe` | Published ([1][release-1], [2][release-2]) |
| `ecc.skill.yoruba-localization-testing` | skill | `git-sha1:7596c11bc8265a4d363523fa2a182d977d43b403` | Pending |

### egm

| Catalog reference | Kind | Scan key | Report availability |
| --- | --- | --- | --- |
| `egm.agent.bootstrap_orchestrator` | agent | `git-sha1:826c3309369c05e95a912b040f49fe25c11d813b` | Published ([1][release-1], [2][release-2]) |
| `egm.agent.codebase_details` | agent | `git-sha1:8f70df1662ab41b9d9b1ec4d9193d0f32b67ab75` | Published ([1][release-1], [2][release-2]) |
| `egm.agent.comprehension` | agent | `git-sha1:17c18ce0ec15090aa9a1b1e558328bb7ca18189b` | Published ([1][release-1], [2][release-2]) |
| `egm.agent.design_critic` | agent | `git-sha1:595150172ef31fc8018fc1e0a36440bb156a121c` | Published ([1][release-1], [2][release-2]) |
| `egm.agent.implementation_readiness` | agent | `git-sha1:3495e497e5cc0e4dd35f51223a31922a6d067b5c` | Published ([1][release-1], [2][release-2]) |
| `egm.agent.inventive_catalyst` | agent | `git-sha1:9f340167e48b686025e539ff2cff73302198e247` | Pending |
| `egm.agent.structural` | agent | `git-sha1:1942b9a74a78b3d27210f11a9ba39ffcd7bebc5b` | Published ([1][release-1], [2][release-2]) |
| `egm.agent.style` | agent | `git-sha1:a20868f93a70d26de134c1315e2b900f594affc0` | Pending |
| `egm.agent.synthesizer` | agent | `git-sha1:93d0c43e9d8ebeb4b17d35a5979a1753b89d0ce7` | Pending |
| `egm.agent.zoom_out` | agent | `git-sha1:1928b9e5addd231ddf51f8fb95ed75877df5fcc3` | Published ([1][release-1], [2][release-2]) |
| `egm.skill.egm-bootstrap` | skill | `git-sha1:c41ca36bcacc1f2073e8215fcd27c7096ede4bca` | Pending |
| `egm.skill.egm-brainstorm` | skill | `git-sha1:b63d7e40a5cf63d8fd2d9e6491f741c1f7931810` | Pending |
| `egm.skill.egm-draft` | skill | `git-sha1:738b61a0ebb2bc0f36431f0ab9bc5f2237cf0727` | Pending |
| `egm.skill.egm-drift-report` | skill | `git-sha1:ad6637cce6888a85b8f7f489495e7ac3f81774b1` | Published ([1][release-1], [2][release-2]) |
| `egm.skill.egm-lite` | skill | `git-sha1:9457ad9d9c8a52c0b004541866db587bf4316b6b` | Pending |
| `egm.skill.egm-resolve` | skill | `git-sha1:74c82d2a52a4b183d1f046127b0312d454d6c43e` | Pending |
| `egm.skill.egm-review` | skill | `git-sha1:3c148d5d74ffa0421c6fe54e1fd0ec8e2412c715` | Pending |
| `egm.skill.egm-review-loop` | skill | `git-sha1:dec215a584f2f9d00a2b62edd5bc210ec218dee1` | Pending |
| `egm.runtime` | Bundle | `git-sha1:c23c36c74e5bac71422bfabc4c2d09d6793421de` | Pending |
| `egm.plugin./` | Plugin | `git-sha1:236997cf020f877ebdd7344b9a6bd7694d642d2b` | Pending |
| `egm.plugin./:full-folder` | Full plugin folder | `git-sha1:327b35f4fb73dfa293c5cff9159a254ed251ee8c` | Pending |

### extensions

| Catalog reference | Kind | Scan key | Report availability |
| --- | --- | --- | --- |
| `extensions.agent.code-reviewer` | agent | `git-sha1:fab5e70d576cdbcc39e7f0e69c66e472f019dcde` | Published ([1][release-1], [2][release-2]) |
| `extensions.agent.security-auditor` | agent | `git-sha1:c87fa911910bc9679949fae20ff659bd942529fa` | Published ([1][release-1], [2][release-2]) |
| `extensions.agent.test-engineer` | agent | `git-sha1:98c3780ed26b55cc8f9a52a51787a614237d3858` | Published ([1][release-1], [2][release-2]) |
| `extensions.agent.web-performance-auditor` | agent | `git-sha1:1bfb38607bf842f2fc35db832378a538d02e5340` | Published ([1][release-1], [2][release-2]) |
| `extensions.hook.git-guard` | hook | `git-sha1:29b7a0f497afb50755d422fefe61c717dc5a0c44` | Published ([1][release-1], [2][release-2]) |
| `extensions.hook.git-guard@claude-code` | Edition | `git-sha1:29b7a0f497afb50755d422fefe61c717dc5a0c44` | Published ([1][release-1], [2][release-2]) |
| `extensions.hook.lanes-card` | hook | `git-sha1:2dff03c1d2ecf0f59ad86d3066425ab81ca825c4` | Published ([1][release-1], [2][release-2]) |
| `extensions.hook.lanes-card@claude-code` | Edition | `git-sha1:2dff03c1d2ecf0f59ad86d3066425ab81ca825c4` | Published ([1][release-1], [2][release-2]) |
| `extensions.hook.skill-guard` | hook | `git-sha1:b69e7b6b2fb8bcf9b80c2b18802cd51b30b7e5a9` | Published ([1][release-1], [2][release-2]) |
| `extensions.hook.skill-guard@claude-code` | Edition | `git-sha1:b69e7b6b2fb8bcf9b80c2b18802cd51b30b7e5a9` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.api-and-interface-design` | skill | `git-sha1:4e835261416b3f4bdfae4ba892afc5d4db72bb50` | Pending |
| `extensions.skill.ask-sam` | skill | `git-sha1:a3f4e6004e12e3ad46880d4402e000d046c22cb6` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.browser-testing-with-devtools` | skill | `git-sha1:2b5c415e088d6869d4d1b0a6aa44efab77de8ae3` | Pending |
| `extensions.skill.ci-cd-and-automation` | skill | `git-sha1:27caf0b9f1adad14446c95155c30256c7c9cfb81` | Pending |
| `extensions.skill.code-simplification` | skill | `git-sha1:20b75b007ac2122c142eca762bbd952d682fe05c` | Pending |
| `extensions.skill.constraint-driven-development` | skill | `git-sha1:057f91b66dad4c01e1a417c219844a843bdd268c` | Pending |
| `extensions.skill.deprecation-and-migration` | skill | `git-sha1:f13af0801a7c62de84284dc304c1469f22c4af90` | Pending |
| `extensions.skill.documentation-and-adrs` | skill | `git-sha1:c5ce77d37323e9a02f0530e6007fb64e576ec2ff` | Pending |
| `extensions.skill.doubt-driven-development` | skill | `git-sha1:edc2e8c32cca8d7cacd2390235458b29a000f9cb` | Pending |
| `extensions.skill.engineering.ask-matt` | skill | `git-sha1:d6a0d9bf3cdc78cbfcbd6466ac5fd3deffb52877` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.engineering.code-review` | skill | `git-sha1:a8ef561571acbb611de8ff19ba6da75b197c63a8` | Pending |
| `extensions.skill.engineering.codebase-design` | skill | `git-sha1:4cbe1c131e1ea54109cb1e4e5f3c505810db6606` | Pending |
| `extensions.skill.engineering.diagnosing-bugs` | skill | `git-sha1:5fdd6cc53385395441910b026c72d71768e993d4` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.engineering.domain-modeling` | skill | `git-sha1:db8ef024fb9a7b2022d57289359ae96cff0d8483` | Pending |
| `extensions.skill.engineering.grill-with-docs` | skill | `git-sha1:eedaf2562c83155115e9c649fa3ecaac2e10e81d` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.engineering.implement` | skill | `git-sha1:4804b466ab26c9b9d8d42917547db133d1f20a9f` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.engineering.implement-spec` | skill | `git-sha1:407c196f5c88af53c71efc8f31ee37c02dbb12e7` | Pending |
| `extensions.skill.engineering.improve-codebase-architecture` | skill | `git-sha1:587147dd230da299cc5e84971cb0a33f6676f8a6` | Pending |
| `extensions.skill.engineering.pr` | skill | `git-sha1:00b896d811adffad747c7ca30078d909d60c7f93` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.engineering.prototype` | skill | `git-sha1:e41d92e171f074a2b6887d8f6faca4a15c83d1ca` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.engineering.research` | skill | `git-sha1:2f8f36af48796faed5c687c75bb650071631a984` | Pending |
| `extensions.skill.engineering.retro` | skill | `git-sha1:335c1862a43da9d629abafdb79ca0c0de118be08` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.engineering.setup-matt-pocock-skills` | skill | `git-sha1:b644b684781fd5baae57f6be000a180a4d4448d7` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.engineering.tdd` | skill | `git-sha1:667dbdd00c09d0e2189e082986e6a4d61a67c2a6` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.engineering.to-spec` | skill | `git-sha1:136b9651747cfccbfbb7c50a6b0dfb757e7547d2` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.engineering.to-tickets` | skill | `git-sha1:2dee20ad722a31c04ededf9f2d83842473573045` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.engineering.triage` | skill | `git-sha1:4cb951d62ecccaed601cdc5f9a1b7b3d8a799635` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.engineering.wayfinder` | skill | `git-sha1:25da74eadc3e388b2f2a2cc716f3d44b2fb9dfe0` | Pending |
| `extensions.skill.engineering.wizard` | skill | `git-sha1:e396d3ba97c723a78ffd350fb14a3c409137b306` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.frontend-ui-engineering` | skill | `git-sha1:0975709943628688b080aa4faeb14ecb888bab4b` | Pending |
| `extensions.skill.git-workflow-and-versioning` | skill | `git-sha1:f54b12d2cf825961b877d77248f828c358e32bf4` | Pending |
| `extensions.skill.idea-refine` | skill | `git-sha1:d9c1b0df817fe4c358c4a03eec0b5157f3f32d9e` | Pending |
| `extensions.skill.in-progress.chief-of-staff` | skill | `git-sha1:8fc1744b18b8c241fc6ec6f633d9c701e9be58cf` | Pending |
| `extensions.skill.in-progress.claude-handoff` | skill | `git-sha1:57d198aca08eddccb113632d52c6c13f1f3066ac` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.in-progress.loop-me` | skill | `git-sha1:a0dfdc3562686d920900973b50289b36e2f7eafe` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.in-progress.setup-ts-deep-modules` | skill | `git-sha1:b32508a8a7d62c07d32d7c5cff84d357719def7f` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.in-progress.software-factory` | skill | `git-sha1:6562f61d6af157b109e7e1f61f670966d62218de` | Pending |
| `extensions.skill.in-progress.writing-beats` | skill | `git-sha1:3a28fb076fdaaec0927080718abb98fc0f340011` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.in-progress.writing-fragments` | skill | `git-sha1:98e500e0097ec80f52f6a024c5a2ff6d15235bdb` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.in-progress.writing-shape` | skill | `git-sha1:ac92229646fccf7315ae139c37b479b3790617f2` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.install-commit-gate` | skill | `git-sha1:a7399efe3bd875c2361b868a53a54f505e7da024` | Pending |
| `extensions.skill.misc.git-guardrails-claude-code` | skill | `git-sha1:ceed97af09633b300826d0ca0b1464c527ec9a35` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.misc.migrate-to-shoehorn` | skill | `git-sha1:0aea91a3599a4bf7aeec17e3262d4cbcfcbeec23` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.misc.scaffold-exercises` | skill | `git-sha1:44a0ee332b9d67ebbd59389c7eb4e5aff1ce845c` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.observability-and-instrumentation` | skill | `git-sha1:0926add84105ce5224e4837fcea79ffb226b2edd` | Pending |
| `extensions.skill.performance-optimization` | skill | `git-sha1:48db329b74d2cafb1a0354015770126fc1e9c870` | Pending |
| `extensions.skill.productivity.grill-me` | skill | `git-sha1:3df14e2d3a89459bf300614be9247e3ce74798f8` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.productivity.grilling` | skill | `git-sha1:f551b6e0d219fdda0b6abf277f8f915b3127d1e9` | Pending |
| `extensions.skill.productivity.handoff` | skill | `git-sha1:ce24892bd2d4b9e7fd5ac9b95c03175e18bef388` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.productivity.teach` | skill | `git-sha1:3fd617b610e59acbb99644de1ef37e394ff53cd1` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.productivity.to-questionnaire` | skill | `git-sha1:46dfbeeba12a9e52eef446676f42e7551023d9a9` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.productivity.wait-what` | skill | `git-sha1:c8b050e6b8c711be1a9008ceacb2126914f0763e` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.productivity.writing-for-agents` | skill | `git-sha1:ad2925850efb8973a72d2e666f7a975f9a2d4a9b` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.security-and-hardening` | skill | `git-sha1:51f06b2ec4ca7a12c6144a88fc7fa185b00a152d` | Pending |
| `extensions.skill.setup-pre-commit` | skill | `git-sha1:bda12eed91c23f40a242b60f4dcb4f478a650c7e` | Published ([1][release-1], [2][release-2]) |
| `extensions.skill.ship` | skill | `git-sha1:9733365410a9152a16d407de974fb8e82546b551` | Pending |
| `extensions.skill.shipping-and-launch` | skill | `git-sha1:42334dc997200fd8ef9dca687ed3aca3b2b6ad51` | Pending |
| `extensions.skill.source-driven-development` | skill | `git-sha1:99a03b47577a85461493f83f5cf95d3b300073ff` | Pending |
| `extensions.skill.webperf` | skill | `git-sha1:d74132b937fdbc17699fd746fb371080b5df91ab` | Pending |
| `extensions.references` | Bundle | `git-sha1:293f12b0fb992548d1c4fc450d8f2fee46cb844d` | Pending |

### gstack

| Catalog reference | Kind | Scan key | Report availability |
| --- | --- | --- | --- |
| `gstack.skill.autoplan` | skill | `git-sha1:164a96eeb55af74a5b03307f76abaafb6285c99d` | Pending |
| `gstack.skill.benchmark` | skill | `git-sha1:04588d5a56e0135b0ed68ae7468b849c4230fbd5` | Pending |
| `gstack.skill.benchmark-models` | skill | `git-sha1:386dcc333d5b81ba7d752b70b84504b57b07a782` | Pending |
| `gstack.skill.browse` | skill | `git-sha1:8820904f225a771ed5f1f8b2f316c2a1b6188739` | Pending |
| `gstack.skill.build-check` | skill | `git-sha1:d830eacbc7018a994efd5970a68dd16293978317` | Pending |
| `gstack.skill.canary` | skill | `git-sha1:4cd2e2e98142e9a399c8038bc5ebba767ad501be` | Pending |
| `gstack.skill.captain` | skill | `git-sha1:41858e11680e682e26d7373d7d964363fec9465a` | Pending |
| `gstack.skill.careful` | skill | `git-sha1:31fed616a82c0820144d0d15c96498b94c934a27` | Pending |
| `gstack.skill.codex` | skill | `git-sha1:643403e182899a2909a1a8a8071879c3035f89bd` | Pending |
| `gstack.skill.context-restore` | skill | `git-sha1:e81bab8df6f246074a6b913464964603c91a21d1` | Pending |
| `gstack.skill.context-save` | skill | `git-sha1:9c699f40f1ca78695a95e3da4110569b16ef6090` | Pending |
| `gstack.skill.design-consultation` | skill | `git-sha1:f2557d71ab2318d471af5f7bd6b328b6e2276175` | Pending |
| `gstack.skill.design-html` | skill | `git-sha1:f11d3c88af97e7dd6ce322df8a0ce20f02f7d0c3` | Pending |
| `gstack.skill.design-motion` | skill | `git-sha1:dc6af3d7d7d616621ecd87fecc14de1a83e7fc44` | Pending |
| `gstack.skill.design-review` | skill | `git-sha1:e02302154cb596616b22abbd64b486adc62c9eab` | Pending |
| `gstack.skill.design-shotgun` | skill | `git-sha1:3bdc637156940b1963bd192c9b1b11512d2ad04d` | Pending |
| `gstack.skill.deslop-shared-libs` | skill | `git-sha1:cef5a3e87f0d8e62448e1e4193534c56fc46374c` | Pending |
| `gstack.skill.devex-review` | skill | `git-sha1:ffcbdf072a07456985e585d49229798823481878` | Pending |
| `gstack.skill.diagram` | skill | `git-sha1:68679ec211ddb5bc76ee9d307c2a9b6f78080dd4` | Pending |
| `gstack.skill.document-generate` | skill | `git-sha1:0c57753bf75383d167ce1531c9f138d3af98f6d8` | Pending |
| `gstack.skill.document-release` | skill | `git-sha1:b639c91c314b95f1a4a68fd3f477c8f3804f416d` | Pending |
| `gstack.skill.eval-plan` | skill | `git-sha1:809412054cf1aa440e87877a1392a85f4300ac9a` | Pending |
| `gstack.skill.freeze` | skill | `git-sha1:728c000fd142059725fe36fb2d8bd4411ec50042` | Pending |
| `gstack.skill.gstack-upgrade` | skill | `git-sha1:fa27832747823b3098f7887fdb9a702b80c3329a` | Pending |
| `gstack.skill.guard` | skill | `git-sha1:915ea8086651d8beafa7c288054878d42fe9312b` | Pending |
| `gstack.skill.health` | skill | `git-sha1:d71beca23aca4808852f357ad98b8dfbec6e4ba7` | Pending |
| `gstack.skill.ios-clean` | skill | `git-sha1:6eef50c0cc9c0b6cc9d0d0b27dd1bd8ac0b32058` | Pending |
| `gstack.skill.ios-design-review` | skill | `git-sha1:f52a078979ee72de4fa31bc7636885b203a8d950` | Pending |
| `gstack.skill.ios-fix` | skill | `git-sha1:95d43f575ed35bbc3fba5f5122cfecb0ef5b2bce` | Pending |
| `gstack.skill.ios-qa` | skill | `git-sha1:3bc1e498c68b5c52fec55fefaa7386c83cce82d3` | Pending |
| `gstack.skill.ios-sync` | skill | `git-sha1:df93433f70b99e0bd9ea5f7c0f747c45559e036d` | Pending |
| `gstack.skill.land-and-deploy` | skill | `git-sha1:9424e3ed56edff4bcafaa3e2d4ecbbcf548eb135` | Pending |
| `gstack.skill.landing-report` | skill | `git-sha1:8ff2dec5beb0e80a6516d77debf06a5b9ebd2463` | Pending |
| `gstack.skill.learn` | skill | `git-sha1:fec47e5e284a86dac156e9de6cf39029aee4213e` | Pending |
| `gstack.skill.make-pdf` | skill | `git-sha1:030e822ccb0674018f1ca52b8cb7a3495541cbb0` | Pending |
| `gstack.skill.modernize` | skill | `git-sha1:1b4c9a421c0a2fb566e95f33bc6b23a40df7b287` | Pending |
| `gstack.skill.office-hours` | skill | `git-sha1:bcccb1e76f64ae4e0e80e1a8ac3fc39fd6ff7a02` | Pending |
| `gstack.skill.open-gstack-browser` | skill | `git-sha1:11c5c8ffd8126e2be9cc60ac422f5572576b08a3` | Pending |
| `gstack.skill.pair-agent` | skill | `git-sha1:5630110fce0e847a90e88c89e2ab8aaf3baf78bc` | Pending |
| `gstack.skill.plan-ceo-review` | skill | `git-sha1:62e6e5b0410e83cdf06c50554b8d69a1b9f22aff` | Pending |
| `gstack.skill.plan-design-review` | skill | `git-sha1:0df245f44480026e5f7d4fe971a496bedb9f0d2e` | Pending |
| `gstack.skill.plan-devex-review` | skill | `git-sha1:5c14cbad72cdea90c7462159edb13792344ac6df` | Pending |
| `gstack.skill.plan-eng-review` | skill | `git-sha1:e443f88a2c2dc12722a843db301ac26b09c0c7a7` | Pending |
| `gstack.skill.plan-tune` | skill | `git-sha1:d8f658278a109920fab584ca0710e383582437ad` | Pending |
| `gstack.skill.qa` | skill | `git-sha1:5019f048766733cd491fe27aed76569d3887be06` | Pending |
| `gstack.skill.qa-only` | skill | `git-sha1:62a1235c736f3f96eff0bec6774362bfece98f5f` | Pending |
| `gstack.skill.retro` | skill | `git-sha1:81f360e8c970f5cc820c41928b9c6274da48d51d` | Pending |
| `gstack.skill.review` | skill | `git-sha1:fd99cd9fe232c2c0daa584967cc5f9ae44ec1cb6` | Pending |
| `gstack.skill.runaway-stopper` | skill | `git-sha1:6dc3bad3acec4efed3d25928d3914b54f297dab2` | Pending |
| `gstack.skill.scrape` | skill | `git-sha1:78a639a6464d008d528d1f5b8eb74df9981e5fc6` | Pending |
| `gstack.skill.setup-browser-cookies` | skill | `git-sha1:bf4cffa1fee5aa14750f367adb8111fe86458710` | Pending |
| `gstack.skill.setup-deploy` | skill | `git-sha1:4ff349b4c5439f7b62a40e7464612b8cab2a897e` | Pending |
| `gstack.skill.setup-gbrain` | skill | `git-sha1:030eb3ffa9957e407f8e5c3149de282e6986bc5e` | Pending |
| `gstack.skill.ship` | skill | `git-sha1:4a3cef94fcf73cf525a8f231e3662777054fbfee` | Pending |
| `gstack.skill.skillify` | skill | `git-sha1:ab649289149ae831cbfec358788b66b39fa2c4a0` | Pending |
| `gstack.skill.spec` | skill | `git-sha1:aeee2733ab64798a22b488ed25c8c601b730443a` | Pending |
| `gstack.skill.sync-gbrain` | skill | `git-sha1:8b2804f1df4e5eb09082a10b24ec8bdb291710f9` | Pending |
| `gstack.skill.test-audit` | skill | `git-sha1:9d697ea662542f8cbed02b256e1c7c6d4c60e8ae` | Pending |
| `gstack.skill.ubicloud` | skill | `git-sha1:54cd91637a8c3626718d1f450a0d428e131c9145` | Pending |
| `gstack.skill.unfreeze` | skill | `git-sha1:abdf4541ab2cc0ad97517519bb2c17318a15f08c` | Pending |
| `gstack.skill.write-skill` | skill | `git-sha1:00bf50d4b02f127550d9cb31fc384d2c7bae9f5b` | Pending |

### guide

| Catalog reference | Kind | Scan key | Report availability |
| --- | --- | --- | --- |
| `guide.agent.aih-guide` | agent | `git-sha1:71f5cfc560801b4ff47e09c20e07e259bd4814b4` | Published ([1][release-1], [2][release-2]) |
| `guide.agent.aih-guide@kimi` | Edition | `git-sha1:c65b2bab3d7ecc24cb0104bfa3115f1e166ab610` | Published ([1][release-1], [2][release-2]) |
| `guide.agent.aih-guide@opencode` | Edition | `git-sha1:47c0ba3ded00d97ba4ef920e6663d2ba075d0596` | Published ([1][release-1], [2][release-2]) |
| `guide.document.manual` | document | `git-sha1:b569f74cfb3f0f30c035adb897cffe54fe73edc9` | Published ([1][release-1], [2][release-2]) |

### modern-web-guidance

| Catalog reference | Kind | Scan key | Report availability |
| --- | --- | --- | --- |
| `modern-web-guidance.skill.chrome-extensions` | skill | `git-sha1:70ae21f9bbccb4d97c2748dffcc227f9ed07c6cf` | Pending |
| `modern-web-guidance.skill.modern-web-guidance` | skill | `git-sha1:94cd548883b7cd735ee0d2bdd723c68a212a0933` | Pending |

### project-basics

| Catalog reference | Kind | Scan key | Report availability |
| --- | --- | --- | --- |
| `project-basics.document.rule-router` | document | `git-sha1:dc568b521089c6519a42ee9b13b198330ced31c3` | Published ([1][release-1], [2][release-2]) |
| `project-basics.rule.agent-behavior-core` | rule | `git-sha1:22a533c372bdcb2351fac3883ac39c77606211f4` | Published ([1][release-1], [2][release-2]) |
| `project-basics.rule.shared-block` | rule | `git-sha1:559594bb6689bf083efbd60247742bffc4a9b51c` | Published ([1][release-1], [2][release-2]) |

### pstack

| Catalog reference | Kind | Scan key | Report availability |
| --- | --- | --- | --- |
| `pstack.agent.comment-sicko` | agent | `git-sha1:980a0de894034dd946310cf51904e69bb0bdf999` | Pending |
| `pstack.agent.comment-sicko@claude-code` | Edition | `git-sha1:980a0de894034dd946310cf51904e69bb0bdf999` | Pending |
| `pstack.agent.poteto-agent` | agent | `git-sha1:735cb46b98d025e53aef430561389879d9f95857` | Pending |
| `pstack.agent.poteto-agent@claude-code` | Edition | `git-sha1:735cb46b98d025e53aef430561389879d9f95857` | Pending |
| `pstack.skill.architect` | skill | `git-sha1:c251a8599b9d9bb90d366eae92f542ba3fe5c773` | Pending |
| `pstack.skill.architect@claude-code` | Edition | `git-sha1:92dfa67297ef9fdb77a1f2a11825e861e1789fd6` | Pending |
| `pstack.skill.arena` | skill | `git-sha1:817d869a7b0080e9c13871da8fa7166a70ff496a` | Pending |
| `pstack.skill.arena@claude-code` | Edition | `git-sha1:5c95af84a2a5e97ea915a32f9af2031fe16e7781` | Pending |
| `pstack.skill.automate-me` | skill | `git-sha1:de8885f352a7d778a560ea34d203fc3ab5b7055a` | Pending |
| `pstack.skill.automate-me@claude-code` | Edition | `git-sha1:c5bbf235eb339c05f4b66a4786d205eb95c65121` | Pending |
| `pstack.skill.benchmark-checklist` | skill | `git-sha1:95621ebe5e1571f3689186adc741c2de2ab96552` | Pending |
| `pstack.skill.benchmark-checklist@claude-code` | Edition | `git-sha1:95621ebe5e1571f3689186adc741c2de2ab96552` | Pending |
| `pstack.skill.blast-radius` | skill | `git-sha1:88d9b57545971959dd93878d6c6ac7f3a84737b8` | Pending |
| `pstack.skill.blast-radius@claude-code` | Edition | `git-sha1:88d9b57545971959dd93878d6c6ac7f3a84737b8` | Pending |
| `pstack.skill.bro` | skill | `git-sha1:53c3b2c5dc11fe0ee4156468da27505df9239dc6` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.bro@claude-code` | Edition | `git-sha1:53c3b2c5dc11fe0ee4156468da27505df9239dc6` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.correct` | skill | `git-sha1:5ebee6f7fe9cd7f97b1c698dbbf4f19ed8c4c5f4` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.correct@claude-code` | Edition | `git-sha1:5ebee6f7fe9cd7f97b1c698dbbf4f19ed8c4c5f4` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.create-formal-verification-skill` | skill | `git-sha1:091f2a26d46f7bed511d0532a1329532a45899e0` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.create-formal-verification-skill@claude-code` | Edition | `git-sha1:3613621dde8263041abd42bce695726193da1991` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.create-verification-skill` | skill | `git-sha1:5aa2dae2726d09d219397fbbedc1e9500a239d28` | Published ([1][release-1]) |
| `pstack.skill.create-verification-skill@claude-code` | Edition | `git-sha1:1ccf2d6f2f4c1bec790ed3105a55d8a5fce5b173` | Published ([1][release-1]) |
| `pstack.skill.figure-it-out` | skill | `git-sha1:cf79a57fddc5869cda3cf8a4e18e2d0fd041a447` | Pending |
| `pstack.skill.figure-it-out@claude-code` | Edition | `git-sha1:9a76b799a36b0a55ec422ebd1b24e2bc2c89153d` | Pending |
| `pstack.skill.how` | skill | `git-sha1:9c370cd686f570877a24997e9ccfba0f49096f00` | Pending |
| `pstack.skill.how@claude-code` | Edition | `git-sha1:552ab68d6da62e91294091da82c20f68b9c1e53b` | Pending |
| `pstack.skill.in-your-own-words` | skill | `git-sha1:e5ff93020dd4ed33b80d9df9a235d1945c676a0d` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.in-your-own-words@claude-code` | Edition | `git-sha1:e5ff93020dd4ed33b80d9df9a235d1945c676a0d` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.interrogate` | skill | `git-sha1:3a49e73a4ffd56f682288dd145be9345bfec7434` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.interrogate@claude-code` | Edition | `git-sha1:6f150e30627fd8ee395f4c5860c50d1acde7bc15` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.ketchup` | skill | `git-sha1:01c36585506764e9b40b2bfb165a9943b403b158` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.ketchup@claude-code` | Edition | `git-sha1:01c36585506764e9b40b2bfb165a9943b403b158` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.ketchup-video` | skill | `git-sha1:73f013af52a35306c4bb5b484dae72bf1c8f9edd` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.ketchup-video@claude-code` | Edition | `git-sha1:73f013af52a35306c4bb5b484dae72bf1c8f9edd` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.maintain-formal-verification-skill` | skill | `git-sha1:0b843c90b8b04a639dbd86fec9795610374715f2` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.maintain-formal-verification-skill@claude-code` | Edition | `git-sha1:8690a0d54b535770e5406d641a222e0ff8b9f07c` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.maintain-verification-skill` | skill | `git-sha1:b6ce4dcdc378492f9acd55a4e56ae111204b4f11` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.maintain-verification-skill@claude-code` | Edition | `git-sha1:958fcc735f9f15e18907cf00831160bbcde0b534` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.make-bot-ui` | skill | `git-sha1:1645159d827f9adea7a9270082368eb1599927b8` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.make-bot-ui@claude-code` | Edition | `git-sha1:1932e2e8b1f6a97b47a8df63f87714aba7fcb620` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.no-comments` | skill | `git-sha1:6708dc37f8e2695b0063a60e06dcdc451eed5355` | Pending |
| `pstack.skill.no-comments@claude-code` | Edition | `git-sha1:165b06ad43311429a06bcfacd77bbb86b7091e0f` | Pending |
| `pstack.skill.poteto-help` | skill | `git-sha1:0383e936c0fbd08d14c27f2cf5a1becd6f60df3f` | Pending |
| `pstack.skill.poteto-help@claude-code` | Edition | `git-sha1:12de64791b2e18368982e7becfe350a1c2b09e23` | Pending |
| `pstack.skill.poteto-mode` | skill | `git-sha1:959f29ba207dac9e9f733499a9cd88a9aa4dbae1` | Pending |
| `pstack.skill.poteto-mode@claude-code` | Edition | `git-sha1:0a9b15956452bc4c5c1a687a125bdc5b2a7fc23a` | Pending |
| `pstack.skill.principle-attack-the-premise` | skill | `git-sha1:c82bc65197a802bce740f4a65d39e9c600c79013` | Pending |
| `pstack.skill.principle-attack-the-premise@claude-code` | Edition | `git-sha1:c82bc65197a802bce740f4a65d39e9c600c79013` | Pending |
| `pstack.skill.principle-boundary-discipline` | skill | `git-sha1:d7c9f885052de6177eb888c51c22285f4d225278` | Pending |
| `pstack.skill.principle-boundary-discipline@claude-code` | Edition | `git-sha1:d7c9f885052de6177eb888c51c22285f4d225278` | Pending |
| `pstack.skill.principle-build-the-lever` | skill | `git-sha1:12058cceb18fcc376d4d4769f4f6712f1ed28b62` | Pending |
| `pstack.skill.principle-build-the-lever@claude-code` | Edition | `git-sha1:12058cceb18fcc376d4d4769f4f6712f1ed28b62` | Pending |
| `pstack.skill.principle-encode-lessons-in-structure` | skill | `git-sha1:1e42cd4db78cc95d0297dc0264c1a74439c90be9` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-encode-lessons-in-structure@claude-code` | Edition | `git-sha1:1e42cd4db78cc95d0297dc0264c1a74439c90be9` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-exhaust-the-design-space` | skill | `git-sha1:3d93455dc2b3c0d9954e20384ed8569138bd1eb0` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-exhaust-the-design-space@claude-code` | Edition | `git-sha1:3d93455dc2b3c0d9954e20384ed8569138bd1eb0` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-experience-first` | skill | `git-sha1:2dbcf0d0d4473ca3a93d17e2167b587cfec7f6da` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-experience-first@claude-code` | Edition | `git-sha1:2dbcf0d0d4473ca3a93d17e2167b587cfec7f6da` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-explain-the-number` | skill | `git-sha1:8461455edc3b13feef93aba9a600b3af16f4a2f9` | Pending |
| `pstack.skill.principle-explain-the-number@claude-code` | Edition | `git-sha1:8461455edc3b13feef93aba9a600b3af16f4a2f9` | Pending |
| `pstack.skill.principle-fix-root-causes` | skill | `git-sha1:6edd70a10872c757a49aac1d0b7a34e696901ac3` | Pending |
| `pstack.skill.principle-fix-root-causes@claude-code` | Edition | `git-sha1:6edd70a10872c757a49aac1d0b7a34e696901ac3` | Pending |
| `pstack.skill.principle-foundational-thinking` | skill | `git-sha1:49fc29c7f64b8f1e0ed56d2359c53243cc4e37d6` | Pending |
| `pstack.skill.principle-foundational-thinking@claude-code` | Edition | `git-sha1:49fc29c7f64b8f1e0ed56d2359c53243cc4e37d6` | Pending |
| `pstack.skill.principle-guard-the-context-window` | skill | `git-sha1:bf09c18e975ded9dc137631c6529db941dda24a2` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-guard-the-context-window@claude-code` | Edition | `git-sha1:bf09c18e975ded9dc137631c6529db941dda24a2` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-laziness-protocol` | skill | `git-sha1:cb8aa817489838fe615d0dfe321d263e8a3f1faa` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-laziness-protocol@claude-code` | Edition | `git-sha1:cb8aa817489838fe615d0dfe321d263e8a3f1faa` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-make-operations-idempotent` | skill | `git-sha1:8fe8816c3620993245104a14bd83536b4362fda8` | Pending |
| `pstack.skill.principle-make-operations-idempotent@claude-code` | Edition | `git-sha1:8fe8816c3620993245104a14bd83536b4362fda8` | Pending |
| `pstack.skill.principle-migrate-callers-then-delete-legacy-apis` | skill | `git-sha1:cf45195158110569ac6a97d0e8dbed04531373ed` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-migrate-callers-then-delete-legacy-apis@claude-code` | Edition | `git-sha1:cf45195158110569ac6a97d0e8dbed04531373ed` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-minimize-reader-load` | skill | `git-sha1:83722d6d8707f842217b7e1e611b77933c1eb4a8` | Pending |
| `pstack.skill.principle-minimize-reader-load@claude-code` | Edition | `git-sha1:83722d6d8707f842217b7e1e611b77933c1eb4a8` | Pending |
| `pstack.skill.principle-model-the-domain` | skill | `git-sha1:90e1d94729175ce6899cc57e5b0250dbf73de8b4` | Pending |
| `pstack.skill.principle-model-the-domain@claude-code` | Edition | `git-sha1:90e1d94729175ce6899cc57e5b0250dbf73de8b4` | Pending |
| `pstack.skill.principle-never-block-on-the-human` | skill | `git-sha1:d2578043c77706411c48c5b7cfe03dc3d45e3b15` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-never-block-on-the-human@claude-code` | Edition | `git-sha1:d2578043c77706411c48c5b7cfe03dc3d45e3b15` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-outcome-oriented-execution` | skill | `git-sha1:8d87411f36c74111e5e54a804dda727e2c034914` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-outcome-oriented-execution@claude-code` | Edition | `git-sha1:8d87411f36c74111e5e54a804dda727e2c034914` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-prove-it-works` | skill | `git-sha1:71f6ab944f3fc9d5bb9b1b261edfa80ded54b96c` | Pending |
| `pstack.skill.principle-prove-it-works@claude-code` | Edition | `git-sha1:71f6ab944f3fc9d5bb9b1b261edfa80ded54b96c` | Pending |
| `pstack.skill.principle-redesign-from-first-principles` | skill | `git-sha1:20822072ed14c75eed7f527f734c5d347c43845e` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-redesign-from-first-principles@claude-code` | Edition | `git-sha1:20822072ed14c75eed7f527f734c5d347c43845e` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-separate-before-serializing-shared-state` | skill | `git-sha1:15bc5fb33e9b5848d3400857ebeac175044dc6c8` | Pending |
| `pstack.skill.principle-separate-before-serializing-shared-state@claude-code` | Edition | `git-sha1:15bc5fb33e9b5848d3400857ebeac175044dc6c8` | Pending |
| `pstack.skill.principle-sequence-verifiable-units` | skill | `git-sha1:af35037d5f04bacc0654b6e05732d7ca37ff3023` | Pending |
| `pstack.skill.principle-sequence-verifiable-units@claude-code` | Edition | `git-sha1:af35037d5f04bacc0654b6e05732d7ca37ff3023` | Pending |
| `pstack.skill.principle-subtract-before-you-add` | skill | `git-sha1:760f5b131e920c0e9914a0ef8cb4b875918af31a` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-subtract-before-you-add@claude-code` | Edition | `git-sha1:760f5b131e920c0e9914a0ef8cb4b875918af31a` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.principle-test-behavior-not-implementation` | skill | `git-sha1:76d920dd320db21e8e8bc2a316554acfb1d23263` | Pending |
| `pstack.skill.principle-test-behavior-not-implementation@claude-code` | Edition | `git-sha1:76d920dd320db21e8e8bc2a316554acfb1d23263` | Pending |
| `pstack.skill.principle-type-system-discipline` | skill | `git-sha1:5847636501d4a92dc1173a30fc09475fe22fbbca` | Pending |
| `pstack.skill.principle-type-system-discipline@claude-code` | Edition | `git-sha1:84b9a2eb92026202de0f1ca6e51a0bd500ebfe29` | Pending |
| `pstack.skill.recall` | skill | `git-sha1:77a2d24005b6faec04b0e3f3ec88aff401366da0` | Pending |
| `pstack.skill.recall@claude-code` | Edition | `git-sha1:4bc612577c912c7294e17453e8358447691f3583` | Pending |
| `pstack.skill.reflect` | skill | `git-sha1:e55de8143f337465bbbe2a7320065c4c9e7f14fe` | Pending |
| `pstack.skill.reflect@claude-code` | Edition | `git-sha1:9c8e9515ce32a31caf7bfcc98b074d0a14c09ef1` | Pending |
| `pstack.skill.reframe` | skill | `git-sha1:69c91262372cacf9182c0434077c4b8c844a9ebf` | Pending |
| `pstack.skill.reframe@claude-code` | Edition | `git-sha1:69c91262372cacf9182c0434077c4b8c844a9ebf` | Pending |
| `pstack.skill.setup-pstack` | skill | `git-sha1:cf3e8c659fce501f1ca6a442080bf0aebef5a4bd` | Pending |
| `pstack.skill.setup-pstack@claude-code` | Edition | `git-sha1:f6c44cc7f6037aa56204234165a988fa281d08fa` | Pending |
| `pstack.skill.sharpen` | skill | `git-sha1:672ef555c7b4c24b4a5bd016647c5d836a1d6aa6` | Pending |
| `pstack.skill.sharpen@claude-code` | Edition | `git-sha1:672ef555c7b4c24b4a5bd016647c5d836a1d6aa6` | Pending |
| `pstack.skill.show-me-your-work` | skill | `git-sha1:80bcb3fb2a32b128b802ba77b6a67134f7070568` | Pending |
| `pstack.skill.show-me-your-work@claude-code` | Edition | `git-sha1:82a1b9fca7c0fc8e8d8df0a34c934dadfb8cefee` | Pending |
| `pstack.skill.statechart` | skill | `git-sha1:d3d60f78916e8c17a598c39738e45ab419603f06` | Pending |
| `pstack.skill.statechart@claude-code` | Edition | `git-sha1:d3d60f78916e8c17a598c39738e45ab419603f06` | Pending |
| `pstack.skill.swarm` | skill | `git-sha1:926ab8108eab72c37e2e841eaf137a7430146910` | Pending |
| `pstack.skill.swarm@claude-code` | Edition | `git-sha1:b3f1117e2e1f6bdcbb74572b9497f0d608be1d8d` | Pending |
| `pstack.skill.tdd` | skill | `git-sha1:1064da72ceca07bf7f36bddebada585bb59da7bc` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.tdd@claude-code` | Edition | `git-sha1:1064da72ceca07bf7f36bddebada585bb59da7bc` | Published ([1][release-1], [2][release-2]) |
| `pstack.skill.teach` | skill | `git-sha1:f8530de72921e487b8b1e5d53a0f7867d31d6053` | Pending |
| `pstack.skill.teach@claude-code` | Edition | `git-sha1:56dd7444966f3e68a636e730941800956f5ceacb` | Pending |
| `pstack.skill.technical-writing` | skill | `git-sha1:545f2339fc1812c1b8343dec8937054a0dc29155` | Pending |
| `pstack.skill.technical-writing@claude-code` | Edition | `git-sha1:b1befecbc67dbcf6dfef7ed089d657a2f823223b` | Pending |
| `pstack.skill.typescript-best-practices` | skill | `git-sha1:1ccca3c7c0d358c0cd5edd313cd03a31fc75ee5f` | Published ([1][release-1]) |
| `pstack.skill.typescript-best-practices@claude-code` | Edition | `git-sha1:1ccca3c7c0d358c0cd5edd313cd03a31fc75ee5f` | Published ([1][release-1]) |
| `pstack.skill.unslop` | skill | `git-sha1:3319d5baa095167501a128703a008446dd099d0c` | Pending |
| `pstack.skill.unslop@claude-code` | Edition | `git-sha1:3319d5baa095167501a128703a008446dd099d0c` | Pending |
| `pstack.skill.why` | skill | `git-sha1:2608dc2d93794dd7060b826b81b6da0be6bc673c` | Pending |
| `pstack.skill.why@claude-code` | Edition | `git-sha1:2608dc2d93794dd7060b826b81b6da0be6bc673c` | Pending |

### serena

| Catalog reference | Kind | Scan key | Report availability |
| --- | --- | --- | --- |
| `serena.ai-setup.serena` | ai-setup | — | No Scan key |
| `serena.mcp.serena` | mcp | `git-sha1:1b7bb1fe25aadb3dfb27e4dee70be2858d55244d` | Published ([1][release-1], [2][release-2]) |

### superpowers

| Catalog reference | Kind | Scan key | Report availability |
| --- | --- | --- | --- |
| `superpowers.hook.session-start` | hook | `git-sha1:9c048216470164736ae5c783cc2260dfe6c7744c` | Pending |
| `superpowers.hook.session-start@claude-code` | Edition | `git-sha1:9c048216470164736ae5c783cc2260dfe6c7744c` | Pending |
| `superpowers.rule.session-bootstrap` | rule | `git-sha1:4db41ca3ceabadb969b57183b84e04b9ea2ecf98` | Published ([1][release-1], [2][release-2]) |
| `superpowers.skill.brainstorming` | skill | `git-sha1:ebd5b1afb600976b12a4c07fedd9c408c1e82f97` | Pending |
| `superpowers.skill.diagnosing-superpowers` | skill | `git-sha1:effb02c345170011be4470c73b99530de43182a7` | Pending |
| `superpowers.skill.dispatching-parallel-agents` | skill | `git-sha1:15697cb0726c26a66bff737494e8b5266667ba0c` | Published ([1][release-1], [2][release-2]) |
| `superpowers.skill.executing-plans` | skill | `git-sha1:3a8438d91d9340747ffd985fdbcfe7238d6e1e57` | Pending |
| `superpowers.skill.finishing-a-development-branch` | skill | `git-sha1:3b1205aa5038c71946077dd63b9e71b447729e70` | Published ([1][release-1], [2][release-2]) |
| `superpowers.skill.receiving-code-review` | skill | `git-sha1:b5e154fc3ec7a6a0b1e710eebacc2168620cc428` | Published ([1][release-1], [2][release-2]) |
| `superpowers.skill.requesting-code-review` | skill | `git-sha1:f4a6749898702895ea4fd57c7f186cf43205b99a` | Pending |
| `superpowers.skill.subagent-driven-development` | skill | `git-sha1:c04a61186680d4cfc6784136d0421cd4abcfb40c` | Pending |
| `superpowers.skill.systematic-debugging` | skill | `git-sha1:774f23e27e35cb0a89ede39156e7b079fbb84190` | Pending |
| `superpowers.skill.test-driven-development` | skill | `git-sha1:847144cf0824095922c0d4875648b9fa74877e1a` | Published ([1][release-1], [2][release-2]) |
| `superpowers.skill.using-git-worktrees` | skill | `git-sha1:d2b8357b922667a091bfe967840abf5ae84ce99c` | Published ([1][release-1], [2][release-2]) |
| `superpowers.skill.using-superpowers` | skill | `git-sha1:4c777432715fe58984d212a36aedc6a18472e512` | Published ([1][release-1], [2][release-2]) |
| `superpowers.skill.verification-before-completion` | skill | `git-sha1:a4cb0b69aaefeab540947a7f1642bdaad810e37a` | Published ([1][release-1], [2][release-2]) |
| `superpowers.skill.writing-plans` | skill | `git-sha1:cc97fa00eb2ccd4f283e34eb2ba06a48e1e679f7` | Pending |
| `superpowers.skill.writing-skills` | skill | `git-sha1:660ede63b84ce5d07ef28cccc2973165e2ca06e2` | Pending |
| `superpowers.plugin./` | Plugin | `git-sha1:8fddc972a73e9af7501442df0e638d8e29842b6b` | Pending |

### web-artifacts

| Catalog reference | Kind | Scan key | Report availability |
| --- | --- | --- | --- |
| `web-artifacts.skill.web-artifacts-builder` | skill | `git-sha1:82d1a6d3ef045cc89b68c3210e7b5896d67bd11b` | Pending |

## Sources and refresh

- Catalog data revision [`3c1d0dbc5058`](https://github.com/samartomar/aih-catalog/tree/3c1d0dbc50581bee0a682acb1c2183df94f7a2b8/data).
- Release 1 [`scan-catalog-results-20261104-e935f39b9f3148a5`][release-1]. Index SHA-256 `8f26f56299fdcb8ab449f5f045a81e8d445a5bc7cb4a1e5ac7fc1ee23192eb27`.
- Release 2 [`scan-catalog-results-20261125-static-r2-4c41927d737cbb61`][release-2]. Index SHA-256 `3dbccb92bfc9a8d66c4d5162cb612750cf784da5690cc49ff6b2dc2865b3787f`.

The generator checks the index digest and checks that each referenced archive is listed with its expected digest. Its counts track publication. For findings, detector coverage and signature verification, use [Scan's instructions](https://github.com/samartomar/aih-scan#signing-and-verification).

From a current Catalog checkout with Git, Node.js 26 and an authenticated GitHub CLI (`gh`), run the command below. It reads the latest commit that changed the checked-out Catalog data and discovers public Catalog-result releases from Scan. Review the generated diff before committing it.

```sh
node tools/catalog-scan-coverage.mjs --write
```

To reproduce this snapshot, run the same generator with the exact revision and release tags. It prints the Markdown to standard output.

```sh
node tools/catalog-scan-coverage.mjs --catalog 3c1d0dbc50581bee0a682acb1c2183df94f7a2b8 \
  --release scan-catalog-results-20261104-e935f39b9f3148a5 \
  --release scan-catalog-results-20261125-static-r2-4c41927d737cbb61
```

[release-1]: https://github.com/samartomar/aih-scan/releases/tag/scan-catalog-results-20261104-e935f39b9f3148a5
[release-2]: https://github.com/samartomar/aih-scan/releases/tag/scan-catalog-results-20261125-static-r2-4c41927d737cbb61
