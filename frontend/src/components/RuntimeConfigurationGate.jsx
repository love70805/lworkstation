import { AlertCircle } from "lucide-react";
import { runtimeConfig } from "../config/runtimeConfig";

export function RuntimeConfigurationGate({ children, config = runtimeConfig }) {
  if (config.valid !== false) return children;
  return (
    <div className="route-loader" role="alert">
      <AlertCircle size={24} />
      <span>云端同步配置不完整，请补齐同步端点与 Supabase Auth 配置后重新启动。</span>
    </div>
  );
}
