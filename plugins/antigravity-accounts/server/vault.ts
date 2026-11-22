import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { spawn, execFile, type ChildProcess } from "child_process";
import util from "util";
import type {
  VaultStatus,
  AntigravityAccount,
  QuotaEntry,
} from "../shared/types";

const execFileAsync = util.promisify(execFile);

// Common paths inside the Paseo runtime environment
const HOME = process.env.HOME || "/home/paseo";
const TOKEN_PATHS = [
  path.join(HOME, ".gemini", "antigravity-acp", "antigravity-oauth-token"),
  path.join(HOME, ".gemini", "antigravity-cli", "antigravity-oauth-token"),
];
const VAULT_FILE = path.join(HOME, ".paseo", "antigravity-vault.json");
const BIN_PATH = `/home/paseo/.local/bin:/home/paseo/.dotnet:/usr/local/bin:${process.env.PATH || ""}`;

/**
 * Representation of an account with its encrypted/raw token stored on disk.
 */
interface StoredAccount {
  id: string;
  email: string;
  name?: string;
  token: string;
  createdAt: number;
  updatedAt: number;
  quotas?: QuotaEntry[];
  quotaUpdatedAt?: number;
}

interface VaultData {
  accounts: StoredAccount[];
}

/**
 * In-memory active OAuth login session state.
 */
interface LoginSession {
  sessionId: string;
  tempDir: string;
  child: ChildProcess;
  authUrl: string;
  createdAt: number;
  timer: NodeJS.Timeout;
  stderrBuffer: string;
  stdoutBuffer: string;
}

const activeSessions = new Map<string, LoginSession>();

/* -------------------------------------------------------------------------- */
/* Vault Storage Helpers                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Read the vault file from ~/.paseo/antigravity-vault.json.
 */
function readVault(): VaultData {
  try {
    if (fs.existsSync(VAULT_FILE)) {
      const data = JSON.parse(fs.readFileSync(VAULT_FILE, "utf-8"));
      if (Array.isArray(data.accounts)) return data;
    }
  } catch (err) {
    console.error("[antigravity-vault] Error reading vault:", err);
  }
  return { accounts: [] };
}

/**
 * Atomically write the vault file to avoid corruptions.
 */
function writeVault(data: VaultData): void {
  const dir = path.dirname(VAULT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.vault.${crypto.randomBytes(6).toString("hex")}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, VAULT_FILE);
}

/**
 * Read the active token currently loaded in ~/.gemini/.
 * Checks both antigravity-acp and antigravity-cli locations.
 */
function readCurrentToken(): string | null {
  for (const tokenPath of TOKEN_PATHS) {
    try {
      if (fs.existsSync(tokenPath)) {
        const content = fs.readFileSync(tokenPath, "utf-8").trim();
        if (content) return content;
      }
    } catch {}
  }
  return null;
}

/**
 * Atomically write the active token to ~/.gemini/.
 * Writes to existing token directories or creates the default path.
 */
function writeCurrentToken(token: string): void {
  const writtenPaths = new Set<string>();

  for (const tokenPath of TOKEN_PATHS) {
    const dir = path.dirname(tokenPath);
    if (fs.existsSync(dir)) {
      const tmp = path.join(dir, `.token.${crypto.randomBytes(6).toString("hex")}.tmp`);
      fs.writeFileSync(tmp, token.trim() + "\n", { mode: 0o600 });
      fs.renameSync(tmp, tokenPath);
      writtenPaths.add(tokenPath);
    }
  }

  // If none of the directories existed yet, create the primary directory and write
  if (writtenPaths.size === 0) {
    const primary = TOKEN_PATHS[0];
    const dir = path.dirname(primary);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, `.token.${crypto.randomBytes(6).toString("hex")}.tmp`);
    fs.writeFileSync(tmp, token.trim() + "\n", { mode: 0o600 });
    fs.renameSync(tmp, primary);
  }
}

/**
 * Extract the user email address from the raw token JSON payload.
 */
function extractAccountEmail(tokenRaw: string): string {
  try {
    const parsed = JSON.parse(tokenRaw);
    if (parsed.id_token_email && typeof parsed.id_token_email === "string") {
      return parsed.id_token_email;
    }
    if (parsed.email && typeof parsed.email === "string") {
      return parsed.email;
    }
  } catch {}
  return "google-user@antigravity";
}

/* -------------------------------------------------------------------------- */
/* Quota Management                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Fetch current quota limits from Antigravity CLI via `agy -p /quota`.
 * An optional custom HOME can be supplied to check quotas in isolated directories.
 */
export async function fetchCurrentQuota(customHome?: string): Promise<QuotaEntry[]> {
  try {
    const { stdout } = await execFileAsync("agy", ["-p", "/quota"], {
      timeout: 12000,
      env: {
        ...process.env,
        HOME: customHome || HOME,
        PATH: BIN_PATH,
      },
    });

    const lines = stdout.trim().split("\n");
    const quotas: QuotaEntry[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      if (parts.length >= 3) {
        quotas.push({
          group: parts[0].trim(),
          limitType: parts[1].trim(),
          percentage: parts[2].trim(),
          resetAt: parts[3] ? parts[3].trim() : undefined,
        });
      }
    }
    return quotas;
  } catch (err) {
    console.error("[antigravity-vault] Error fetching quotas:", err);
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Public Vault Actions                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Retrieve current vault status including active account and quota data.
 */
export async function getStatus(): Promise<VaultStatus> {
  const vault = readVault();
  const currentToken = readCurrentToken();
  let activeAccountId: string | null = null;
  let activeEmail: string | null = null;

  if (currentToken) {
    const currentEmail = extractAccountEmail(currentToken);
    activeEmail = currentEmail;

    // 1. Direct match by exact token string
    let match = vault.accounts.find((a) => a.token === currentToken);

    // 2. Fallback match by email (when access_token has been automatically refreshed by Google)
    if (!match && currentEmail && currentEmail !== "google-user@antigravity") {
      match = vault.accounts.find(
        (a) => a.email.toLowerCase() === currentEmail.toLowerCase(),
      );
      if (match) {
        // Sync refreshed token to vault
        match.token = currentToken;
        match.updatedAt = Date.now();
        writeVault(vault);
      }
    }

    if (match) {
      activeAccountId = match.id;
      activeEmail = match.email;
    }
  }

  return {
    accounts: vault.accounts.map(
      ({ id, email, name, createdAt, updatedAt, quotas, quotaUpdatedAt }) => ({
        id,
        email,
        name,
        createdAt,
        updatedAt,
        quotas,
        quotaUpdatedAt,
      }),
    ),
    activeAccountId,
    activeEmail,
  };
}

export async function listAccounts(): Promise<VaultStatus> {
  return getStatus();
}

/**
 * Save the account currently active in ~/.gemini into the vault.
 */
export async function saveCurrentAccount(): Promise<VaultStatus> {
  const token = readCurrentToken();
  if (!token) {
    throw new Error("No active Antigravity token found in ~/.gemini. Please connect an account first.");
  }

  const vault = readVault();
  const existing = vault.accounts.find((a) => a.token === token);
  if (existing) {
    existing.quotas = await fetchCurrentQuota();
    existing.quotaUpdatedAt = Date.now();
    writeVault(vault);
    return getStatus();
  }

  const email = extractAccountEmail(token);
  const now = Date.now();
  const quotas = await fetchCurrentQuota();
  const newAccount: StoredAccount = {
    id: crypto.randomUUID(),
    email,
    token,
    createdAt: now,
    updatedAt: now,
    quotas,
    quotaUpdatedAt: now,
  };

  vault.accounts.push(newAccount);
  writeVault(vault);
  return getStatus();
}

/**
 * Select and activate an account by ID, automatically refreshing its quota.
 */
export async function selectAccount({ accountId }: { accountId: string }): Promise<VaultStatus> {
  const vault = readVault();
  const target = vault.accounts.find((a) => a.id === accountId);
  if (!target) {
    throw new Error(`Account not found in vault: ${accountId}`);
  }

  // Atomically write token file for agy CLI
  writeCurrentToken(target.token);

  // Immediately refresh quota upon activation
  const quotas = await fetchCurrentQuota();
  target.quotas = quotas;
  target.quotaUpdatedAt = Date.now();
  target.updatedAt = Date.now();
  writeVault(vault);

  return getStatus();
}

/**
 * Remove an account from the vault.
 */
export async function deleteAccount({ accountId }: { accountId: string }): Promise<VaultStatus> {
  const vault = readVault();
  vault.accounts = vault.accounts.filter((a) => a.id !== accountId);
  writeVault(vault);
  return getStatus();
}

/**
 * Refresh quota metrics for a specific account or the active one.
 */
export async function refreshQuota({ accountId }: { accountId?: string }): Promise<VaultStatus> {
  const vault = readVault();
  const currentToken = readCurrentToken();

  const target = accountId
    ? vault.accounts.find((a) => a.id === accountId)
    : currentToken
      ? vault.accounts.find((a) => a.token === currentToken)
      : null;

  if (target) {
    if (currentToken && target.token === currentToken) {
      target.quotas = await fetchCurrentQuota();
      target.quotaUpdatedAt = Date.now();
      writeVault(vault);
    } else {
      // Temporarily swap token to query quota, then restore original active token
      writeCurrentToken(target.token);
      target.quotas = await fetchCurrentQuota();
      target.quotaUpdatedAt = Date.now();
      writeVault(vault);
      if (currentToken) {
        writeCurrentToken(currentToken);
      }
    }
  }
  return getStatus();
}

/* -------------------------------------------------------------------------- */
/* Interactive Multi-Step OAuth Login Flow                                    */
/* -------------------------------------------------------------------------- */

function cleanSession(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  clearTimeout(session.timer);
  try {
    session.child.kill("SIGKILL");
  } catch {}

  try {
    if (fs.existsSync(session.tempDir)) {
      fs.rmSync(session.tempDir, { recursive: true, force: true });
    }
  } catch {}

  activeSessions.delete(sessionId);
}

/**
 * Starts the interactive OAuth flow by spawning agy in a clean temporary directory.
 * Returns the Google authorization URL and session ID.
 */
export async function startLoginFlow(): Promise<{ sessionId: string; authUrl: string }> {
  const sessionId = crypto.randomUUID();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-oauth-"));

  return new Promise((resolve, reject) => {
    // We run `agy -p init` through `script` to allocate a pseudo-terminal (PTY)
    // so that agy provides the OAuth URL and waits for the code on stdin.
    const child = spawn("script", ["-q", "-c", "agy -p init-session", "/dev/null"], {
      cwd: tempDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        HOME: tempDir,
        PATH: BIN_PATH,
      },
    });

    let resolved = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const timer = setTimeout(() => {
      if (!resolved) {
        cleanSession(sessionId);
        reject(new Error("Timeout generating Google OAuth authentication link."));
      }
    }, 20000);

    const onData = (data: Buffer) => {
      const text = data.toString();
      stdoutBuffer += text;

      // Match Google OAuth URL
      const match = stdoutBuffer.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth[^\s\r\n]+/);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timer);

        const authUrl = match[0];

        // Give the session 3 minutes to complete before automatic expiration
        const sessionTimer = setTimeout(() => {
          cleanSession(sessionId);
        }, 180000);

        activeSessions.set(sessionId, {
          sessionId,
          tempDir,
          child,
          authUrl,
          createdAt: Date.now(),
          timer: sessionTimer,
          stderrBuffer: "",
          stdoutBuffer: "",
        });

        resolve({ sessionId, authUrl });
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", (data: Buffer) => {
      stderrBuffer += data.toString();
    });

    child.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        cleanSession(sessionId);
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        cleanSession(sessionId);
        reject(
          new Error(
            `Antigravity CLI process exited unexpectedly (code ${code}): ${stderrBuffer || stdoutBuffer}`,
          ),
        );
      }
    });
  });
}

/**
 * Submits the authorization code to complete token exchange, save the account, and fetch initial quota.
 */
export async function submitAuthCode({
  sessionId,
  code,
}: {
  sessionId: string;
  code: string;
}): Promise<VaultStatus> {
  const session = activeSessions.get(sessionId);
  if (!session) {
    throw new Error("Authentication session has expired or does not exist. Please start a new session.");
  }

  const cleanCode = code.trim();
  if (!cleanCode) {
    throw new Error("Authorization code cannot be empty.");
  }

  const candidateTokenPaths = [
    path.join(session.tempDir, ".gemini", "antigravity-acp", "antigravity-oauth-token"),
    path.join(session.tempDir, ".gemini", "antigravity-cli", "antigravity-oauth-token"),
  ];

  return new Promise<VaultStatus>((resolve, reject) => {
    let finished = false;

    // Send the code through child stdin with a newline
    try {
      session.child.stdin?.write(cleanCode + "\n");
    } catch (writeErr) {
      cleanSession(sessionId);
      return reject(new Error(`Failed to deliver authorization code to CLI: ${writeErr}`));
    }

    // Poll for the generated token file
    const startTime = Date.now();
    const pollInterval = setInterval(async () => {
      if (finished) return;

      const foundPath = candidateTokenPaths.find((p) => fs.existsSync(p));

      // Check if token file exists and is populated
      if (foundPath) {
        try {
          const rawToken = fs.readFileSync(foundPath, "utf-8").trim();
          if (rawToken && rawToken.startsWith("{")) {
            finished = true;
            clearInterval(pollInterval);

            // Fetch initial quotas using the temporary isolated home
            const quotas = await fetchCurrentQuota(session.tempDir);
            const email = extractAccountEmail(rawToken);
            const now = Date.now();

            const vault = readVault();
            // Check if account with same email already exists
            const existingIndex = vault.accounts.findIndex((a) => a.email === email);
            const accountId = existingIndex >= 0 ? vault.accounts[existingIndex].id : crypto.randomUUID();

            const newAccount: StoredAccount = {
              id: accountId,
              email,
              token: rawToken,
              createdAt: existingIndex >= 0 ? vault.accounts[existingIndex].createdAt : now,
              updatedAt: now,
              quotas,
              quotaUpdatedAt: now,
            };

            if (existingIndex >= 0) {
              vault.accounts[existingIndex] = newAccount;
            } else {
              vault.accounts.push(newAccount);
            }

            writeVault(vault);

            // Set this newly connected account as active in ~/.gemini
            writeCurrentToken(rawToken);

            cleanSession(sessionId);
            return resolve(getStatus());
          }
        } catch (readErr) {
          // Token file might still be writing; continue polling
        }
      }

      // Timeout after 15 seconds
      if (Date.now() - startTime > 15000) {
        finished = true;
        clearInterval(pollInterval);
        cleanSession(sessionId);
        reject(
          new Error(
            "Authentication verification timed out. Please check that the authorization code was copied correctly.",
          ),
        );
      }
    }, 250);

    // Watch for process exit errors
    session.child.on("close", (code) => {
      if (!finished && !candidateTokenPaths.some((p) => fs.existsSync(p))) {
        finished = true;
        clearInterval(pollInterval);
        cleanSession(sessionId);
        reject(
          new Error(
            `Authentication failed. The code may be invalid or expired (exit code ${code}).`,
          ),
        );
      }
    });
  });
}

/**
 * Cancel an active login session.
 */
export async function cancelLoginFlow({
  sessionId,
}: {
  sessionId: string;
}): Promise<{ success: boolean }> {
  cleanSession(sessionId);
  return { success: true };
}
