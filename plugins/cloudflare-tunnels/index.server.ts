import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  getTunnelStatusRpc,
  detectPortsRpc,
  startTunnelRpc,
  stopTunnelRpc,
  installBinaryRpc,
  clearRequestsRpc,
} from "./shared/types";
import { checkBinaryStatus, installBinary } from "./server/binary-manager";
import { detectPorts } from "./server/port-detector";
import {
  getTunnelStatus,
  startTunnel,
  stopTunnel,
  clearRequests,
  cleanupAll,
} from "./server/tunnel-manager";

export default function contribute(server: PluginServerContext) {
  // 1. Get status of tunnel, binary and recent requests
  server.handle(getTunnelStatusRpc, async ({ workspaceId }) => {
    const { tunnel, requests } = getTunnelStatus(workspaceId);
    const binary = await checkBinaryStatus();
    return {
      tunnel,
      binary,
      requests,
    };
  });

  // 2. Detect candidate ports for the workspace
  server.handle(detectPortsRpc, async ({ projectRootPath }) => {
    const ports = await detectPorts(projectRootPath);
    return { ports };
  });

  // 3. Start a tunnel
  server.handle(startTunnelRpc, async ({ workspaceId, port, password, token }) => {
    const tunnel = await startTunnel({ workspaceId, port, password, token });
    return { tunnel };
  });

  // 4. Stop a tunnel
  server.handle(stopTunnelRpc, async ({ workspaceId }) => {
    const tunnel = await stopTunnel(workspaceId);
    return { tunnel };
  });

  // 5. Install binary
  server.handle(installBinaryRpc, async () => {
    return await installBinary();
  });

  // 6. Clear requests history
  server.handle(clearRequestsRpc, async ({ workspaceId }) => {
    const success = clearRequests(workspaceId);
    return { success };
  });

  // Cleanup on plugin teardown / reload
  return async () => {
    await cleanupAll();
  };
}
