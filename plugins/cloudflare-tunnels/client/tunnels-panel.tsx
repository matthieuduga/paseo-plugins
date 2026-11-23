import React, { useMemo, useState } from "react";
import {
  type PluginWorkspacePanelProps,
  useRpc,
  useWorkspace,
  useTranslation,
} from "@getpaseo/plugin/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useToast, copyText, ExternalLink, Icon } from "@getpaseo/plugin/client/ui";
import { cloudflareIconSvg } from "./icons";
import {
  getTunnelStatusRpc,
  detectPortsRpc,
  startTunnelRpc,
  stopTunnelRpc,
  installBinaryRpc,
  clearRequestsRpc,
  type DetectedPort,
} from "../shared/types";
import { translations } from "./translations";

/**
 * Robust clipboard copy helper for Paseo's webview/Electron environment.
 * Executes document.execCommand('copy') synchronously within the user event loop,
 * with fallbacks to navigator.clipboard and Paseo's copyText.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  // Strategy 1: Hidden textarea with document.execCommand('copy')
  // Runs synchronously inside the user gesture event handler; succeeds even if document.hasFocus() is false in webviews
  if (typeof document !== "undefined") {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.top = "-9999px";
      textarea.style.left = "-9999px";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (success) {
        return true;
      }
    } catch {
      // Fallback
    }
  }

  // Strategy 2: Modern Navigator Clipboard API
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback
    }
  }

  // Strategy 3: Paseo built-in copyText
  try {
    await copyText(text);
    return true;
  } catch {
    // Failed
  }

  return false;
}

export function TunnelsPanel({
  theme,
  layout,
  workspaceId,
}: PluginWorkspacePanelProps) {
  const { t } = useTranslation(translations);
  const toast = useToast();
  const queryClient = useQueryClient();
  const projectRootPath = useWorkspace(workspaceId, (w) => w?.projectRootPath);

  // RPC Hooks
  const getStatus = useRpc(getTunnelStatusRpc);
  const detectPorts = useRpc(detectPortsRpc);
  const startTunnel = useRpc(startTunnelRpc);
  const stopTunnel = useRpc(stopTunnelRpc);
  const installBinary = useRpc(installBinaryRpc);
  const clearRequests = useRpc(clearRequestsRpc);

  // Local Form State
  const [portInput, setPortInput] = useState<string>("5173");
  const [passwordInput, setPasswordInput] = useState<string>("");
  const [tokenInput, setTokenInput] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [showInspector, setShowInspector] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Status Query (Polled every 2.5s if active or starting)
  const { data: statusData } = useQuery({
    queryKey: ["cloudflare-tunnel-status", workspaceId],
    queryFn: () => getStatus({ workspaceId }),
    refetchInterval: (query) => {
      const state = query.state.data?.tunnel?.state;
      return state === "running" || state === "starting" ? 2500 : 8000;
    },
  });

  const tunnel = statusData?.tunnel;
  const binary = statusData?.binary;
  const requests = statusData?.requests || [];

  // Update portInput if tunnel is already initialized with another port
  React.useEffect(() => {
    if (tunnel?.port && tunnel.port > 0) {
      setPortInput(String(tunnel.port));
    }
  }, [tunnel?.port]);

  // Detected Ports Query
  const {
    data: portsData,
    refetch: refetchPorts,
    isFetching: isDetectingPorts,
  } = useQuery({
    queryKey: ["cloudflare-detect-ports", workspaceId, projectRootPath],
    queryFn: () =>
      detectPorts({
        workspaceId,
        projectRootPath: projectRootPath ?? undefined,
      }),
    staleTime: 30000,
  });

  const detectedPorts = portsData?.ports || [];

  // Mutations
  const startMutation = useMutation({
    mutationFn: () => {
      const port = parseInt(portInput, 10) || 5173;
      return startTunnel({
        workspaceId,
        port,
        password: passwordInput ? passwordInput : undefined,
        token: tokenInput ? tokenInput : undefined,
        projectRootPath: projectRootPath ?? undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["cloudflare-tunnel-status", workspaceId],
      });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => stopTunnel({ workspaceId }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["cloudflare-tunnel-status", workspaceId],
      });
    },
  });

  const installMutation = useMutation({
    mutationFn: () => installBinary({}),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["cloudflare-tunnel-status", workspaceId],
      });
    },
  });

  const clearLogsMutation = useMutation({
    mutationFn: () => clearRequests({ workspaceId }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["cloudflare-tunnel-status", workspaceId],
      });
    },
  });

  const isRunning = tunnel?.state === "running";
  const isStarting = tunnel?.state === "starting" || startMutation.isPending;
  const isStopping = stopMutation.isPending;

  // Copy URL to clipboard with resilient fallbacks and visual feedback
  const handleCopyUrl = async () => {
    if (!tunnel?.publicUrl) return;
    const ok = await copyToClipboard(tunnel.publicUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      try {
        toast.show(t("urlCopied"));
      } catch {
        // toast optional
      }
    }
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: theme.colors.surface0,
          padding: layout.compact ? 12 : 16,
        },
        card: {
          backgroundColor: theme.colors.surface1 ?? "#161922",
          borderRadius: 12,
          padding: layout.compact ? 14 : 16,
          borderWidth: 1,
          borderColor: theme.colors.border ?? "#282c3a",
          marginBottom: 16,
        },
        headerRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        },
        titleRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        },
        title: {
          color: theme.colors.foreground,
          fontSize: layout.compact ? 15 : 17,
          fontWeight: "700",
        },
        badge: {
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 6,
        },
        badgeText: {
          fontSize: 11,
          fontWeight: "700",
          letterSpacing: 0.5,
        },
        badgeRunning: {
          backgroundColor: "rgba(34, 197, 94, 0.15)",
        },
        badgeRunningText: {
          color: "#4ade80",
        },
        badgeStopped: {
          backgroundColor: "rgba(156, 163, 175, 0.15)",
        },
        badgeStoppedText: {
          color: "#9ca3af",
        },
        badgeStarting: {
          backgroundColor: "rgba(234, 179, 8, 0.15)",
        },
        badgeStartingText: {
          color: "#facc15",
        },
        badgeError: {
          backgroundColor: "rgba(239, 68, 68, 0.15)",
        },
        badgeErrorText: {
          color: "#f87171",
        },
        activeTunnelCard: {
          backgroundColor: theme.colors.surface0,
          borderRadius: 8,
          padding: 12,
          borderWidth: 1,
          borderColor: theme.colors.border ?? "#282c3a",
          marginBottom: 12,
        },
        urlHeaderRow: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        },
        urlSectionTitle: {
          fontSize: 11,
          color: theme.colors.foregroundMuted ?? "#9ca3af",
          textTransform: "uppercase",
          fontWeight: "700",
          letterSpacing: 0.5,
        },
        forwardingPill: {
          backgroundColor: "rgba(243, 128, 32, 0.12)",
          paddingHorizontal: 8,
          paddingVertical: 2,
          borderRadius: 4,
        },
        forwardingPillText: {
          color: "#F38020",
          fontSize: 11,
          fontWeight: "600",
        },
        urlLinkRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        },
        linkWrapper: {
          flex: 1,
          minWidth: 0,
        },
        copyBtn: {
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 6,
          backgroundColor: "rgba(243, 128, 32, 0.12)",
          borderWidth: 1,
          borderColor: "rgba(243, 128, 32, 0.35)",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          flexShrink: 0,
        },
        copyBtnSuccess: {
          backgroundColor: "rgba(34, 197, 94, 0.15)",
          borderColor: "rgba(34, 197, 94, 0.5)",
        },
        copyBtnText: {
          color: "#F38020",
          fontSize: 12,
          fontWeight: "600",
        },
        copyBtnTextSuccess: {
          color: "#4ade80",
        },
        label: {
          fontSize: 12,
          fontWeight: "600",
          color: theme.colors.foregroundMuted ?? "#9ca3af",
          marginBottom: 6,
        },
        input: {
          backgroundColor: theme.colors.surface0,
          borderWidth: 1,
          borderColor: theme.colors.border ?? "#282c3a",
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 10,
          color: theme.colors.foreground,
          fontSize: 14,
          marginBottom: 12,
        },
        portsSection: {
          marginBottom: 14,
        },
        portsHeaderRow: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
        },
        portsList: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 6,
        },
        portPill: {
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 6,
          backgroundColor: theme.colors.surface0,
          borderWidth: 1,
          borderColor: theme.colors.border ?? "#374151",
        },
        portPillActive: {
          borderColor: "#F38020",
          backgroundColor: "rgba(243, 128, 32, 0.15)",
        },
        portPillText: {
          fontSize: 12,
          color: theme.colors.foreground,
        },
        portPillTextActive: {
          color: "#F38020",
          fontWeight: "600",
        },
        scanBtn: {
          paddingHorizontal: 8,
          paddingVertical: 2,
        },
        scanBtnText: {
          fontSize: 11,
          color: "#F38020",
        },
        primaryBtn: {
          backgroundColor: "#F38020",
          paddingVertical: 12,
          borderRadius: 8,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 8,
          marginTop: 6,
        },
        primaryBtnText: {
          color: "#ffffff",
          fontSize: 14,
          fontWeight: "700",
        },
        stopBtn: {
          borderWidth: 1,
          borderColor: "rgba(239, 68, 68, 0.45)",
          backgroundColor: "transparent",
          paddingVertical: 10,
          borderRadius: 8,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 8,
          marginTop: 4,
        },
        stopBtnText: {
          color: "#f87171",
          fontSize: 13,
          fontWeight: "600",
        },
        toggleBtn: {
          paddingVertical: 8,
          alignItems: "center",
          marginTop: 4,
        },
        toggleBtnText: {
          fontSize: 12,
          color: theme.colors.foregroundMuted ?? "#9ca3af",
          textDecorationLine: "underline",
        },
        bannerWarning: {
          backgroundColor: "rgba(234, 179, 8, 0.1)",
          borderWidth: 1,
          borderColor: "rgba(234, 179, 8, 0.3)",
          borderRadius: 8,
          padding: 12,
          marginBottom: 14,
        },
        bannerTitle: {
          color: "#facc15",
          fontSize: 13,
          fontWeight: "700",
          marginBottom: 4,
        },
        bannerDesc: {
          color: theme.colors.foregroundMuted ?? "#d1d5db",
          fontSize: 12,
          lineHeight: 16,
          marginBottom: 8,
        },
        downloadBtn: {
          backgroundColor: "#F38020",
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: 6,
          alignItems: "center",
        },
        downloadBtnText: {
          color: "#fff",
          fontSize: 12,
          fontWeight: "600",
        },
        inspectorCard: {
          backgroundColor: theme.colors.surface1 ?? "#161922",
          borderRadius: 12,
          padding: 14,
          borderWidth: 1,
          borderColor: theme.colors.border ?? "#282c3a",
        },
        inspectorHeader: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        },
        inspectorTitle: {
          color: theme.colors.foreground,
          fontSize: 14,
          fontWeight: "700",
        },
        clearText: {
          color: theme.colors.foregroundMuted ?? "#9ca3af",
          fontSize: 12,
        },
        requestRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: "rgba(255,255,255,0.05)",
        },
        methodPill: {
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: 4,
          marginRight: 8,
        },
        methodGet: { backgroundColor: "rgba(59, 130, 246, 0.15)" },
        methodPost: { backgroundColor: "rgba(34, 197, 94, 0.15)" },
        methodPut: { backgroundColor: "rgba(234, 179, 8, 0.15)" },
        methodDelete: { backgroundColor: "rgba(239, 68, 68, 0.15)" },
        methodOther: { backgroundColor: "rgba(156, 163, 175, 0.15)" },
        methodText: { fontSize: 11, fontWeight: "700" },
        methodTextGet: { color: "#60a5fa" },
        methodTextPost: { color: "#4ade80" },
        methodTextPut: { color: "#facc15" },
        methodTextDelete: { color: "#f87171" },
        methodTextOther: { color: "#9ca3af" },
        pathText: {
          flex: 1,
          color: theme.colors.foreground,
          fontSize: 12,
          marginRight: 8,
        },
        statusBadge: {
          fontSize: 11,
          fontWeight: "600",
          marginRight: 6,
        },
        status2xx: { color: "#4ade80" },
        status3xx: { color: "#60a5fa" },
        status4xx: { color: "#facc15" },
        status5xx: { color: "#f87171" },
        durationText: {
          color: theme.colors.foregroundMuted ?? "#6b7280",
          fontSize: 11,
        },
        emptyLogs: {
          color: theme.colors.foregroundMuted ?? "#6b7280",
          fontSize: 12,
          textAlign: "center",
          paddingVertical: 14,
          fontStyle: "italic",
        },
      }),
    [theme, layout.compact]
  );

  return (
    <ScrollView style={styles.container}>
      {/* Missing Binary Warning Banner */}
      {binary && !binary.installed && (
        <View style={styles.bannerWarning}>
          <Text style={styles.bannerTitle}>
            {t("binaryMissingTitle")}
          </Text>
          <Text style={styles.bannerDesc}>
            {t("binaryMissingDesc")}
          </Text>
          {binary.canAutoDownload && (
            <Pressable
              style={styles.downloadBtn}
              onPress={() => installMutation.mutate()}
              disabled={installMutation.isPending || binary.downloading}
            >
              {installMutation.isPending || binary.downloading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.downloadBtnText}>
                  {t("downloadBinary")}
                </Text>
              )}
            </Pressable>
          )}
        </View>
      )}

      {/* Main Tunnel Card */}
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.titleRow}>
            <Icon icon={{ svg: cloudflareIconSvg }} size={20} color="#F38020" />
            <Text style={styles.title}>
              {t("panelTitle")}
            </Text>
          </View>
          <View
            style={[
              styles.badge,
              isRunning && styles.badgeRunning,
              tunnel?.state === "stopped" && styles.badgeStopped,
              isStarting && styles.badgeStarting,
              tunnel?.state === "error" && styles.badgeError,
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                isRunning && styles.badgeRunningText,
                tunnel?.state === "stopped" && styles.badgeStoppedText,
                isStarting && styles.badgeStartingText,
                tunnel?.state === "error" && styles.badgeErrorText,
              ]}
            >
              {isStarting
                ? t("statusStarting")
                : isRunning
                ? t("statusRunning")
                : tunnel?.state === "error"
                ? t("statusError")
                : t("statusStopped")}
            </Text>
          </View>
        </View>

        {/* Error message if any */}
        {tunnel?.error && (
          <View style={[styles.bannerWarning, { borderColor: "#ef4444" }]}>
            <Text style={[styles.bannerTitle, { color: "#f87171" }]}>
              {tunnel.error}
            </Text>
          </View>
        )}

        {/* Public URL Box when Active */}
        {isRunning && tunnel?.publicUrl && (
          <View style={styles.activeTunnelCard}>
            <View style={styles.urlHeaderRow}>
              <Text style={styles.urlSectionTitle}>
                {t("publicUrl")}
              </Text>
              <View style={styles.forwardingPill}>
                <Text style={styles.forwardingPillText}>
                  :{tunnel.localPort ?? portInput} ➔ Cloudflare
                </Text>
              </View>
            </View>

            <View style={styles.urlLinkRow}>
              <View style={styles.linkWrapper}>
                <ExternalLink
                  href={tunnel.publicUrl}
                  label={tunnel.publicUrl}
                  accessibilityLabel={t("publicUrl")}
                />
              </View>
              <Pressable
                style={[styles.copyBtn, copied && styles.copyBtnSuccess]}
                onPress={handleCopyUrl}
                accessibilityLabel={t("copyUrl")}
                hitSlop={8}
              >
                <Text
                  style={[
                    styles.copyBtnText,
                    copied && styles.copyBtnTextSuccess,
                  ]}
                >
                  {copied ? `✓ ${t("copied")}` : `📋 ${t("copyUrl")}`}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Configuration inputs if tunnel is stopped */}
        {!isRunning && (
          <>
            <Text style={styles.label}>
              {t("targetPort")}
            </Text>
            <TextInput
              style={styles.input}
              value={portInput}
              onChangeText={setPortInput}
              keyboardType="numeric"
              placeholder="5173"
              placeholderTextColor="#6b7280"
              editable={!isStarting}
            />

            {/* Detected Ports Suggestions */}
            {detectedPorts.length > 0 && (
              <View style={styles.portsSection}>
                <View style={styles.portsHeaderRow}>
                  <Text style={styles.label}>
                    {t("detectedPorts")}
                  </Text>
                  <Pressable
                    style={styles.scanBtn}
                    onPress={() => refetchPorts()}
                    disabled={isDetectingPorts}
                  >
                    <Text style={styles.scanBtnText}>
                      {isDetectingPorts
                        ? "..."
                        : `🔄 ${t("detectPortsBtn")}`}
                    </Text>
                  </Pressable>
                </View>
                <View style={styles.portsList}>
                  {detectedPorts.map((dp: DetectedPort) => {
                    const isSelected = portInput === String(dp.port);
                    return (
                      <Pressable
                        key={`${dp.source}-${dp.port}`}
                        style={[
                          styles.portPill,
                          isSelected && styles.portPillActive,
                        ]}
                        onPress={() => setPortInput(String(dp.port))}
                      >
                        <Text
                          style={[
                            styles.portPillText,
                            isSelected && styles.portPillTextActive,
                          ]}
                        >
                          {dp.port} • {dp.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Advanced Settings Toggle */}
            <Pressable
              style={styles.toggleBtn}
              onPress={() => setShowAdvanced(!showAdvanced)}
            >
              <Text style={styles.toggleBtnText}>
                {showAdvanced
                  ? `▲ ${t("advancedOptions")}`
                  : `▼ ${t("advancedOptions")}`}
              </Text>
            </Pressable>

            {showAdvanced && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.label}>
                  {t("passwordLabel")}
                </Text>
                <TextInput
                  style={styles.input}
                  value={passwordInput}
                  onChangeText={setPasswordInput}
                  placeholder={t("passwordPlaceholder")}
                  placeholderTextColor="#6b7280"
                  secureTextEntry
                />

                <Text style={styles.label}>
                  {t("tokenLabel")}
                </Text>
                <TextInput
                  style={styles.input}
                  value={tokenInput}
                  onChangeText={setTokenInput}
                  placeholder={t("tokenPlaceholder")}
                  placeholderTextColor="#6b7280"
                />
              </View>
            )}

            {/* Start Button */}
            <Pressable
              style={styles.primaryBtn}
              onPress={() => startMutation.mutate()}
              disabled={isStarting || (binary && !binary.installed)}
            >
              {isStarting ? (
                <>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.primaryBtnText}>
                    {t("startingTunnel")}
                  </Text>
                </>
              ) : (
                <Text style={styles.primaryBtnText}>
                  🚀 {t("startTunnel")}
                </Text>
              )}
            </Pressable>
          </>
        )}

        {/* Stop Button when active */}
        {isRunning && (
          <Pressable
            style={styles.stopBtn}
            onPress={() => stopMutation.mutate()}
            disabled={isStopping}
          >
            {isStopping ? (
              <>
                <ActivityIndicator size="small" color="#f87171" />
                <Text style={styles.stopBtnText}>
                  {t("stoppingTunnel")}
                </Text>
              </>
            ) : (
              <Text style={styles.stopBtnText}>
                ⏹ {t("stopTunnel")}
              </Text>
            )}
          </Pressable>
        )}
      </View>

      {/* Traffic Inspector (Always available or collapsible) */}
      <View style={styles.inspectorCard}>
        <View style={styles.inspectorHeader}>
          <Pressable onPress={() => setShowInspector(!showInspector)}>
            <Text style={styles.inspectorTitle}>
              {showInspector ? "▼" : "▶"}{" "}
              {t("trafficInspector")} ({requests.length})
            </Text>
          </Pressable>
          {requests.length > 0 && showInspector && (
            <Pressable onPress={() => clearLogsMutation.mutate()}>
              <Text style={styles.clearText}>
                {t("clearLogs")}
              </Text>
            </Pressable>
          )}
        </View>

        {showInspector && (
          <View>
            {requests.length === 0 ? (
              <Text style={styles.emptyLogs}>
                {t("noRequestsYet")}
              </Text>
            ) : (
              requests.slice(0, 15).map((req) => {
                const method = req.method.toUpperCase();
                let methodStyle = styles.methodOther;
                let methodTextStyle = styles.methodTextOther;

                if (method === "GET") {
                  methodStyle = styles.methodGet;
                  methodTextStyle = styles.methodTextGet;
                } else if (method === "POST") {
                  methodStyle = styles.methodPost;
                  methodTextStyle = styles.methodTextPost;
                } else if (method === "PUT" || method === "PATCH") {
                  methodStyle = styles.methodPut;
                  methodTextStyle = styles.methodTextPut;
                } else if (method === "DELETE") {
                  methodStyle = styles.methodDelete;
                  methodTextStyle = styles.methodTextDelete;
                }

                let statusStyle = styles.status2xx;
                if (req.statusCode >= 300 && req.statusCode < 400) {
                  statusStyle = styles.status3xx;
                } else if (req.statusCode >= 400 && req.statusCode < 500) {
                  statusStyle = styles.status4xx;
                } else if (req.statusCode >= 500) {
                  statusStyle = styles.status5xx;
                }

                return (
                  <View key={req.id} style={styles.requestRow}>
                    <View style={[styles.methodPill, methodStyle]}>
                      <Text style={[styles.methodText, methodTextStyle]}>
                        {method}
                      </Text>
                    </View>
                    <Text style={styles.pathText} numberOfLines={1}>
                      {req.path}
                    </Text>
                    <Text style={[styles.statusBadge, statusStyle]}>
                      {req.statusCode}
                    </Text>
                    <Text style={styles.durationText}>{req.durationMs}ms</Text>
                  </View>
                );
              })
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
