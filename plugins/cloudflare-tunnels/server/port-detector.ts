import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { DetectedPort } from "../shared/types";

const execAsync = promisify(exec);

/**
 * Common system / database ports to filter out from listening suggestions.
 */
const SYSTEM_PORTS = new Set([
  22, 53, 80, 443, 631, 3306, 5432, 6379, 8086, 9090, 9100, 27017, 28017,
]);

/**
 * Scan project files (.NET launchSettings.json, package.json, .env) and host listening ports.
 */
export async function detectPorts(projectRoot?: string): Promise<DetectedPort[]> {
  const portsMap = new Map<number, DetectedPort>();

  function addPort(port: number, label: string, source: DetectedPort["source"]) {
    if (port > 0 && port <= 65535 && !portsMap.has(port)) {
      portsMap.set(port, { port, label, source });
    }
  }

  // 1. Scan project directory if provided
  if (projectRoot && fs.existsSync(projectRoot)) {
    try {
      // 1.a ASP.NET Core C# launchSettings.json
      findAndParseLaunchSettings(projectRoot, addPort);

      // 1.b Node / JS / TS package.json
      parsePackageJson(projectRoot, addPort);

      // 1.c Environment files (.env, .env.local, etc.)
      parseEnvFiles(projectRoot, addPort);
    } catch {
      // Gracefully continue to socket scan
    }
  }

  // 2. Scan active listening ports on host (NAS / workstation)
  try {
    await scanListeningSockets(addPort);
  } catch {
    // Ignore socket scan errors
  }

  return Array.from(portsMap.values()).sort((a, b) => a.port - b.port);
}

/**
 * Recursively find and parse launchSettings.json up to 3 levels deep.
 */
function findAndParseLaunchSettings(
  dir: string,
  addPort: (port: number, label: string, source: DetectedPort["source"]) => void,
  depth = 0
) {
  if (depth > 3) return;

  const launchPath = path.join(dir, "Properties", "launchSettings.json");
  if (fs.existsSync(launchPath)) {
    try {
      const content = fs.readFileSync(launchPath, "utf-8");
      const json = JSON.parse(content);
      if (json.profiles) {
        for (const [profileName, profile] of Object.entries<any>(json.profiles)) {
          if (profile.applicationUrl) {
            const urls = String(profile.applicationUrl).split(";");
            for (const urlStr of urls) {
              const match = urlStr.match(/:(\d+)/);
              if (match) {
                const port = parseInt(match[1], 10);
                const protocol = urlStr.startsWith("https") ? "HTTPS" : "HTTP";
                addPort(port, `C# .NET (${profileName} - ${protocol})`, "launchSettings");
              }
            }
          }
        }
      }
    } catch {
      // Ignore invalid JSON
    }
  }

  // Search direct subdirectories if no launchSettings in current dir
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        entry.name !== "node_modules" &&
        entry.name !== "bin" &&
        entry.name !== "obj"
      ) {
        findAndParseLaunchSettings(path.join(dir, entry.name), addPort, depth + 1);
      }
    }
  } catch {
    // Ignore inaccessible directories
  }
}

/**
 * Parse package.json for dev scripts and frameworks.
 */
function parsePackageJson(
  projectRoot: string,
  addPort: (port: number, label: string, source: DetectedPort["source"]) => void
) {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const scripts = pkg.scripts ? Object.values(pkg.scripts).join(" ") : "";
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    // Check script arguments for port flags, e.g. --port 3000, -p 5173
    const portMatches = scripts.matchAll(/(?:--port|-p|\$PORT|PORT=)\s*(\d{2,5})/gi);
    for (const match of portMatches) {
      const port = parseInt(match[1], 10);
      addPort(port, `package.json script (--port ${port})`, "packageJson");
    }

    // Default framework ports
    if (deps.vite) addPort(5173, "Vite Dev Server", "packageJson");
    if (deps.next) addPort(3000, "Next.js App", "packageJson");
    if (deps.astro) addPort(4321, "Astro Site", "packageJson");
    if (deps.nuxt || deps.nuxt3) addPort(3000, "Nuxt App", "packageJson");
    if (deps["@angular/core"]) addPort(4200, "Angular App", "packageJson");
    if (deps["@remix-run/react"]) addPort(3000, "Remix App", "packageJson");
    if (deps.remix) addPort(3000, "Remix App", "packageJson");
    if (deps.svelte || deps["@sveltejs/kit"]) addPort(5173, "SvelteKit App", "packageJson");
  } catch {
    // Ignore JSON parse errors
  }
}

/**
 * Parse .env files for PORT specifications.
 */
function parseEnvFiles(
  projectRoot: string,
  addPort: (port: number, label: string, source: DetectedPort["source"]) => void
) {
  const envCandidates = [".env", ".env.local", ".env.development", ".env.dev"];
  for (const envFile of envCandidates) {
    const envPath = path.join(projectRoot, envFile);
    if (!fs.existsSync(envPath)) continue;

    try {
      const content = fs.readFileSync(envPath, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#")) continue;

        const match = trimmed.match(
          /^(?:PORT|VITE_PORT|APP_PORT|SERVER_PORT|ASPNETCORE_URLS)\s*=\s*"?([^"\r\n]+)"?/i
        );
        if (match) {
          const val = match[1];
          const numMatch = val.match(/:?(\d{2,5})/);
          if (numMatch) {
            const port = parseInt(numMatch[1], 10);
            addPort(port, `${envFile} (${trimmed.split("=")[0]})`, "env");
          }
        }
      }
    } catch {
      // Ignore file reading errors
    }
  }
}

/**
 * Scan active listening sockets using lsof or ss.
 */
async function scanListeningSockets(
  addPort: (port: number, label: string, source: DetectedPort["source"]) => void
) {
  const isMac = process.platform === "darwin";

  if (isMac) {
    try {
      const { stdout } = await execAsync("lsof -iTCP -sTCP:LISTEN -P -n");
      const lines = stdout.split("\n");
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 9) {
          const processName = parts[0];
          const address = parts[8];
          const portMatch = address.match(/:(\d+)$/);
          if (portMatch) {
            const port = parseInt(portMatch[1], 10);
            if (!SYSTEM_PORTS.has(port)) {
              addPort(port, `Listening socket (${processName})`, "listening");
            }
          }
        }
      }
      return;
    } catch {
      // Fall through to linux commands if lsof fails
    }
  }

  // Linux (NAS host)
  try {
    const { stdout } = await execAsync("ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null");
    const lines = stdout.split("\n");
    for (const line of lines) {
      const match = line.match(/:(\d+)\s+/);
      if (match) {
        const port = parseInt(match[1], 10);
        if (!SYSTEM_PORTS.has(port)) {
          // Check if process name is in the line (e.g. users:(("node",pid=123,fd=4)))
          const procMatch = line.match(/users:\(\("([^"]+)"/);
          const proc = procMatch ? procMatch[1] : "Active service";
          addPort(port, `Listening socket (${proc})`, "listening");
        }
      }
    }
  } catch {
    // Ignore fallback errors
  }
}
