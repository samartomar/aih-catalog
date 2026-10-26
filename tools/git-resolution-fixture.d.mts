import type {
  GitAcquiredCommit,
  GitRemoteRef,
  GitRemoteTransport,
} from "@aihq/catalog/contracts";

export const FIXTURE_REPOSITORY: string;
export const FIXTURE_ENCODER: TextEncoder;
export const FIXTURE_TREE: string;
export const gitOid: (type: "blob" | "commit" | "tree", bytes: Uint8Array) => string;
export const sha256Hex: (bytes: Uint8Array) => string;
export const commitObject: (parents?: readonly string[]) => Uint8Array;
export const COMMIT_BYTES: Uint8Array;
export const COMMIT: string;
export const OTHER_COMMIT: string;
export const FORK_COMMIT: string;
export const fixtureRef: (name: string, oid: string) => GitRemoteRef;
export const fixtureAcquiredCommit: (
  files: readonly {
    readonly path: string;
    readonly bytes: Uint8Array | string;
    readonly mode?: string;
  }[],
) => GitAcquiredCommit;
export const fixtureTransport: (options?: {
  readonly refs?: readonly GitRemoteRef[];
  readonly closure?: readonly string[];
  readonly commits?: ReadonlyMap<string, GitAcquiredCommit>;
  readonly listRefsError?: Error;
  readonly closureError?: Error;
  readonly fetchError?: Error;
}) => GitRemoteTransport;
