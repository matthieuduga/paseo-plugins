import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  listAccountsRpc,
  startLoginFlowRpc,
  submitAuthCodeRpc,
  cancelLoginFlowRpc,
  saveCurrentAccountRpc,
  selectAccountRpc,
  deleteAccountRpc,
  refreshQuotaRpc,
} from "./shared/types";
import {
  listAccounts,
  startLoginFlow,
  submitAuthCode,
  cancelLoginFlow,
  saveCurrentAccount,
  selectAccount,
  deleteAccount,
  refreshQuota,
} from "./server/vault";

export default function contribute(server: PluginServerContext) {
  server.handle(listAccountsRpc, listAccounts);
  server.handle(startLoginFlowRpc, startLoginFlow);
  server.handle(submitAuthCodeRpc, submitAuthCode);
  server.handle(cancelLoginFlowRpc, cancelLoginFlow);
  server.handle(saveCurrentAccountRpc, saveCurrentAccount);
  server.handle(selectAccountRpc, selectAccount);
  server.handle(deleteAccountRpc, deleteAccount);
  server.handle(refreshQuotaRpc, refreshQuota);

  return () => {};
}
