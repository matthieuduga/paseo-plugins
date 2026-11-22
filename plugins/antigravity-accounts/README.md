# Google Antigravity Accounts for Paseo

Manage multiple **Google Antigravity AI Pro** subscriptions in [Paseo](https://paseo.sh) with live quota monitoring and seamless 1-click account switching.

[![Paseo Plugin](https://img.shields.io/badge/Paseo-Plugin%20v0.17%2B-blue)](https://paseo.sh)
[![License](https://img.shields.io/badge/License-Apache%202.0-green.svg)](../../LICENSE)

---

## ✨ Features

- **No Terminal / SSH Required**: Add new Google accounts directly from the Paseo UI through an interactive OAuth login wizard.
- **Real-Time Quota Gauges**: Live visualization of rolling 5-hour and weekly quotas for both **Gemini Models** and **Claude/GPT Models**.
- **Instant Hot-Swapping**: Switch active accounts on the fly with a single click. The underlying OAuth token is atomically swapped and quotas are refreshed immediately.
- **Multi-Language Support (9 Languages)**: Fully localized in English, French, Spanish, Arabic, Japanese, Korean, Brazilian Portuguese, Russian, and Simplified Chinese.
- **HTTP/HTTPS Resilient**: Includes link copying with automated fallbacks for HTTP environments and direct selectable URL displays.

---

## 📥 Installation

### CLI
```bash
paseo plugin add github:matthieuduga/paseo-plugins:plugins/antigravity-accounts
```

### Web / Desktop UI
1. Go to **Settings** $\rightarrow$ **Plugins**.
2. Click **Add Plugin** and enter:
   ```text
   github:matthieuduga/paseo-plugins:plugins/antigravity-accounts
   ```

---

## 📖 How It Works

Google Antigravity AI Pro enforces rolling 5-hour limits and weekly quota limits. By rotating across your distinct subscriptions, you maintain uninterrupted development workflows without waiting for quota resets.

1. Click **+ Add Google Account** in the plugin screen.
2. Open the generated Google OAuth URL (tip: use a private/incognito window to choose a specific Google account).
3. Grant access and copy the authorization code from the confirmation page (`4/0A...`).
4. Paste the code into Paseo and click **Connect Account**.
5. Your account is verified, quotas are fetched, and it is stored securely in the local vault.

---

## 🔒 Security & Privacy

- All tokens are stored locally on your Paseo host under `~/.paseo/antigravity-vault.json` with strict `0600` permissions.
- No tokens or credentials ever leave your machine or transit through external servers.

---

## 📄 License

Apache 2.0
