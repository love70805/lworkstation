import { useEffect, useMemo, useState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { runtimeConfig } from "../config/runtimeConfig";
import {
  DEFAULT_MEMBER_ID,
  DEFAULT_WORKSPACE_ID,
  setActiveMemberContext,
} from "../data/database";
import { useCloudAuthenticationState } from "./CloudAuthenticationGate";

const SUPPORTED_MEMBER_ROLES = new Set(["admin", "selection", "operations", "finance", "viewer"]);

function memberContextTarget(config, auth) {
  if (config?.runtimeMode === "local") {
    return { memberId: DEFAULT_MEMBER_ID, role: "admin", workspaceId: DEFAULT_WORKSPACE_ID };
  }
  const memberId = String(auth?.user?.id ?? "").trim();
  if (config?.runtimeMode !== "cloud-ready" || !memberId) return null;
  const metadata = {
    ...(auth.user?.app_metadata ?? {}),
    ...(auth.user?.user_metadata ?? {}),
  };
  const requestedRole = String(metadata.role ?? metadata.workspace_role ?? "").trim().toLowerCase();
  return {
    memberId,
    role: SUPPORTED_MEMBER_ROLES.has(requestedRole) ? requestedRole : "selection",
    workspaceId: DEFAULT_WORKSPACE_ID,
  };
}

export function MemberContextGateController({
  children,
  config,
  auth,
  setContext = setActiveMemberContext,
}) {
  const target = useMemo(
    () => memberContextTarget(config, auth),
    [config?.runtimeMode, auth?.user],
  );
  const targetKey = target ? `${target.workspaceId}:${target.memberId}:${target.role}` : "";
  const [readyKey, setReadyKey] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;
    setReadyKey("");
    setErrorMessage("");
    if (!target) return () => { active = false; };
    Promise.resolve(setContext(target))
      .then(() => { if (active) setReadyKey(targetKey); })
      .catch((error) => { if (active) setErrorMessage(String(error?.message ?? "未知错误")); });
    return () => { active = false; };
  }, [setContext, targetKey]);

  if (errorMessage) {
    return <div className="route-loader" role="alert"><AlertCircle size={24} /><span>成员上下文初始化失败：{errorMessage}</span></div>;
  }
  if (!target || readyKey !== targetKey) {
    return <div className="route-loader" role="status"><LoaderCircle className="spin" size={24} /><span>正在初始化成员上下文...</span></div>;
  }
  return children;
}

export function MemberContextGate({ children, config = runtimeConfig }) {
  const auth = useCloudAuthenticationState();
  return <MemberContextGateController config={config} auth={auth}>{children}</MemberContextGateController>;
}
