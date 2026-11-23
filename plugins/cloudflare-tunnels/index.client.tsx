import React from "react";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/ui";
import { TunnelsPanel } from "./client/tunnels-panel";
import { translations } from "./client/translations";
import { cloudflareIconSvg } from "./client/icons";
import { stopTunnelRpc, getTunnelStatusRpc } from "./shared/types";

export default function contribute(client: PluginClientContext) {
  // 1. Workspace panel contributing to both Explorer side panel (⌘E) and workspace tabs
  client.addWorkspacePanel({
    id: "cloudflare-tunnels",
    title: translations.message("panelTitle"),
    icon: { svg: cloudflareIconSvg },
    locations: ["explorer", "workspace"],
    Component: TunnelsPanel,
  });

  // 2. Command Center Items (⌘K)
  client.addCommandCenterItem({
    id: "cmd-open-cloudflare-tunnel",
    title: translations.message("commandCenterStart"),
    icon: { svg: cloudflareIconSvg },
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("cloudflare-tunnels");
    },
  });

  client.addCommandCenterItem({
    id: "cmd-stop-cloudflare-tunnel",
    title: translations.message("commandCenterStop"),
    icon: { svg: cloudflareIconSvg },
    context: "workspace",
    async onSelect({ rpc, workspace }) {
      if (workspace?.id) {
        await rpc(stopTunnelRpc, { workspaceId: workspace.id });
      }
    },
  });

  client.addCommandCenterItem({
    id: "cmd-copy-cloudflare-tunnel-url",
    title: translations.message("commandCenterCopy"),
    icon: { svg: cloudflareIconSvg },
    context: "workspace",
    async onSelect({ rpc, workspace }) {
      if (workspace?.id) {
        const res = await rpc(getTunnelStatusRpc, { workspaceId: workspace.id });
        if (res?.tunnel?.publicUrl) {
          try {
            await copyText(res.tunnel.publicUrl);
          } catch {
            // Ignore clipboard errors
          }
        }
      }
    },
  });

  return () => {};
}
