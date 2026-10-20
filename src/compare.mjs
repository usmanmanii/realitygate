// Git-based views of a change: the Reality Score of another ref (for a PR's
// score delta) and the files a change touched (for `check --changed`). The
// base ref is checked out into a temporary worktree, which is always removed.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runAudit } from "./audit.mjs";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
}

function repoTop(root) {
  try {
    return resolve(git(root, ["rev-parse", "--show-toplevel"]).trim());
  } catch {
    const e = new Error(`${root} is not inside a git repository`);
    e.code = "BAD_INPUT";
    throw e;
  }
}

// The root's path inside the repo, as git spells it ("" at the top). Asking git
// avoids comparing paths that differ only in spelling (Windows 8.3 short names).
function repoPrefix(root) {
  return git(root, ["rev-parse", "--show-prefix"]).trim().replace(/\/$/, "");
}

function verifyRef(top, ref) {
  try {
    return git(top, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim();
  } catch {
    const e = new Error(`unknown git ref "${ref}" (in CI, fetch it first, e.g. git fetch --depth=1 origin <sha>)`);
    e.code = "BAD_INPUT";
    throw e;
  }
}

/** Runs the audit on `ref` in a temporary worktree. Returns null when that ref has nothing to audit. */
export function auditAtRef(root, ref, { configPath } = {}) {
  const top = repoTop(root);
  const sha = verifyRef(top, ref);
  const sub = repoPrefix(root);
  const tmp = mkdtempSync(join(tmpdir(), "realitygate-base-"));
  const wt = join(tmp, "wt");
  git(top, ["worktree", "add", "--detach", "--quiet", wt, sha]);
  try {
    return runAudit(join(wt, sub), { configPath });
  } catch (e) {
    if (e?.code === "NOTHING_TO_AUDIT") return null;
    throw e;
  } finally {
    try {
      git(top, ["worktree", "remove", "--force", wt]);
    } finally {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
}

const key = (f) => `${f.rule}\u0000${f.file}\u0000${f.text}`;

/**
 * Score change and finding changes between two audits. Findings are matched
 * by rule, file and text, not line, so code that only moved is not "new".
 */
export function auditDelta(base, head, ref) {
  const counts = new Map();
  for (const f of base?.findings ?? []) counts.set(key(f), (counts.get(key(f)) ?? 0) + 1);
  const newFindings = [];
  for (const f of head.findings) {
    const n = counts.get(key(f)) ?? 0;
    if (n > 0) counts.set(key(f), n - 1);
    else newFindings.push(f);
  }
  const remaining = new Map(counts);
  const fixedFindings = (base?.findings ?? []).filter((f) => {
    const n = remaining.get(key(f)) ?? 0;
    if (n > 0) {
      remaining.set(key(f), n - 1);
      return true;
    }
    return false;
  });
  return {
    base: /^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref,
    baseScore: base?.score ?? null,
    score: head.score,
    change: base ? head.score - base.score : null,
    baseJustified: base?.justified?.length ?? null,
    newFindings,
    fixedFindings,
  };
}

/**
 * Files changed relative to `base` (default HEAD): committed since the merge
 * base, staged, unstaged and untracked. Paths are relative to `root`.
 */
export function changedFiles(root, base = "HEAD") {
  const top = repoTop(root);
  const sha = verifyRef(top, base);
  let from = sha;
  try {
    from = git(top, ["merge-base", sha, "HEAD"]).trim() || sha;
  } catch {
    from = sha;
  }
  const tracked = git(top, ["diff", "--name-only", "-z", "--diff-filter=ACMR", from]).split("\0");
  const untracked = git(top, ["ls-files", "-z", "--others", "--exclude-standard"]).split("\0");
  const sub = repoPrefix(root);
  const prefix = sub ? `${sub}/` : "";
  return new Set(
    [...tracked, ...untracked].filter((f) => f && f.startsWith(prefix)).map((f) => f.slice(prefix.length)),
  );
}
