"""Inspect CRG 2.3.9's native graph without opening a migrating GraphStore.

Requires the selected binary-only environment for native file discovery. This
probe never builds, updates, watches, installs hooks or rewrites the database.
Hash freshness is advisory navigation evidence, not parsing/coverage proof.
"""

import hashlib
import json
import importlib.metadata
import platform
from pathlib import Path
import sqlite3
import subprocess
import sys


def inspect(root, data):
    if platform.python_version() != "3.14.10" or importlib.metadata.version("code-review-graph") != "2.3.9":
        raise ValueError("CRG requires the exact selected 2.3.9 / Python 3.14.10 environment")
    from code_review_graph.incremental import collect_all_files, get_data_dir
    root, data = root.resolve(strict=True), data.resolve(strict=True)
    if get_data_dir(root, create=False).resolve() != data:
        raise ValueError("CRG native registry/environment storage conflicts with explicit data directory")
    database = data / "graph.db"
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=2) as connection:
        connection.execute("PRAGMA query_only=ON")
        metadata = dict(connection.execute("SELECT key, value FROM metadata"))
        if metadata.get("schema_version") != "13":
            raise ValueError("CRG schema is not 13; explicit compatible snapshot/migration required")
        files = dict(connection.execute("SELECT file_path, file_hash FROM nodes WHERE kind='File'"))
        if not files:
            raise ValueError("CRG root identity/hash inventory unavailable")
        for filename in files:
            path = Path(filename)
            if not path.is_absolute() or not path.resolve().is_relative_to(root):
                raise ValueError("CRG native File marker does not identify the requested root")
        if metadata.get("build_state") != "complete":
            return {"freshness": "partial", "build_state": metadata.get("build_state", "unknown")}
        changed = [filename for filename, digest in files.items()
                   if not Path(filename).is_file() or Path(filename).is_symlink()
                   or hashlib.sha256(Path(filename).read_bytes()).hexdigest() != digest]
        # Use native discovery/ignore/language rules rather than guessing supported files.
        expected = {str((root / path).resolve()) for path in collect_all_files(root)}
        missing = sorted(expected - set(files))
        extra = sorted(set(files) - expected)
        head = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
        current = not (changed or missing or extra) and metadata.get("git_head_sha") == head
        return {"freshness": "current" if current else "stale", "root": str(root),
                "database": str(database), "schema": 13, "head": head,
                "built_at_commit": metadata.get("git_head_sha"), "changed": changed[:50],
                "missing": missing[:50], "extra": extra[:50],
                "mismatch_count": len(changed) + len(missing) + len(extra),
                "parse_coverage": "unknown; native fixture qualification required"}


if __name__ == "__main__":
    try:
        print(json.dumps(inspect(Path(sys.argv[1]), Path(sys.argv[2]))))
    except (OSError, ValueError, sqlite3.Error, ImportError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
