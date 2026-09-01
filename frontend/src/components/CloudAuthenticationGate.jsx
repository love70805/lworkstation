import { createContext, useContext } from "react";
import { ShieldCheck } from "lucide-react";
import { runtimeConfig } from "../config/runtimeConfig";
import { useCloudAuth } from "../hooks/useCloudAuth";
import { CloudLoginForm } from "./CloudLoginForm";

const CloudAuthenticationContext = createContext(null);

export function hasAuthenticatedCloudIdentity(config, user) {
  return config?.runtimeMode === "cloud-ready" && Boolean(String(user?.id ?? "").trim());
}

export function CloudAuthenticationGateView({ children, config, auth, signIn }) {
  if (config?.runtimeMode !== "cloud-ready") return children;
  if (auth?.loading) {
    return <div className="route-loader" role="status"><ShieldCheck size={24} /><span>正在读取云端登录状态...</span></div>;
  }
  if (hasAuthenticatedCloudIdentity(config, auth?.user)) return children;
  return (
    <main className="route-loader">
      <section className="cloud-auth-gate" aria-labelledby="cloud-auth-gate-title">
        <ShieldCheck size={28} aria-hidden="true" />
        <div>
          <h1 id="cloud-auth-gate-title">登录云端工作区</h1>
          <p>云端模式必须使用已验证成员身份。登录前不会载入业务页面、采集监听或同步任务。</p>
        </div>
        {auth?.error ? <p className="cloud-auth-error" role="alert">读取登录状态失败：{auth.error.message}</p> : null}
        <CloudLoginForm signIn={signIn} />
      </section>
    </main>
  );
}

export function CloudAuthenticationGate({ children, config = runtimeConfig }) {
  const auth = useCloudAuth(config);
  return (
    <CloudAuthenticationGateView config={config} auth={auth}>
      <CloudAuthenticationContext.Provider value={auth}>{children}</CloudAuthenticationContext.Provider>
    </CloudAuthenticationGateView>
  );
}

export function useCloudAuthenticationState() {
  const auth = useContext(CloudAuthenticationContext);
  if (!auth) throw new Error("云端认证状态只能在 CloudAuthenticationGate 内读取。");
  return auth;
}
