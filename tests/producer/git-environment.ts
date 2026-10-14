/** Keep disposable Git commands independent of the repository that invoked the test. */
export function fixtureGitEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Git hooks export repository-local state. -C does not override that state;
  // config carriers can also inject hooks, aliases or paths into a fixture.
  for (const key of Object.keys(env)) {
    if (
      /^(?:GIT_DIR|GIT_WORK_TREE|GIT_COMMON_DIR|GIT_INDEX_FILE|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES|GIT_GRAFT_FILE|GIT_SHALLOW_FILE|GIT_NAMESPACE|GIT_PREFIX|GIT_IMPLICIT_WORK_TREE|GIT_REPLACE_REF_BASE|GIT_NO_REPLACE_OBJECTS|GIT_INTERNAL_SUPER_PREFIX|GIT_CONFIG|GIT_CONFIG_PARAMETERS|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_\d+|GIT_CONFIG_VALUE_\d+)$/iu.test(
        key,
      )
    )
      delete env[key];
  }
  // Explicit per-fixture settings remain available, including intentional hooks.
  return { ...env, ...overrides };
}
