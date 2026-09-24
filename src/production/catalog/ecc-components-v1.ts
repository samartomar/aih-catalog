import type { EccModulesSnapshotV1, EccProfilesSnapshotV1 } from "./ecc-snapshots-v1.js";

// Ported from Core 80120883 src/ecc/components.ts: the hand-authored ECC curation.
export type EccComponentId = `${string}:${string}`;
export type EccMcpComponentId = `mcp:${string}`;

export const CORE_ECC_COMPONENTS = [
  "baseline:rules",
  "baseline:agents",
  "baseline:platform",
  "baseline:commands",
  "skill:tdd-workflow",
  "skill:verification-loop",
  "skill:strategic-compact",
  "skill:coding-standards",
  "agent:code-reviewer",
  "agent:code-architect",
  "agent:architect",
  "agent:planner",
  "agent:tdd-guide",
  "agent:build-error-resolver",
  "agent:refactor-cleaner",
  "agent:code-simplifier",
  "agent:silent-failure-hunter",
  "agent:pr-test-analyzer",
  "agent:doc-updater",
  "agent:docs-lookup",
  "agent:code-explorer",
  "agent:security-reviewer",
  "agent:type-design-analyzer",
  "agent:performance-optimizer",
] as const satisfies readonly EccComponentId[];

export const UPSTREAM_CORE_ECC_MODULE_IDS = [
  "rules-core",
  "agents-core",
  "commands-core",
  "hooks-runtime",
  "platform-configs",
  "skill-unified-memory",
  "workflow-quality",
] as const;

/** Backward-compatible name for callers that mean the explicit Core closure. */
export const COMMON_ECC_COMPONENTS = CORE_ECC_COMPONENTS;

const LANGUAGE_COMPONENTS: Readonly<Record<string, readonly EccComponentId[]>> = {
  "TypeScript/Node.js": ["lang:typescript", "agent:typescript-reviewer"],
  "JavaScript/Node.js": ["lang:typescript", "agent:typescript-reviewer"],
  TypeScript: ["lang:typescript", "agent:typescript-reviewer"],
  JavaScript: ["lang:typescript", "agent:typescript-reviewer"],
  Python: ["lang:python", "agent:python-reviewer"],
  Go: ["lang:go", "agent:go-reviewer", "agent:go-build-resolver"],
  Java: ["lang:java", "agent:java-reviewer", "agent:java-build-resolver"],
  Kotlin: ["lang:kotlin", "agent:kotlin-reviewer", "agent:kotlin-build-resolver"],
  Rust: ["lang:rust", "agent:rust-reviewer", "agent:rust-build-resolver"],
  Swift: ["lang:swift", "agent:swift-reviewer", "agent:swift-build-resolver"],
  PHP: ["lang:php", "agent:php-reviewer"],
  Ruby: ["lang:ruby"],
};

const WEB_AGENTS = ["agent:e2e-runner", "agent:a11y-architect"] as const;

const FRAMEWORK_COMPONENTS: Readonly<Record<string, readonly EccComponentId[]>> = {
  React: ["framework:react", "agent:react-reviewer", "agent:react-build-resolver", ...WEB_AGENTS],
  "Next.js": [
    "framework:nextjs",
    "agent:react-reviewer",
    "agent:react-build-resolver",
    ...WEB_AGENTS,
  ],
  Angular: ["framework:angular", ...WEB_AGENTS],
  Vue: ["framework:vue", ...WEB_AGENTS],
  Nuxt: ["framework:nuxt", ...WEB_AGENTS],
  Svelte: ["framework:svelte", ...WEB_AGENTS],
  Django: ["framework:django", "agent:django-reviewer", "agent:django-build-resolver"],
  FastAPI: ["agent:fastapi-reviewer"],
  "Spring Boot": ["framework:springboot", "agent:java-reviewer", "agent:java-build-resolver"],
  Quarkus: ["framework:quarkus"],
  Rails: ["framework:rails"],
  Laravel: ["framework:laravel"],
};

/**
 * What a declarable component pulls in with it. Exported so the authoring
 * surface can state the relation instead of leaving an administrator to
 * discover after the fact that picking a language also brought agents.
 */
export const ECC_DECLARATION_RIDERS: Readonly<Record<string, readonly EccComponentId[]>> = {
  "lang:typescript": ["agent:typescript-reviewer"],
  "lang:python": ["agent:python-reviewer"],
  "lang:go": ["agent:go-reviewer", "agent:go-build-resolver"],
  "lang:java": ["agent:java-reviewer", "agent:java-build-resolver"],
  "lang:kotlin": ["agent:kotlin-reviewer", "agent:kotlin-build-resolver"],
  "lang:rust": ["agent:rust-reviewer", "agent:rust-build-resolver"],
  "lang:cpp": ["agent:cpp-reviewer", "agent:cpp-build-resolver"],
  "lang:php": ["agent:php-reviewer"],
  "lang:csharp": ["agent:csharp-reviewer"],
  "lang:fsharp": ["agent:fsharp-reviewer"],
  "lang:swift": ["agent:swift-reviewer", "agent:swift-build-resolver"],
  "lang:arkts": ["agent:harmonyos-app-resolver"],
  "framework:react": ["agent:react-reviewer", "agent:react-build-resolver", ...WEB_AGENTS],
  "framework:nextjs": ["agent:react-reviewer", "agent:react-build-resolver", ...WEB_AGENTS],
  "framework:angular": [...WEB_AGENTS],
  "framework:django": ["agent:django-reviewer", "agent:django-build-resolver"],
  "capability:database": ["agent:database-reviewer"],
  "capability:machine-learning": ["agent:pytorch-build-resolver", "agent:mle-reviewer"],
};

const DECLARABLE_COMPONENTS = new Set<string>([
  ...COMMON_ECC_COMPONENTS,
  ...Object.values(LANGUAGE_COMPONENTS).flat(),
  ...Object.values(FRAMEWORK_COMPONENTS).flat(),
  ...Object.keys(ECC_DECLARATION_RIDERS),
  ...Object.values(ECC_DECLARATION_RIDERS).flat(),
  "baseline:hooks",
  "baseline:workflow",
  "capability:security",
  "capability:research",
  "capability:content",
  "capability:operators",
  "capability:optimization",
  "capability:prediction-markets",
  "capability:social",
  "capability:media",
  "capability:orchestration",
  "capability:agentic",
  "capability:devops",
  "capability:supply-chain",
  "capability:documents",
  "lang:c",
  "lang:perl",
  "framework:quarkus",
  "framework:rails",
  "framework:laravel",
  "skill:continuous-learning",
  "skill:eval-harness",
  "skill:windows-desktop-e2e",
  "skill:frontend-patterns",
  "skill:backend-patterns",
  "skill:security-review",
  "skill:deep-research",
  "skill:mle-workflow",
]);

const EXPLICIT_MCP_COMPONENTS = new Set<EccMcpComponentId>([
  "mcp:sequential-thinking",
  "mcp:code-review-graph",
  "mcp:codebase-memory-mcp",
  "mcp:github",
  "mcp:context7",
  "mcp:exa",
]);

export const ECC_DECLARABLE_COMPONENT_IDS = [...DECLARABLE_COMPONENTS] as readonly EccComponentId[];

export const ECC_EXPLICIT_MCP_COMPONENT_IDS = [
  ...EXPLICIT_MCP_COMPONENTS,
] as readonly EccMcpComponentId[];

// Ported from Core 80120883 src/ecc/materialize.ts: hand-authored install mapping.
export interface EccComponentInstallDescriptor {
  evidenceComponentId: string;
  containingModuleId: string;
  wholeModules?: readonly string[];
  skills?: readonly string[];
  agents?: readonly string[];
  sourceRoots?: readonly string[];
  agentScaffolding?: boolean;
}

const WHOLE_MODULE_COMPONENTS: Readonly<Record<string, string>> = {
  "baseline:rules": "rules-core",
  "baseline:commands": "commands-core",
  "baseline:hooks": "hooks-runtime",
  "baseline:platform": "platform-configs",
  "baseline:workflow": "workflow-quality",
  "capability:database": "database",
  "capability:security": "security",
  "capability:research": "research-apis",
  "capability:content": "business-content",
  "capability:operators": "operator-workflows",
  "capability:optimization": "optimization-workflows",
  "capability:prediction-markets": "prediction-market-skills",
  "capability:social": "social-distribution",
  "capability:media": "media-generation",
  "capability:orchestration": "orchestration",
  "capability:agentic": "agentic-patterns",
  "capability:devops": "devops-infra",
  "capability:machine-learning": "machine-learning",
  "capability:supply-chain": "supply-chain-domain",
  "capability:documents": "document-processing",
};

const LANGUAGE_SKILLS: Readonly<Record<string, readonly string[]>> = {
  "lang:typescript": ["api-design", "backend-patterns", "frontend-patterns", "nestjs-patterns"],
  "lang:python": ["python-patterns", "python-testing"],
  "lang:go": ["golang-patterns", "golang-testing"],
  "lang:java": ["java-coding-standards"],
  "lang:cpp": ["cpp-coding-standards", "cpp-testing"],
  "lang:c": ["cpp-coding-standards", "cpp-testing"],
  "lang:kotlin": [
    "kotlin-coroutines-flows",
    "kotlin-exposed-patterns",
    "kotlin-ktor-patterns",
    "kotlin-patterns",
    "kotlin-testing",
  ],
  "lang:arkts": [],
  "lang:perl": ["perl-patterns", "perl-testing"],
  "lang:ruby": [],
  "lang:rust": ["rust-patterns", "rust-testing"],
  "lang:csharp": ["csharp-testing", "dotnet-patterns"],
  "lang:fsharp": ["fsharp-testing", "dotnet-patterns"],
  "lang:php": [],
  "lang:swift": [
    "foundation-models-on-device",
    "liquid-glass-design",
    "swift-actor-persistence",
    "swift-concurrency-6-2",
    "swift-protocol-di-testing",
    "swiftui-patterns",
    "ios-icon-gen",
  ],
};

const LANGUAGE_RULES: Readonly<Record<string, readonly string[]>> = {
  "lang:typescript": ["rules/typescript"],
  "lang:python": ["rules/python"],
  "lang:go": ["rules/golang"],
  "lang:java": ["rules/java"],
  "lang:cpp": ["rules/cpp"],
  "lang:c": ["rules/cpp"],
  "lang:kotlin": ["rules/kotlin"],
  "lang:arkts": ["rules/arkts"],
  "lang:perl": ["rules/perl"],
  "lang:ruby": ["rules/ruby"],
  "lang:rust": ["rules/rust"],
  "lang:csharp": ["rules/csharp"],
  "lang:fsharp": ["rules/fsharp"],
  "lang:php": ["rules/php"],
};

const FRAMEWORK_SKILLS: Readonly<Record<string, readonly string[]>> = {
  "framework:angular": ["angular-developer", "frontend-patterns"],
  "framework:react": ["frontend-patterns", "react-patterns", "react-performance", "react-testing"],
  "framework:nextjs": [
    "frontend-patterns",
    "nextjs-turbopack",
    "react-patterns",
    "react-performance",
    "react-testing",
  ],
  "framework:vue": ["frontend-patterns", "ui-to-vue", "vue-patterns"],
  "framework:nuxt": ["frontend-patterns", "ui-to-vue", "vue-patterns"],
  "framework:svelte": ["frontend-patterns"],
  "framework:django": ["django-patterns", "django-tdd", "django-verification"],
  "framework:springboot": ["springboot-patterns", "springboot-tdd", "springboot-verification"],
  "framework:quarkus": ["quarkus-patterns", "quarkus-tdd", "quarkus-verification"],
  "framework:rails": [],
  "framework:laravel": [
    "laravel-plugin-discovery",
    "laravel-patterns",
    "laravel-tdd",
    "laravel-verification",
  ],
};

const FRAMEWORK_RULES: Readonly<Record<string, readonly string[]>> = {
  "framework:angular": ["rules/angular"],
  "framework:react": ["rules/react", "rules/web"],
  "framework:nextjs": ["rules/react", "rules/web"],
  "framework:vue": ["rules/vue", "rules/web"],
  "framework:nuxt": ["rules/nuxt", "rules/vue", "rules/web"],
  "framework:svelte": ["rules/web"],
  "framework:django": ["rules/python"],
  "framework:springboot": ["rules/java"],
  "framework:quarkus": ["rules/java"],
  "framework:rails": ["rules/ruby"],
  "framework:laravel": ["rules/php"],
};

const AGENT_SKILL_COPIES = new Set([
  "agent-introspection-debugging",
  "agent-sort",
  "api-design",
  "article-writing",
  "backend-patterns",
  "benchmark-methodology",
  "brand-discovery",
  "brand-voice",
  "bun-runtime",
  "coding-standards",
  "competitive-platform-analysis",
  "competitive-report-structure",
  "content-engine",
  "crosspost",
  "deep-research",
  "dmux-workflows",
  "documentation-lookup",
  "e2e-testing",
  "eval-harness",
  "everything-claude-code",
  "exa-search",
  "fal-ai-media",
  "frontend-patterns",
  "frontend-slides",
  "investor-materials",
  "investor-outreach",
  "market-research",
  "mcp-server-patterns",
  "mle-workflow",
  "nextjs-turbopack",
  "plan-canvas",
  "product-capability",
  "security-review",
  "strategic-compact",
  "tdd-workflow",
  "unified-memory",
  "verification-loop",
  "video-editing",
  "x-api",
]);

function leafName(componentId: string, family: string): string | undefined {
  const prefix = `${family}:`;
  return componentId.startsWith(prefix) ? componentId.slice(prefix.length) : undefined;
}

export interface EccComponentModelV1 {
  eccComponentInstallDescriptor(
    componentId: EccComponentId | EccMcpComponentId,
  ): EccComponentInstallDescriptor;
  eccComponentRequiredModuleRootIds(componentId: EccComponentId | EccMcpComponentId): string[];
  eccModuleSelectableMemberIds(moduleId: string, componentIds: readonly string[]): string[];
  eccComponentSourcePaths(componentId: EccComponentId | EccMcpComponentId): string[];
  eccModuleDependencyIds(moduleId: string): string[];
  eccProfileModuleIds(profileId: string): string[];
}

/** The ECC component model over the upstream module and profile manifests at one pin. */
export function eccComponentModelV1(
  eccModules: EccModulesSnapshotV1,
  eccProfiles: EccProfilesSnapshotV1,
): EccComponentModelV1 {
  const MODULE_PATHS = new Map(
    eccModules.modules.map((module) => [module.id, module.paths] as const),
  );
  function skillModules(): Readonly<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const module of eccModules.modules) {
      for (const path of module.paths) {
        const skill = /^skills\/([a-z0-9][a-z0-9-]*)$/.exec(path)?.[1];
        if (skill === undefined) continue;
        const existing = result[skill];
        if (existing !== undefined && existing !== module.id) {
          throw new Error(`ECC skill ${skill} belongs to both ${existing} and ${module.id}`);
        }
        result[skill] = module.id;
      }
    }
    return Object.freeze(result);
  }

  const SKILL_MODULES = skillModules();
  function eccComponentInstallDescriptor(
    componentId: EccComponentId | EccMcpComponentId,
  ): EccComponentInstallDescriptor {
    const selectedModule = leafName(componentId, "module");
    if (selectedModule !== undefined) {
      if (!MODULE_PATHS.has(selectedModule)) {
        throw new Error(`pinned ECC module snapshot is missing ${selectedModule}`);
      }
      return {
        evidenceComponentId: componentId,
        containingModuleId: selectedModule,
        wholeModules: [selectedModule],
      };
    }
    if (componentId === "baseline:rules") {
      return {
        evidenceComponentId: componentId,
        containingModuleId: "rules-core",
        sourceRoots: ["rules/README.md", "rules/common"],
      };
    }
    const wholeModule = WHOLE_MODULE_COMPONENTS[componentId];
    if (wholeModule !== undefined) {
      return {
        evidenceComponentId: componentId,
        containingModuleId: wholeModule,
        wholeModules: [wholeModule],
      };
    }
    if (componentId === "baseline:agents") {
      return {
        evidenceComponentId: componentId,
        containingModuleId: "agents-core",
        sourceRoots: ["AGENTS.md", ".agents/plugins/marketplace.json"],
        agentScaffolding: true,
      };
    }
    if (componentId.startsWith("mcp:")) {
      return {
        evidenceComponentId: "module:platform-configs",
        containingModuleId: "platform-configs",
        sourceRoots: [".mcp.json", "mcp-configs/mcp-servers.json"],
      };
    }
    const agent = leafName(componentId, "agent");
    if (agent !== undefined) {
      return {
        evidenceComponentId: componentId,
        containingModuleId: "agents-core",
        agents: [agent],
      };
    }
    const skill = leafName(componentId, "skill");
    if (skill !== undefined) {
      const moduleId = SKILL_MODULES[skill];
      if (moduleId === undefined) throw new Error(`no ECC install descriptor for ${componentId}`);
      return {
        evidenceComponentId: componentId,
        containingModuleId: moduleId,
        skills: [skill],
      };
    }
    const languageSkills = LANGUAGE_SKILLS[componentId];
    if (languageSkills !== undefined) {
      const moduleId = componentId === "lang:swift" ? "swift-apple" : "framework-language";
      return {
        evidenceComponentId: componentId,
        containingModuleId: moduleId,
        skills: languageSkills,
        sourceRoots: LANGUAGE_RULES[componentId] ?? [],
      };
    }
    const frameworkSkills = FRAMEWORK_SKILLS[componentId];
    if (frameworkSkills !== undefined) {
      return {
        evidenceComponentId: componentId,
        containingModuleId: "framework-language",
        skills: frameworkSkills,
        sourceRoots: FRAMEWORK_RULES[componentId] ?? [],
      };
    }
    throw new Error(`no ECC install descriptor for ${componentId}`);
  }

  /** Whole upstream modules selected by one semantic component, before dependency expansion. */
  function eccComponentWholeModuleIds(componentId: EccComponentId | EccMcpComponentId): string[] {
    return [...(eccComponentInstallDescriptor(componentId).wholeModules ?? [])];
  }

  /**
   * Module roots that must be selected beside one semantic component. Languages
   * are additive only after ECC Core; whole-module semantic components retain
   * their existing exact containing-module requirement.
   */
  function eccComponentRequiredModuleRootIds(
    componentId: EccComponentId | EccMcpComponentId,
  ): string[] {
    return [
      ...new Set([
        ...eccComponentWholeModuleIds(componentId),
        ...(componentId.startsWith("lang:") ? UPSTREAM_CORE_ECC_MODULE_IDS : []),
      ]),
    ];
  }

  const SELECTABLE_MODULE_MEMBER_KINDS = new Set(["agent", "baseline", "skill"]);

  /**
   * Individually selectable artifacts materially contained by one module.
   * MCP, language, framework, capability, runtime, and module identities are
   * deliberately excluded: selecting a source module must not manufacture an
   * activation or a broader semantic choice.
   */
  function eccModuleSelectableMemberIds(
    moduleId: string,
    componentIds: readonly string[],
  ): string[] {
    if (!MODULE_PATHS.has(moduleId)) {
      throw new Error(`pinned ECC module snapshot is missing ${moduleId}`);
    }
    return componentIds.filter((componentId) => {
      const separator = componentId.indexOf(":");
      const kind = separator === -1 ? "" : componentId.slice(0, separator);
      return (
        SELECTABLE_MODULE_MEMBER_KINDS.has(kind) &&
        eccComponentInstallDescriptor(componentId as EccComponentId).containingModuleId === moduleId
      );
    });
  }
  function eccComponentSourcePaths(componentId: EccComponentId | EccMcpComponentId): string[] {
    const descriptor = eccComponentInstallDescriptor(componentId);
    const paths = new Set<string>(descriptor.sourceRoots ?? []);
    for (const moduleId of descriptor.wholeModules ?? []) {
      const modulePaths = MODULE_PATHS.get(moduleId);
      if (modulePaths === undefined)
        throw new Error(`pinned ECC module snapshot is missing ${moduleId}`);
      for (const path of modulePaths) paths.add(path);
    }
    for (const skill of descriptor.skills ?? []) {
      paths.add(`skills/${skill}`);
      if (AGENT_SKILL_COPIES.has(skill)) paths.add(`.agents/skills/${skill}`);
    }
    for (const agent of descriptor.agents ?? []) paths.add(`agents/${agent}.md`);
    if (componentId.startsWith("mcp:")) {
      paths.add(".mcp.json");
      paths.add("mcp-configs/mcp-servers.json");
    }
    return [...paths].sort((left, right) => left.localeCompare(right));
  }
  const modules = eccModules.modules;
  const profiles = eccProfiles.profiles;
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  function addWithDependencies(selected: Set<string>, id: string): void {
    if (selected.has(id)) return;
    const module = moduleById.get(id);
    if (module === undefined) throw new Error(`pinned ECC module snapshot is missing ${id}`);
    for (const dependency of module.dependencies) addWithDependencies(selected, dependency);
    selected.add(id);
  }

  /**
   * Exact transitive prerequisites for one module in the pinned ECC manifest.
   * The selected module itself is excluded so callers can distinguish the
   * administrator's root choice from the dependency closure it requires.
   */
  function eccModuleDependencyIds(moduleId: string): string[] {
    const selected = new Set<string>();
    addWithDependencies(selected, moduleId);
    selected.delete(moduleId);
    return modules.filter((module) => selected.has(module.id)).map((module) => module.id);
  }

  function eccProfileModuleIds(profileId: string): string[] {
    const profile = profiles[profileId];
    if (profile === undefined)
      throw new Error(`unknown ECC profile in pinned snapshot: ${profileId}`);
    const selected = new Set<string>();
    for (const id of profile.modules) addWithDependencies(selected, id);
    return modules.filter((module) => selected.has(module.id)).map((module) => module.id);
  }

  return {
    eccComponentInstallDescriptor,
    eccComponentRequiredModuleRootIds,
    eccModuleSelectableMemberIds,
    eccComponentSourcePaths,
    eccModuleDependencyIds,
    eccProfileModuleIds,
  };
}
