import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Quota limit entry returned by `agy -p /quota`.
 */
export const QuotaEntrySchema = z.object({
  group: z.string().describe("Model family group, e.g., 'Gemini Models' or 'Claude and GPT models'"),
  limitType: z.string().describe("Limit window type, e.g., 'Five Hour Limit Remaining' or 'Weekly Limit Remaining'"),
  percentage: z.string().describe("Remaining quota percentage string, e.g., '100%' or '42%'"),
  resetAt: z.string().optional().describe("ISO timestamp when the limit resets"),
});

export type QuotaEntry = z.infer<typeof QuotaEntrySchema>;

/**
 * Representation of an Antigravity Google account stored in the vault.
 */
export const AntigravityAccountSchema = z.object({
  id: z.string().uuid().describe("Unique account identifier"),
  email: z.string().describe("Google account email address"),
  name: z.string().optional().describe("Optional friendly display name or label"),
  createdAt: z.number().describe("Timestamp when account was added"),
  updatedAt: z.number().describe("Timestamp when account was last updated"),
  quotas: z.array(QuotaEntrySchema).optional().describe("Latest quota snapshot"),
  quotaUpdatedAt: z.number().optional().describe("Timestamp when quota was last fetched"),
});

export type AntigravityAccount = z.infer<typeof AntigravityAccountSchema>;

/**
 * Overall status of the Antigravity accounts vault.
 */
export const VaultStatusSchema = z.object({
  accounts: z.array(AntigravityAccountSchema).describe("List of registered Google accounts"),
  activeAccountId: z.string().nullable().describe("ID of the currently active account in Antigravity CLI"),
  activeEmail: z.string().nullable().describe("Email of the currently active account"),
});

export type VaultStatus = z.infer<typeof VaultStatusSchema>;

/* -------------------------------------------------------------------------- */
/* RPC Definitions                                                            */
/* -------------------------------------------------------------------------- */

/**
 * List all registered accounts and current active status.
 */
export const listAccountsRpc = defineRpc({
  name: "antigravity.accounts.list",
  input: z.object({}),
  output: VaultStatusSchema,
});

/**
 * Start the interactive Google OAuth login flow.
 * Spawns an isolated authentication session and returns the authorization URL.
 */
export const startLoginFlowRpc = defineRpc({
  name: "antigravity.accounts.login_start",
  input: z.object({}),
  output: z.object({
    sessionId: z.string().describe("Session identifier to use when submitting the code"),
    authUrl: z.string().describe("Google OAuth authorization URL for the user to visit"),
  }),
});

/**
 * Submit the OAuth authorization code returned after user authentication.
 */
export const submitAuthCodeRpc = defineRpc({
  name: "antigravity.accounts.login_submit",
  input: z.object({
    sessionId: z.string().describe("Session ID from startLoginFlow"),
    code: z.string().describe("Google OAuth authorization code pasted by the user"),
  }),
  output: VaultStatusSchema,
});

/**
 * Cancel an ongoing login session and clean up resources.
 */
export const cancelLoginFlowRpc = defineRpc({
  name: "antigravity.accounts.login_cancel",
  input: z.object({
    sessionId: z.string(),
  }),
  output: z.object({
    success: z.boolean(),
  }),
});

/**
 * Save the currently active token found in ~/.gemini into the vault.
 */
export const saveCurrentAccountRpc = defineRpc({
  name: "antigravity.accounts.save_current",
  input: z.object({}),
  output: VaultStatusSchema,
});

/**
 * Switch the active Antigravity account to the specified account ID.
 * Automatically refreshes quota upon switching.
 */
export const selectAccountRpc = defineRpc({
  name: "antigravity.accounts.select",
  input: z.object({
    accountId: z.string(),
  }),
  output: VaultStatusSchema,
});

/**
 * Delete an account from the vault.
 */
export const deleteAccountRpc = defineRpc({
  name: "antigravity.accounts.delete",
  input: z.object({
    accountId: z.string(),
  }),
  output: VaultStatusSchema,
});

/**
 * Refresh quota metrics for a specific account or the currently active account.
 */
export const refreshQuotaRpc = defineRpc({
  name: "antigravity.accounts.refresh_quota",
  input: z.object({
    accountId: z.string().optional(),
  }),
  output: VaultStatusSchema,
});
