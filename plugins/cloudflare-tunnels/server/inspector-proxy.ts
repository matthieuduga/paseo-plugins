import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import type { HttpRequestLog } from "../shared/types";

export interface ProxyOptions {
  targetPort: number;
  password?: string;
  onRequestLog?: (log: HttpRequestLog) => void;
}

export interface InspectorProxyInstance {
  port: number;
  close: () => Promise<void>;
  updateOptions: (opts: Partial<ProxyOptions>) => void;
}

/**
 * Generate a signature for cookie authentication based on the password.
 */
function getAuthToken(password: string): string {
  return crypto.createHash("sha256").update(`paseo-tunnel:${password}`).digest("hex");
}

/**
 * Render a sleek dark-mode HTML password gate.
 */
function renderPasswordPage(errorMsg?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Paseo Cloudflare Tunnel - Authentication</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: #0f1117; color: #f3f4f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; }
    .card { background-color: #1a1d27; border: 1px solid #2a2e3d; border-radius: 14px; padding: 32px; max-width: 400px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    .header { text-align: center; margin-bottom: 24px; }
    .icon { width: 48px; height: 48px; fill: #F38020; margin-bottom: 12px; }
    h1 { font-size: 20px; font-weight: 600; color: #fff; margin-bottom: 6px; }
    p { font-size: 13px; color: #9ca3af; }
    .error { background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #fca5a5; font-size: 13px; padding: 10px; border-radius: 8px; margin-bottom: 16px; text-align: center; }
    input[type="password"] { width: 100%; padding: 12px 14px; background: #0f1117; border: 1px solid #374151; border-radius: 8px; color: #fff; font-size: 14px; margin-bottom: 16px; outline: none; }
    input[type="password"]:focus { border-color: #F38020; ring: 2px solid #F38020; }
    button { width: 100%; padding: 12px; background: #F38020; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.15s; }
    button:hover { background: #e06c0d; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <svg class="icon" viewBox="0 0 24 24"><path d="M18.3 14.8c.1-.4.1-.7.1-1.1 0-2.8-2.3-5.1-5.1-5.1-2.4 0-4.4 1.7-4.9 3.9-.4-.3-.9-.4-1.4-.4-1.7 0-3 1.3-3 3 0 .3 0 .5.1.7C2.7 16.3 1.5 17.8 1.5 19.6c0 2.4 1.9 4.4 4.4 4.4h12.6c2.4 0 4.4-1.9 4.4-4.4 0-2.1-1.5-3.8-3.6-4.2l-1-.6z"/></svg>
      <h1>Paseo Protected Tunnel</h1>
      <p>Enter the access password to continue to this workspace</p>
    </div>
    ${errorMsg ? `<div class="error">${errorMsg}</div>` : ""}
    <form method="POST" action="/_paseo_tunnel_login">
      <input type="password" name="password" placeholder="Access Password" autofocus required />
      <button type="submit">Unlock Workspace</button>
    </form>
  </div>
</body>
</html>`;
}

/**
 * Start a local loopback proxy supporting request inspection, WebSocket forwarding, and password authentication.
 */
export async function createInspectorProxy(
  initialOptions: ProxyOptions
): Promise<InspectorProxyInstance> {
  let options = { ...initialOptions };

  const server = http.createServer((req, res) => {
    const startTime = Date.now();
    const clientIp =
      (req.headers["cf-connecting-ip"] as string) ||
      (req.headers["x-forwarded-for"] as string) ||
      req.socket.remoteAddress ||
      "127.0.0.1";

    function logResponse(statusCode: number) {
      if (options.onRequestLog) {
        options.onRequestLog({
          id: crypto.randomUUID(),
          timestamp: startTime,
          method: req.method || "GET",
          path: req.url || "/",
          statusCode,
          durationMs: Date.now() - startTime,
          clientIp,
        });
      }
    }

    // 1. Check password verification endpoint
    if (options.password && req.url === "/_paseo_tunnel_login" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1e6) req.destroy();
      });

      req.on("end", () => {
        const params = new URLSearchParams(body);
        const submittedPassword = params.get("password");
        if (submittedPassword === options.password) {
          const token = getAuthToken(options.password);
          res.writeHead(302, {
            Location: "/",
            "Set-Cookie": `paseo_tunnel_auth=${token}; Path=/; HttpOnly; SameSite=Lax`,
          });
          res.end();
          logResponse(302);
        } else {
          const html = renderPasswordPage("Incorrect password. Please try again.");
          res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
          logResponse(401);
        }
      });
      return;
    }

    // 2. Enforce password protection if configured
    if (options.password) {
      const cookieHeader = req.headers.cookie || "";
      const expectedToken = getAuthToken(options.password);
      const isAuthed = cookieHeader
        .split(";")
        .some((item) => item.trim() === `paseo_tunnel_auth=${expectedToken}`);

      if (!isAuthed) {
        const html = renderPasswordPage();
        res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        logResponse(401);
        return;
      }
    }

    // 3. Proxy request forward to targetPort
    const proxyReq = http.request(
      {
        host: "127.0.0.1",
        port: options.targetPort,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: `localhost:${options.targetPort}`,
          "x-forwarded-host": req.headers.host || `localhost:${options.targetPort}`,
          "x-forwarded-proto": req.headers["x-forwarded-proto"] || "http",
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
        proxyRes.on("end", () => {
          logResponse(proxyRes.statusCode || 200);
        });
      }
    );

    proxyReq.on("error", (err) => {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(`Paseo Tunnel: Bad Gateway to 127.0.0.1:${options.targetPort} (${err.message})`);
      logResponse(502);
    });

    req.pipe(proxyReq);
  });

  // Handle WebSocket upgrade forwarding (Crucial for Vite HMR, Next.js Fast Refresh, SignalR)
  server.on("upgrade", (req, clientSocket, head) => {
    // If password is required, verify cookie
    if (options.password) {
      const cookieHeader = req.headers.cookie || "";
      const expectedToken = getAuthToken(options.password);
      const isAuthed = cookieHeader
        .split(";")
        .some((item) => item.trim() === `paseo_tunnel_auth=${expectedToken}`);
      if (!isAuthed) {
        clientSocket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        clientSocket.destroy();
        return;
      }
    }

    const targetSocket = net.connect(options.targetPort, "127.0.0.1", () => {
      clientSocket.write(
        `HTTP/1.1 101 Switching Protocols\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n\r\n`
      );
      targetSocket.pipe(clientSocket);
      clientSocket.pipe(targetSocket);
    });

    targetSocket.on("error", () => {
      clientSocket.destroy();
    });
    clientSocket.on("error", () => {
      targetSocket.destroy();
    });
  });

  // Listen on random available port on loopback
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const address = server.address() as net.AddressInfo;

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
    updateOptions: (newOpts) => {
      options = { ...options, ...newOpts };
    },
  };
}
