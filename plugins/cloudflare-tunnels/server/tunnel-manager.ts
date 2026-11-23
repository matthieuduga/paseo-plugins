import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkBinaryStatus } from "./binary-manager";
import { createInspectorProxy, type InspectorProxyInstance } from "./inspector-proxy";
import type { HttpRequestLog, TunnelStatus } from "../shared/types";

interface ActiveTunnel {
  status: TunnelStatus;
  process?: ChildProcess;
  proxy?: InspectorProxyInstance;
  requests: HttpRequestLog[];
  logs: string[];
}

interface SavedWorkspaceConfig {
  lastPort?: number;
  token?: string;
}

interface PersistentState {
  workspaces: Record<string, SavedWorkspaceConfig>;
}

const activeTunnels = new Map<string, ActiveTunnel>();

function getStateFilePath(): string {
  const dir = path.join(os.homedir(), ".paseo", "plugins", "cloudflare-tunnels");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, "state.json");
}

function loadSavedState(): PersistentState {
  try {
    const file = getStateFilePath();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    }
  } catch {
    // Ignore read errors
  }
  return { workspaces: {} };
}

function saveWorkspaceConfig(workspaceId: string, config: SavedWorkspaceConfig) {
  try {
    const state = loadSavedState();
    state.workspaces[workspaceId] = {
      ...state.workspaces[workspaceId],
      ...config,
    };
    fs.writeFileSync(getStateFilePath(), JSON.stringify(state, null, 2), "utf-8");
  } catch {
    // Ignore write errors
  }
}

/**
 * Get the current tunnel status for a workspace.
 */
export function getTunnelStatus(workspaceId: string): {
  tunnel: TunnelStatus;
  requests: HttpRequestLog[];
} {
  const active = activeTunnels.get(workspaceId);
  if (active) {
    return {
      tunnel: active.status,
      requests: active.requests,
    };
  }

  // If not active, retrieve saved default port if any
  const savedState = loadSavedState();
  const saved = savedState.workspaces[workspaceId];

  const defaultStatus: TunnelStatus = {
    workspaceId,
    state: "stopped",
    port: saved?.lastPort || 5173,
    publicUrl: null,
    hasPassword: false,
    hasToken: Boolean(saved?.token),
    error: null,
    startedAt: null,
    inspectorPort: null,
  };

  return {
    tunnel: defaultStatus,
    requests: [],
  };
}

/**
 * Start a tunnel for a workspace.
 */
export async function startTunnel(params: {
  workspaceId: string;
  port: number;
  password?: string;
  token?: string;
}): Promise<TunnelStatus> {
  const { workspaceId, port, password, token } = params;

  // Stop any existing tunnel for this workspace first
  await stopTunnel(workspaceId);

  // Check binary status
  const binary = await checkBinaryStatus();
  if (!binary.installed || !binary.path) {
    const errStatus: TunnelStatus = {
      workspaceId,
      state: "error",
      port,
      publicUrl: null,
      hasPassword: Boolean(password),
      hasToken: Boolean(token),
      error: "cloudflared binary is not installed on the daemon host. Please install it first.",
      startedAt: null,
      inspectorPort: null,
    };
    return errStatus;
  }

  const requests: HttpRequestLog[] = [];
  const logs: string[] = [];

  // Initialize active record in starting state
  const currentStatus: TunnelStatus = {
    workspaceId,
    state: "starting",
    port,
    publicUrl: null,
    hasPassword: Boolean(password),
    hasToken: Boolean(token),
    error: null,
    startedAt: Date.now(),
    inspectorPort: null,
  };

  const record: ActiveTunnel = {
    status: currentStatus,
    requests,
    logs,
  };
  activeTunnels.set(workspaceId, record);

  try {
    // 1. Create loopback inspector proxy
    const proxy = await createInspectorProxy({
      targetPort: port,
      password: password && password.trim().length > 0 ? password.trim() : undefined,
      onRequestLog: (reqLog) => {
        requests.unshift(reqLog);
        if (requests.length > 50) {
          requests.pop();
        }
      },
    });

    record.proxy = proxy;
    record.status.inspectorPort = proxy.port;

    // Save configuration
    saveWorkspaceConfig(workspaceId, {
      lastPort: port,
      token: token ? token : undefined,
    });

    // 2. Spawn cloudflared
    let args: string[];
    if (token && token.trim().length > 0) {
      args = ["tunnel", "run", "--token", token.trim()];
    } else {
      args = [
        "tunnel",
        "--url",
        `http://127.0.0.1:${proxy.port}`,
        "--no-autoupdate",
      ];
    }

    const child = spawn(binary.path, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    record.process = child;

    // Handle output & extract trycloudflare URL
    const urlRegex = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/i;

    const onData = (data: Buffer) => {
      const text = data.toString();
      logs.push(text);
      if (logs.length > 100) logs.shift();

      if (record.status.state === "starting") {
        const match = text.match(urlRegex);
        if (match) {
          record.status.state = "running";
          record.status.publicUrl = match[0];
          record.status.error = null;
        }
      }
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.on("error", (err) => {
      record.status.state = "error";
      record.status.error = `cloudflared error: ${err.message}`;
    });

    child.on("close", (code) => {
      if (record.status.state !== "stopped") {
        record.status.state = "error";
        record.status.error = `cloudflared process terminated with code ${code}`;
      }
    });

    // Wait up to 10 seconds for the URL to be detected
    const startTime = Date.now();
    while (record.status.state === "starting" && Date.now() - startTime < 10000) {
      await new Promise((r) => setTimeout(r, 200));
    }

    if (record.status.state === "starting") {
      if (token) {
        // Named tunnels do not output a trycloudflare.com URL
        record.status.state = "running";
        record.status.publicUrl = "Custom Named Tunnel Active";
      } else {
        record.status.state = "error";
        record.status.error = "Timeout waiting for trycloudflare.com URL from cloudflared.";
      }
    }

    return record.status;
  } catch (err: any) {
    record.status.state = "error";
    record.status.error = err.message || "Failed to start tunnel";
    return record.status;
  }
}

/**
 * Stop an active tunnel for a workspace.
 */
export async function stopTunnel(workspaceId: string): Promise<TunnelStatus> {
  const active = activeTunnels.get(workspaceId);
  if (!active) {
    return getTunnelStatus(workspaceId).tunnel;
  }

  // Kill child process
  if (active.process) {
    try {
      active.process.kill("SIGTERM");
    } catch {
      // Ignore kill error
    }
    active.process = undefined;
  }

  // Close inspector proxy
  if (active.proxy) {
    try {
      await active.proxy.close();
    } catch {
      // Ignore close error
    }
    active.proxy = undefined;
  }

  active.status.state = "stopped";
  active.status.publicUrl = null;
  active.status.error = null;
  active.status.startedAt = null;
  active.status.inspectorPort = null;

  const finalStatus = { ...active.status };
  activeTunnels.delete(workspaceId);

  return finalStatus;
}

/**
 * Clear request logs for a workspace.
 */
export function clearRequests(workspaceId: string): boolean {
  const active = activeTunnels.get(workspaceId);
  if (active) {
    active.requests = [];
    return true;
  }
  return false;
}

/**
 * Clean up all tunnels and proxies when plugin is unloaded or daemon shuts down.
 */
export async function cleanupAll(): Promise<void> {
  const workspaceIds = Array.from(activeTunnels.keys());
  for (const id of workspaceIds) {
    await stopTunnel(id);
  }
}
