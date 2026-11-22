import React from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { AccountsScreen } from "./client/accounts-screen";
import { translations } from "./client/translations";
import { antigravityIconSvg } from "./client/icons";

function AccountsSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon={{ svg: antigravityIconSvg }}
      active={currentScreen?.screenId === "antigravity-accounts"}
      onPress={() => openScreen({ screenId: "antigravity-accounts" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({
    id: "antigravity-accounts",
    title: translations.message("screenTitle"),
    Component: AccountsScreen,
  });

  client.addSidebarFooterItem({
    id: "antigravity-accounts-nav",
    title: translations.message("sidebarTitle"),
    Component: AccountsSidebarItem,
  });

  client.addCommandCenterItem({
    id: "cmd-switch-antigravity",
    title: translations.message("commandCenterTitle"),
    icon: { svg: antigravityIconSvg },
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "antigravity-accounts" });
    },
  });

  return () => {};
}
