import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const TOKEN_PATH = join(homedir(), ".gh-claude-panel", "token");

export async function loadOrCreateToken(): Promise<{ token: string; created: boolean }> {
  try {
    const existing = (await readFile(TOKEN_PATH, "utf8")).trim();
    if (existing.length >= 32) return { token: existing, created: false };
  } catch {
    // fall through to creation
  }
  const token = randomBytes(24).toString("hex");
  await mkdir(dirname(TOKEN_PATH), { recursive: true });
  await writeFile(TOKEN_PATH, token, { mode: 0o600 });
  return { token, created: true };
}

export function tokenPath(): string {
  return TOKEN_PATH;
}
