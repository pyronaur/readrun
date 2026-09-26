import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Readrun's own folder. READRUN_CACHE=0 turns caching off; READRUN_CACHE_DIR moves it. */
function cacheDir(): string | undefined {
  if (process.env.READRUN_CACHE === "0") return undefined;
  return process.env.READRUN_CACHE_DIR || join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "readrun");
}

export const cacheKey = (...parts: string[]): string => createHash("sha256").update(parts.join("\0")).digest("hex");

/** A missing, unreadable or damaged entry is simply a miss. */
export function readCache<T>(key: string): T | undefined {
  const dir = cacheDir();
  if (!dir) return undefined;
  try {
    return JSON.parse(readFileSync(join(dir, `${key}.json`), "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Written atomically, so a concurrent run never reads half a file. Failing to write is not an error. */
export function writeCache(key: string, value: unknown): void {
  const dir = cacheDir();
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    const temporary = join(dir, `${key}.${process.pid}.tmp`);
    writeFileSync(temporary, JSON.stringify(value));
    renameSync(temporary, join(dir, `${key}.json`));
  } catch {
    // A read-only or full disk only costs speed.
  }
}
