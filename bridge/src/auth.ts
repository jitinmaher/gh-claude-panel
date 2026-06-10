import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Token lives at ~/.pat-before-i-merge/token (mode 0600). The legacy
 * location ~/.gh-claude-panel/token is read as a fallback on first run
 * — if found, the token value is migrated to the new path so existing
 * users don't have to re-copy/paste it into the options page.
 */
const TOKEN_PATH = join(homedir(), ".pat-before-i-merge", "token");
const LEGACY_TOKEN_PATH = join(homedir(), ".gh-claude-panel", "token");

export async function loadOrCreateToken(): Promise<{ token: string; created: boolean }> {
  // 1. New canonical path.
  try {
    const existing = (await readFile(TOKEN_PATH, "utf8")).trim();
    if (existing.length >= 32) return { token: existing, created: false };
  } catch {
    /* fall through */
  }

  // 2. Migrate from the legacy path if it exists.
  try {
    const legacy = (await readFile(LEGACY_TOKEN_PATH, "utf8")).trim();
    if (legacy.length >= 32) {
      await mkdir(dirname(TOKEN_PATH), { recursive: true });
      await writeFile(TOKEN_PATH, legacy, { mode: 0o600 });
      return { token: legacy, created: false };
    }
  } catch {
    /* no legacy token; will create a fresh one */
  }

  // 3. First run on this machine — generate a new token.
  const token = randomBytes(24).toString("hex");
  await mkdir(dirname(TOKEN_PATH), { recursive: true });
  await writeFile(TOKEN_PATH, token, { mode: 0o600 });
  return { token, created: true };
}

export function tokenPath(): string {
  return TOKEN_PATH;
}
