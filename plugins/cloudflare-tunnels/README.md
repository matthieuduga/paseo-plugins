# Cloudflare Tunnels for Paseo

Expose your local development servers running on your remote host or NAS directly to the web with **Cloudflare Tunnels**, featuring automatic multi-source port detection, live request inspection, and optional password protection.

[![Paseo Plugin](https://img.shields.io/badge/Paseo-Plugin%20v0.13%2B-blue)](https://paseo.sh)
[![License](https://img.shields.io/badge/License-Apache%202.0-green.svg)](../../LICENSE)

---

## ✨ Features

- **Explorer Sidebar Integration (⌘E)**: Scoped directly to each active workspace/project inside Paseo's explorer side panel and workspace tabs.
- **Zero-Config Quick Tunnels by Default**: Get an instant, secure public HTTPS URL (`https://*.trycloudflare.com`) without creating a Cloudflare account or managing DNS records.
- **Optional Named Tunnels**: Support for official Cloudflare Tunnel tokens to bind your workspace to your custom domain.
- **Smart Multi-Source Port Detection**:
  - **C# / .NET / ASP.NET Core**: Automatic discovery from `Properties/launchSettings.json`.
  - **JavaScript / TypeScript**: Automated extraction from `package.json` scripts (Vite, Next.js, Nuxt, Astro, Remix, Angular) and `.env` files.
  - **Host Sockets**: Live scanning of active listening TCP sockets on the daemon host / NAS.
- **1-Click Binary Downloader**: If `cloudflared` is not found in the host `PATH`, download the official binary automatically with a single click.
- **Integrated Live Request Inspector**: Monitor incoming HTTP requests in real time (Method, Path, HTTP Status, Response Duration in ms, Client IP).
- **Optional Password Lock**: Secure external access with a built-in dark-mode password challenge before traffic reaches your application.
- **WebSocket & HMR Ready**: Supports Hot Module Replacement (Vite, Next.js Fast Refresh) and SignalR WebSocket tunneling out of the box.
- **Multi-Language (9 Languages)**: Fully localized in English, French, Spanish, Arabic, Japanese, Korean, Portuguese, Russian, and Chinese.

---

## 📥 Installation

### Via Paseo CLI
```bash
paseo plugin add github:matthieuduga/paseo-plugins:plugins/cloudflare-tunnels
```

### Via Paseo Desktop / Web UI
1. Open Paseo settings (`Cmd+,` or click the settings cog).
2. Navigate to **Plugins** $\rightarrow$ **Install Plugin**.
3. Enter the plugin source:
   ```text
   github:matthieuduga/paseo-plugins:plugins/cloudflare-tunnels
   ```
4. Click **Install**.

---

## 🚀 Usage

1. Open your workspace in Paseo.
2. Open the **Explorer panel** (`⌘E`) or Command Center (`⌘K` $\rightarrow$ *Start Cloudflare Tunnel*).
3. Select your dev server port from the detected suggestions or enter a custom port.
4. *(Optional)* Expand **Security & Custom Domain Options** to set an access password or a Cloudflare named tunnel token.
5. Click **🚀 Start Tunnel**.
6. Copy the generated `https://*.trycloudflare.com` URL or open it directly in your browser.
7. Click **Live Request Inspector** to monitor incoming web traffic in real time.

---

## 🔒 Security & Privacy

- All configurations and tunnel states are stored locally on your daemon host at `~/.paseo/plugins/cloudflare-tunnels/state.json`.
- The plugin does not modify or commit any files inside your project's Git repository.
- Tunnels and loopback proxies are cleanly terminated whenever the workspace closes or the plugin reloads.
