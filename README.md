# Paseo Plugins (`@matthieuduga/paseo-plugins`)

A curated collection of open-source plugins for [Paseo](https://paseo.sh), the agentic coding orchestrator.

## 📦 Available Plugins

| Plugin | ID | Description | Installation |
| :--- | :--- | :--- | :--- |
| [**Cloudflare Tunnels**](./plugins/cloudflare-tunnels) | `cloudflare-tunnels` | Expose project dev servers running on your remote host or NAS with Cloudflare Tunnels (Quick Tunnels & Named Tunnels), multi-source port detection (C#, JS/TS), live request inspector, and password lock. | `paseo plugin add github:matthieuduga/paseo-plugins:plugins/cloudflare-tunnels` |
| [**Google Antigravity Accounts**](./plugins/antigravity-accounts) | `antigravity-accounts` | Manage multiple Google Antigravity AI Pro subscriptions, switch accounts seamlessly with live quota gauges, and connect new accounts directly with an interactive OAuth wizard. | `paseo plugin add github:matthieuduga/paseo-plugins:plugins/antigravity-accounts` |

---

## 🚀 Quick Install

### Via Paseo CLI
```bash
paseo plugin add github:matthieuduga/paseo-plugins:plugins/antigravity-accounts
```

### Via Paseo Desktop / Web UI
1. Open Paseo settings (`Cmd+,` or click the settings cog).
2. Navigate to **Plugins** $\rightarrow$ **Install Plugin**.
3. Enter the plugin source:
   ```text
   github:matthieuduga/paseo-plugins:plugins/antigravity-accounts
   ```
4. Click **Install**.

---

## 🛠️ Repository Structure

```text
paseo-plugins/
├── README.md
├── LICENSE
└── plugins/
    └── antigravity-accounts/        # Multi-account manager for Google Antigravity AI Pro
        ├── paseo-plugin.json        # Plugin manifest
        ├── package.json
        ├── index.client.tsx         # Client registration (screen, sidebar, command center)
        ├── index.server.ts          # Server RPC handlers
        ├── client/                  # React Native UI & 9-language i18n
        ├── server/                  # Daemon vault storage & OAuth process
        └── shared/                  # Shared Zod contracts & types
```

---

## 📄 License

Licensed under the [Apache 2.0 License](./LICENSE).
