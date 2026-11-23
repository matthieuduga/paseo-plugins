import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Lifecycle status of a Cloudflare Tunnel.
 */
export const TunnelStateEnum = z.enum(["stopped", "starting", "running", "error"]);
export type TunnelState = z.infer<typeof TunnelStateEnum>;

/**
 * Snapshot of a workspace tunnel configuration and execution state.
 */
export const TunnelStatusSchema = z.object({
  workspaceId: z.string().describe("Workspace identifier"),
  state: TunnelStateEnum.describe("Current state of the tunnel process"),
  port: z.number().int().min(1).max(65535).describe("Target local port forwarded by the tunnel"),
  publicUrl: z.string().nullable().describe("Assigned public Cloudflare URL, e.g. https://*.trycloudflare.com"),
  hasPassword: z.boolean().describe("Whether access is protected by a password lock page"),
  hasToken: z.boolean().describe("Whether a custom Cloudflare Tunnel token is being used"),
  error: z.string().nullable().describe("Latest error message if state is error"),
  startedAt: z.number().nullable().describe("Timestamp when tunnel was started"),
  inspectorPort: z.number().nullable().describe("Loopback proxy port if request inspector is active"),
});

export type TunnelStatus = z.infer<typeof TunnelStatusSchema>;

/**
 * Information regarding a detected local port in the project or on host.
 */
export const PortSourceEnum = z.enum(["listening", "launchSettings", "packageJson", "env"]);
export type PortSource = z.infer<typeof PortSourceEnum>;

export const DetectedPortSchema = z.object({
  port: z.number().int().min(1).max(65535).describe("Detected port number"),
  label: z.string().describe("Human readable label describing origin, e.g. 'Vite dev server' or 'ASP.NET Core'"),
  source: PortSourceEnum.describe("Discovery mechanism source"),
});

export type DetectedPort = z.infer<typeof DetectedPortSchema>;

/**
 * A logged HTTP request passing through the tunnel.
 */
export const HttpRequestLogSchema = z.object({
  id: z.string().describe("Unique request ID"),
  timestamp: z.number().describe("Epoch milliseconds when request was handled"),
  method: z.string().describe("HTTP method, e.g. GET, POST"),
  path: z.string().describe("Request path and query string"),
  statusCode: z.number().describe("HTTP response status code"),
  durationMs: z.number().describe("Response generation duration in milliseconds"),
  clientIp: z.string().describe("Client IP address"),
});

export type HttpRequestLog = z.infer<typeof HttpRequestLogSchema>;

/**
 * Status of the `cloudflared` binary on the daemon machine (NAS).
 */
export const BinaryStatusSchema = z.object({
  installed: z.boolean().describe("Whether cloudflared executable is available"),
  path: z.string().nullable().describe("Path to the cloudflared executable"),
  version: z.string().nullable().describe("Detected cloudflared version string"),
  downloading: z.boolean().describe("Whether binary download is currently in progress"),
  canAutoDownload: z.boolean().describe("Whether platform architecture supports automatic binary download"),
  platform: z.string().describe("OS platform: linux, darwin, win32"),
  arch: z.string().describe("CPU architecture: x64, arm64, arm"),
  error: z.string().nullable().describe("Error message during check or download"),
});

export type BinaryStatus = z.infer<typeof BinaryStatusSchema>;

/* -------------------------------------------------------------------------- */
/* RPC Definitions                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Retrieve current tunnel status, binary availability, and recent requests.
 */
export const getTunnelStatusRpc = defineRpc({
  name: "cloudflare.tunnels.status",
  input: z.object({
    workspaceId: z.string().describe("Workspace identifier"),
  }),
  output: z.object({
    tunnel: TunnelStatusSchema,
    binary: BinaryStatusSchema,
    requests: z.array(HttpRequestLogSchema),
  }),
});

/**
 * Detect potential web server ports in project files and active sockets.
 */
export const detectPortsRpc = defineRpc({
  name: "cloudflare.tunnels.detect_ports",
  input: z.object({
    workspaceId: z.string().describe("Workspace identifier"),
    projectRootPath: z.string().optional().describe("Root directory of the workspace"),
  }),
  output: z.object({
    ports: z.array(DetectedPortSchema),
  }),
});

/**
 * Start a Cloudflare Tunnel for a workspace.
 */
export const startTunnelRpc = defineRpc({
  name: "cloudflare.tunnels.start",
  input: z.object({
    workspaceId: z.string().describe("Workspace identifier"),
    port: z.number().int().min(1).max(65535).describe("Port to forward"),
    password: z.string().optional().describe("Optional access password"),
    token: z.string().optional().describe("Optional Cloudflare named tunnel token"),
    projectRootPath: z.string().optional().describe("Root directory of the workspace"),
  }),
  output: z.object({
    tunnel: TunnelStatusSchema,
  }),
});

/**
 * Stop an active Cloudflare Tunnel for a workspace.
 */
export const stopTunnelRpc = defineRpc({
  name: "cloudflare.tunnels.stop",
  input: z.object({
    workspaceId: z.string().describe("Workspace identifier"),
  }),
  output: z.object({
    tunnel: TunnelStatusSchema,
  }),
});

/**
 * Install or update the `cloudflared` binary automatically.
 */
export const installBinaryRpc = defineRpc({
  name: "cloudflare.tunnels.install_binary",
  input: z.object({}),
  output: BinaryStatusSchema,
});

/**
 * Clear the request history logs for a workspace.
 */
export const clearRequestsRpc = defineRpc({
  name: "cloudflare.tunnels.clear_requests",
  input: z.object({
    workspaceId: z.string().describe("Workspace identifier"),
  }),
  output: z.object({
    success: z.boolean(),
  }),
});
