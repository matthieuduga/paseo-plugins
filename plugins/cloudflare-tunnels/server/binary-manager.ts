import { execFile } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { BinaryStatus } from "../shared/types";

const execFileAsync = promisify(execFile);

/**
 * Storage directory for the local cloudflared binary on the daemon machine.
 */
function getPluginStorageDir(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, ".paseo", "plugins", "cloudflare-tunnels");
}

export function getLocalBinaryPath(): string {
  const ext = process.platform === "win32" ? ".exe" : "";
  return path.join(getPluginStorageDir(), "bin", `cloudflared${ext}`);
}

let isDownloading = false;

/**
 * Inspect whether cloudflared is accessible in PATH or in plugin bin directory.
 */
export async function checkBinaryStatus(): Promise<BinaryStatus> {
  const platform = process.platform;
  const arch = process.arch;
  const canAutoDownload = ["linux", "darwin", "win32"].includes(platform);

  // 1. Check local plugin storage binary
  const localPath = getLocalBinaryPath();
  if (fs.existsSync(localPath)) {
    try {
      const { stdout } = await execFileAsync(localPath, ["--version"]);
      return {
        installed: true,
        path: localPath,
        version: stdout.trim(),
        downloading: isDownloading,
        canAutoDownload,
        platform,
        arch,
        error: null,
      };
    } catch {
      // Continue to check system PATH
    }
  }

  // 2. Check system PATH
  try {
    const { stdout } = await execFileAsync("cloudflared", ["--version"]);
    return {
      installed: true,
      path: "cloudflared",
      version: stdout.trim(),
      downloading: isDownloading,
      canAutoDownload,
      platform,
      arch,
      error: null,
    };
  } catch (err: any) {
    return {
      installed: false,
      path: null,
      version: null,
      downloading: isDownloading,
      canAutoDownload,
      platform,
      arch,
      error: isDownloading ? "Download in progress..." : null,
    };
  }
}

/**
 * Resolve the official Cloudflare release download URL for the host architecture.
 */
function getDownloadUrl(): { url: string; isTarGz: boolean } {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "linux") {
    if (arch === "x64") {
      return {
        url: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
        isTarGz: false,
      };
    }
    if (arch === "arm64") {
      return {
        url: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64",
        isTarGz: false,
      };
    }
    if (arch === "arm") {
      return {
        url: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm",
        isTarGz: false,
      };
    }
  }

  if (platform === "darwin") {
    if (arch === "arm64") {
      return {
        url: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz",
        isTarGz: true,
      };
    }
    return {
      url: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz",
      isTarGz: true,
    };
  }

  if (platform === "win32") {
    return {
      url: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
      isTarGz: false,
    };
  }

  throw new Error(`Unsupported platform or architecture: ${platform}-${arch}`);
}

/**
 * Helper to download a file with redirect follow.
 */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download binary: HTTP ${response.statusCode}`));
          return;
        }

        const fileStream = fs.createWriteStream(destPath);
        response.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close();
          resolve();
        });

        fileStream.on("error", (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      })
      .on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
}

/**
 * Download and install official cloudflared binary to ~/.paseo/plugins/cloudflare-tunnels/bin.
 */
export async function installBinary(): Promise<BinaryStatus> {
  if (isDownloading) {
    return checkBinaryStatus();
  }

  isDownloading = true;
  try {
    const { url, isTarGz } = getDownloadUrl();
    const binDir = path.join(getPluginStorageDir(), "bin");
    await fs.promises.mkdir(binDir, { recursive: true });

    const targetBinary = getLocalBinaryPath();

    if (isTarGz) {
      const tempTarPath = path.join(binDir, "cloudflared.tgz");
      await downloadFile(url, tempTarPath);
      // Extract tar archive into binDir
      await execFileAsync("tar", ["-xzf", tempTarPath, "-C", binDir]);
      await fs.promises.unlink(tempTarPath).catch(() => {});
    } else {
      await downloadFile(url, targetBinary);
    }

    // Ensure executable permissions on Unix
    if (process.platform !== "win32") {
      await fs.promises.chmod(targetBinary, 0o755);
    }

    return await checkBinaryStatus();
  } catch (err: any) {
    const status = await checkBinaryStatus();
    return {
      ...status,
      error: err.message || "Failed to download cloudflared binary",
    };
  } finally {
    isDownloading = false;
  }
}
