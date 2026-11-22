import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
} from "react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import {
  ScrollView,
  TextInput,
  ExternalLink,
  copyText,
  useToast,
} from "@getpaseo/plugin/client/ui";
import {
  listAccountsRpc,
  startLoginFlowRpc,
  submitAuthCodeRpc,
  cancelLoginFlowRpc,
  selectAccountRpc,
  deleteAccountRpc,
  refreshQuotaRpc,
  type VaultStatus,
  type AntigravityAccount,
  type QuotaEntry,
} from "../shared/types";
import { translations } from "./translations";

type WizardStep = "idle" | "generating" | "awaiting_code" | "submitting";

export function AccountsScreen({ theme, layout }: PluginScreenProps) {
  const toast = useToast();
  const { t } = useTranslation(translations);

  // RPC Hooks
  const listAccounts = useRpc(listAccountsRpc);
  const startLoginFlow = useRpc(startLoginFlowRpc);
  const submitAuthCode = useRpc(submitAuthCodeRpc);
  const cancelLoginFlow = useRpc(cancelLoginFlowRpc);
  const selectAccount = useRpc(selectAccountRpc);
  const deleteAccount = useRpc(deleteAccountRpc);
  const refreshQuota = useRpc(refreshQuotaRpc);

  // Screen State
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  // Multi-step Wizard State
  const [wizardStep, setWizardStep] = useState<WizardStep>("idle");
  const [wizardSessionId, setWizardSessionId] = useState<string | null>(null);
  const [wizardAuthUrl, setWizardAuthUrl] = useState<string | null>(null);
  const [authCodeInput, setAuthCodeInput] = useState("");
  const [wizardError, setWizardError] = useState<string | null>(null);

  // Load account list from server
  const refresh = useCallback(async () => {
    try {
      setErrorMsg(null);
      const res = await listAccounts({});
      setStatus(res);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load Antigravity accounts.");
    } finally {
      setLoading(false);
    }
  }, [listAccounts]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /* ------------------------------------------------------------------------ */
  /* Login Wizard Handlers                                                    */
  /* ------------------------------------------------------------------------ */

  const handleStartLogin = async () => {
    try {
      setWizardError(null);
      setAuthCodeInput("");
      setWizardStep("generating");
      const { sessionId, authUrl } = await startLoginFlow({});
      setWizardSessionId(sessionId);
      setWizardAuthUrl(authUrl);
      setWizardStep("awaiting_code");
    } catch (err: any) {
      setWizardError(err?.message || "Failed to initialize Google login session.");
      setWizardStep("idle");
    }
  };

  const handleCancelLogin = async () => {
    if (wizardSessionId) {
      try {
        await cancelLoginFlow({ sessionId: wizardSessionId });
      } catch {}
    }
    setWizardStep("idle");
    setWizardSessionId(null);
    setWizardAuthUrl(null);
    setAuthCodeInput("");
    setWizardError(null);
  };

  const handleSubmitCode = async () => {
    if (!wizardSessionId || !authCodeInput.trim()) return;

    try {
      setWizardStep("submitting");
      setWizardError(null);
      const newStatus = await submitAuthCode({
        sessionId: wizardSessionId,
        code: authCodeInput.trim(),
      });
      setStatus(newStatus);
      toast.show(t("accountConnected"), { variant: "success" });
      setWizardStep("idle");
      setWizardSessionId(null);
      setWizardAuthUrl(null);
      setAuthCodeInput("");
    } catch (err: any) {
      setWizardError(err?.message || "Invalid authorization code or authentication failed.");
      setWizardStep("awaiting_code");
    }
  };

  /**
   * Resilient copy handler with fallbacks for HTTP / non-secure contexts.
   */
  const handleCopyLink = async () => {
    if (!wizardAuthUrl) return;

    // 1. Try modern navigator.clipboard API if available
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(wizardAuthUrl);
        toast.show(t("linkCopied"), { variant: "info" });
        return;
      }
    } catch {}

    // 2. Try Paseo's built-in copyText
    try {
      await copyText(wizardAuthUrl);
      toast.show(t("linkCopied"), { variant: "info" });
      return;
    } catch {}

    // 3. Fallback for non-secure HTTP contexts via temporary textarea execCommand
    try {
      if (typeof document !== "undefined") {
        const textArea = document.createElement("textarea");
        textArea.value = wizardAuthUrl;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand("copy");
        document.body.removeChild(textArea);
        if (successful) {
          toast.show(t("linkCopied"), { variant: "info" });
          return;
        }
      }
    } catch {}

    // 4. If all clipboard writes fail (browser security restrictions on HTTP)
    toast.show(t("copyFallbackHint"), { variant: "warning" });
  };

  /* ------------------------------------------------------------------------ */
  /* Account Management Handlers                                              */
  /* ------------------------------------------------------------------------ */

  const handleSelect = async (accountId: string) => {
    try {
      setBusyAction(`select-${accountId}`);
      setErrorMsg(null);
      const res = await selectAccount({ accountId });
      setStatus(res);
      toast.show(t("accountSwitched"), { variant: "success" });
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to switch account.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleRefreshQuota = async (accountId: string) => {
    try {
      setBusyAction(`quota-${accountId}`);
      setErrorMsg(null);
      const res = await refreshQuota({ accountId });
      setStatus(res);
      toast.show(t("refresh"), { variant: "info" });
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to refresh quotas.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async (accountId: string) => {
    try {
      setBusyAction(`delete-${accountId}`);
      setErrorMsg(null);
      const res = await deleteAccount({ accountId });
      setStatus(res);
      toast.show(t("accountRemoved"), { variant: "info" });
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to remove account.");
    } finally {
      setBusyAction(null);
    }
  };

  /* ------------------------------------------------------------------------ */
  /* Styles & Formatting                                                      */
  /* ------------------------------------------------------------------------ */

  const styles = useMemo(
    () => ({
      container: {
        flex: 1,
        padding: layout.compact ? 14 : 20,
        backgroundColor: theme.colors.surface0,
      },
      header: {
        marginBottom: 16,
      },
      title: {
        fontSize: layout.compact ? 20 : 24,
        fontWeight: "bold" as const,
        color: theme.colors.foreground,
        marginBottom: 4,
      },
      subtitle: {
        fontSize: 13,
        color: theme.colors.foregroundMuted,
        lineHeight: 18,
      },
      actionBar: {
        flexDirection: "row" as const,
        gap: 10,
        marginBottom: 16,
        flexWrap: "wrap" as const,
      },
      primaryBtn: {
        backgroundColor: theme.colors.accent,
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      primaryBtnText: {
        color: theme.colors.accentForeground,
        fontWeight: "600" as const,
        fontSize: 14,
      },
      secondaryBtn: {
        backgroundColor: theme.colors.surface2,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 8,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      secondaryBtnText: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "500" as const,
      },
      /* Wizard Card */
      wizardCard: {
        backgroundColor: theme.colors.surface1,
        borderRadius: 12,
        padding: 18,
        marginBottom: 18,
        borderWidth: 1.5,
        borderColor: theme.colors.accent,
      },
      wizardTitle: {
        fontSize: 16,
        fontWeight: "bold" as const,
        color: theme.colors.foreground,
        marginBottom: 6,
      },
      stepList: {
        marginBottom: 14,
        gap: 8,
      },
      stepItem: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        gap: 8,
      },
      stepBadge: {
        backgroundColor: theme.colors.accent,
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        marginTop: 1,
      },
      stepBadgeText: {
        color: theme.colors.accentForeground,
        fontSize: 11,
        fontWeight: "bold" as const,
      },
      stepText: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.foreground,
        lineHeight: 18,
      },
      linkBox: {
        backgroundColor: theme.colors.surface2,
        borderRadius: 8,
        padding: 12,
        marginBottom: 8,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 10,
      },
      urlBox: {
        backgroundColor: theme.colors.surface0,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: 10,
        marginBottom: 14,
      },
      urlText: {
        fontSize: 11,
        fontFamily: "monospace" as const,
        color: theme.colors.foregroundMuted,
        lineHeight: 16,
      },
      urlTipText: {
        fontSize: 11,
        color: theme.colors.foregroundMuted,
        marginBottom: 6,
        fontStyle: "italic" as const,
      },
      inputContainer: {
        marginBottom: 14,
      },
      textInput: {
        backgroundColor: theme.colors.surface0,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: theme.colors.foreground,
        fontSize: 14,
        fontFamily: "monospace" as const,
      },
      wizardActions: {
        flexDirection: "row" as const,
        gap: 10,
        justifyContent: "flex-end" as const,
        marginTop: 6,
      },
      /* Account Cards */
      card: {
        backgroundColor: theme.colors.surface1,
        borderRadius: 12,
        padding: 16,
        marginBottom: 14,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      activeCard: {
        borderColor: theme.colors.accent,
        borderWidth: 1.5,
      },
      cardHeader: {
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
        alignItems: "center" as const,
        marginBottom: 12,
      },
      emailText: {
        fontSize: 15,
        fontWeight: "600" as const,
        color: theme.colors.foreground,
      },
      badgeActive: {
        backgroundColor: "#10b981",
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
      },
      badgeActiveText: {
        color: "#ffffff",
        fontSize: 11,
        fontWeight: "bold" as const,
      },
      quotaContainer: {
        backgroundColor: theme.colors.surface0,
        borderRadius: 8,
        padding: 12,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      quotaHeader: {
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
        alignItems: "center" as const,
        marginBottom: 8,
      },
      quotaTitle: {
        fontSize: 11,
        fontWeight: "600" as const,
        color: theme.colors.foregroundMuted,
        textTransform: "uppercase" as const,
        letterSpacing: 0.5,
      },
      quotaGrid: {
        gap: 8,
      },
      quotaItem: {
        marginBottom: 4,
      },
      quotaItemRow: {
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
        alignItems: "center" as const,
        marginBottom: 3,
      },
      quotaLabel: {
        fontSize: 12,
        color: theme.colors.foreground,
      },
      quotaValue: {
        fontSize: 12,
        fontWeight: "bold" as const,
      },
      barTrack: {
        height: 5,
        backgroundColor: theme.colors.surface2,
        borderRadius: 3,
        overflow: "hidden" as const,
      },
      barFill: {
        height: "100%" as const,
        borderRadius: 3,
      },
      quotaFooterText: {
        fontSize: 11,
        color: theme.colors.foregroundMuted,
        marginTop: 6,
        textAlign: "right" as const,
      },
      cardFooter: {
        flexDirection: "row" as const,
        gap: 8,
        alignItems: "center" as const,
      },
      actionBtn: {
        backgroundColor: theme.colors.surface2,
        paddingVertical: 7,
        paddingHorizontal: 12,
        borderRadius: 6,
      },
      actionBtnText: {
        color: theme.colors.foreground,
        fontSize: 12,
        fontWeight: "500" as const,
      },
      activateBtn: {
        backgroundColor: theme.colors.accent,
        paddingVertical: 7,
        paddingHorizontal: 12,
        borderRadius: 6,
      },
      activateBtnText: {
        color: theme.colors.accentForeground,
        fontWeight: "600" as const,
        fontSize: 12,
      },
      /* Guide Card */
      guideBox: {
        backgroundColor: theme.colors.surface1,
        borderRadius: 10,
        padding: 16,
        marginBottom: 16,
        borderLeftWidth: 4,
        borderLeftColor: theme.colors.accent,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      guideTitle: {
        fontSize: 14,
        fontWeight: "bold" as const,
        color: theme.colors.foreground,
        marginBottom: 8,
      },
      errorBox: {
        backgroundColor: "#ef444422",
        borderColor: "#ef4444",
        borderWidth: 1,
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
      },
      errorText: {
        color: "#ef4444",
        fontSize: 13,
      },
    }),
    [theme, layout.compact],
  );

  const getPercentColor = (percentStr: string) => {
    const val = parseInt(percentStr.replace("%", ""), 10);
    if (isNaN(val) || val >= 50) return "#10b981"; // Green
    if (val >= 20) return "#f59e0b"; // Orange
    return "#ef4444"; // Red
  };

  const getPercentValue = (percentStr: string) => {
    const val = parseInt(percentStr.replace("%", ""), 10);
    return isNaN(val) ? 0 : Math.min(100, Math.max(0, val));
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{t("screenTitle")}</Text>
        <Text style={styles.subtitle}>{t("subtitle")}</Text>
      </View>

      {/* Global Error Banner */}
      {errorMsg && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      )}

      {/* Top Action Bar (Cleaned up, no manual CLI import) */}
      <View style={styles.actionBar}>
        {wizardStep === "idle" && (
          <Pressable style={styles.primaryBtn} onPress={handleStartLogin}>
            <Text style={styles.primaryBtnText}>{t("addAccount")}</Text>
          </Pressable>
        )}

        <Pressable
          style={styles.secondaryBtn}
          onPress={() => setShowGuide((prev) => !prev)}
        >
          <Text style={styles.secondaryBtnText}>
            {showGuide ? t("hideGuide") : t("howItWorks")}
          </Text>
        </Pressable>
      </View>

      {/* Embedded In-App Guide */}
      {showGuide && (
        <View style={styles.guideBox}>
          <Text style={styles.guideTitle}>{t("howItWorks")}</Text>
          <Text style={[styles.subtitle, { marginBottom: 8 }]}>
            {t("guideDescription")}
          </Text>
          <Text style={[styles.subtitle, { marginBottom: 4 }]}>
            • {t("guideTipNoSsh")}
          </Text>
          <Text style={[styles.subtitle, { marginBottom: 4 }]}>
            • {t("guideTipIncognito")}
          </Text>
          <Text style={styles.subtitle}>
            • {t("guideTipInstant")}
          </Text>
        </View>
      )}

      {/* Interactive OAuth Multi-Step Wizard */}
      {wizardStep !== "idle" && (
        <View style={styles.wizardCard}>
          <Text style={styles.wizardTitle}>{t("wizardTitle")}</Text>

          {wizardStep === "generating" && (
            <View style={{ alignItems: "center", paddingVertical: 24, gap: 12 }}>
              <ActivityIndicator size="large" color={theme.colors.accent} />
              <Text style={styles.subtitle}>{t("generatingLink")}</Text>
            </View>
          )}

          {wizardStep === "awaiting_code" && (
            <View>
              {wizardError && (
                <View style={[styles.errorBox, { marginBottom: 12 }]}>
                  <Text style={styles.errorText}>{wizardError}</Text>
                </View>
              )}

              <View style={styles.stepList}>
                <View style={styles.stepItem}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepBadgeText}>1</Text>
                  </View>
                  <Text style={styles.stepText}>{t("step1")}</Text>
                </View>
              </View>

              {/* URL & Link Action Box */}
              {wizardAuthUrl && (
                <>
                  <View style={styles.linkBox}>
                    <ExternalLink href={wizardAuthUrl}>
                      <Text style={{ color: theme.colors.accent, fontWeight: "600", fontSize: 13 }}>
                        {t("openSignIn")}
                      </Text>
                    </ExternalLink>

                    <Pressable
                      style={[styles.secondaryBtn, { paddingVertical: 6, paddingHorizontal: 10 }]}
                      onPress={handleCopyLink}
                    >
                      <Text style={{ fontSize: 12, color: theme.colors.foreground }}>{t("copyLink")}</Text>
                    </Pressable>
                  </View>

                  {/* Selectable URL display for HTTP contexts & direct copy */}
                  <Text style={styles.urlTipText}>{t("urlSelectHint")}</Text>
                  <View style={styles.urlBox}>
                    <Text selectable={true} style={styles.urlText}>
                      {wizardAuthUrl}
                    </Text>
                  </View>
                </>
              )}

              <View style={styles.stepList}>
                <View style={styles.stepItem}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepBadgeText}>2</Text>
                  </View>
                  <Text style={styles.stepText}>{t("step2")}</Text>
                </View>

                <View style={styles.stepItem}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepBadgeText}>3</Text>
                  </View>
                  <Text style={styles.stepText}>{t("step3")}</Text>
                </View>
              </View>

              {/* Code Input */}
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.textInput}
                  placeholder={t("codePlaceholder")}
                  placeholderTextColor={theme.colors.foregroundMuted}
                  value={authCodeInput}
                  onChangeText={setAuthCodeInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {/* Wizard Actions */}
              <View style={styles.wizardActions}>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={handleCancelLogin}
                >
                  <Text style={styles.secondaryBtnText}>{t("cancel")}</Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.primaryBtn,
                    !authCodeInput.trim() && { opacity: 0.5 },
                  ]}
                  disabled={!authCodeInput.trim()}
                  onPress={handleSubmitCode}
                >
                  <Text style={styles.primaryBtnText}>{t("connectAccount")}</Text>
                </Pressable>
              </View>
            </View>
          )}

          {wizardStep === "submitting" && (
            <View style={{ alignItems: "center", paddingVertical: 24, gap: 12 }}>
              <ActivityIndicator size="large" color={theme.colors.accent} />
              <Text style={styles.subtitle}>{t("verifyingCode")}</Text>
            </View>
          )}
        </View>
      )}

      {/* Accounts List */}
      {status?.accounts.length === 0 ? (
        <View style={styles.card}>
          <Text style={[styles.subtitle, { textAlign: "center", paddingVertical: 12 }]}>
            {t("noAccounts")}
          </Text>
        </View>
      ) : (
        status?.accounts.map((acc: AntigravityAccount) => {
          const isActive = acc.id === status.activeAccountId;
          const isBusy =
            busyAction === `select-${acc.id}` ||
            busyAction === `quota-${acc.id}` ||
            busyAction === `delete-${acc.id}`;

          return (
            <View key={acc.id} style={[styles.card, isActive && styles.activeCard]}>
              {/* Account Header */}
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.emailText}>{acc.email}</Text>
                  {acc.name && <Text style={styles.subtitle}>{acc.name}</Text>}
                </View>
                {isActive && (
                  <View style={styles.badgeActive}>
                    <Text style={styles.badgeActiveText}>{t("active")}</Text>
                  </View>
                )}
              </View>

              {/* Quotas & Usage Visualization */}
              <View style={styles.quotaContainer}>
                <View style={styles.quotaHeader}>
                  <Text style={styles.quotaTitle}>{t("quotaTitle")}</Text>
                  {busyAction === `quota-${acc.id}` ? (
                    <ActivityIndicator size="small" color={theme.colors.accent} />
                  ) : (
                    <Pressable onPress={() => handleRefreshQuota(acc.id)}>
                      <Text style={{ fontSize: 11, color: theme.colors.accent, fontWeight: "600" }}>
                        {t("refresh")}
                      </Text>
                    </Pressable>
                  )}
                </View>

                {acc.quotas && acc.quotas.length > 0 ? (
                  <View style={styles.quotaGrid}>
                    {acc.quotas.map((q: QuotaEntry, idx: number) => {
                      const color = getPercentColor(q.percentage);
                      const percentVal = getPercentValue(q.percentage);
                      const isFiveHour =
                        q.limitType.toLowerCase().includes("five hour") ||
                        q.limitType.includes("5h");
                      const label = `${q.group} (${isFiveHour ? t("window5h") : t("weekly")})`;

                      return (
                        <View key={idx} style={styles.quotaItem}>
                          <View style={styles.quotaItemRow}>
                            <Text style={styles.quotaLabel}>{label}</Text>
                            <Text style={[styles.quotaValue, { color }]}>{q.percentage}</Text>
                          </View>
                          <View style={styles.barTrack}>
                            <View
                              style={[
                                styles.barFill,
                                { width: `${percentVal}%`, backgroundColor: color },
                              ]}
                            />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text
                    style={[
                      styles.subtitle,
                      { fontStyle: "italic", textAlign: "center", marginVertical: 4 },
                    ]}
                  >
                    {t("quotasNotLoaded")}
                  </Text>
                )}

                {acc.quotaUpdatedAt && (
                  <Text style={styles.quotaFooterText}>
                    {t("lastUpdated")}{new Date(acc.quotaUpdatedAt).toLocaleTimeString()}
                  </Text>
                )}
              </View>

              {/* Card Footer Actions */}
              <View style={styles.cardFooter}>
                {!isActive && (
                  <Pressable
                    style={styles.activateBtn}
                    onPress={() => handleSelect(acc.id)}
                    disabled={isBusy}
                  >
                    {busyAction === `select-${acc.id}` ? (
                      <ActivityIndicator size="small" color={theme.colors.accentForeground} />
                    ) : (
                      <Text style={styles.activateBtnText}>{t("switchAccount")}</Text>
                    )}
                  </Pressable>
                )}

                <Pressable
                  style={styles.actionBtn}
                  onPress={() => handleRefreshQuota(acc.id)}
                  disabled={isBusy}
                >
                  <Text style={styles.actionBtnText}>{t("refresh")}</Text>
                </Pressable>

                <Pressable
                  style={styles.actionBtn}
                  onPress={() => handleDelete(acc.id)}
                  disabled={isBusy}
                >
                  <Text style={styles.actionBtnText}>{t("remove")}</Text>
                </Pressable>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}
