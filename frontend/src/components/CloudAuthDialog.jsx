import { useState } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { Modal, Button, useToast } from "./UI";
import { isCloudAuthConfigured, signOutCloud } from "../data/cloudAuth";
import { runtimeConfig } from "../config/runtimeConfig";
import { useCloudAuth } from "../hooks/useCloudAuth";
import { CloudLoginForm } from "./CloudLoginForm";

export default function CloudAuthDialog({ open, onClose }) {
  const { notify } = useToast();
  const auth = useCloudAuth();
  const [working, setWorking] = useState(false);

  const logout = async () => {
    setWorking(true);
    try {
      await signOutCloud();
      notify("已退出云端工作区。", "success");
    } catch (error) {
      notify(`退出登录失败：${error.message}`, "error");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal open={open} title="云端工作区" description="登录后才会上传审计事件；本机模式不会发起云端请求。" onClose={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
      {!isCloudAuthConfigured(runtimeConfig) ? (
        <div className="cloud-auth-empty"><ShieldCheck size={22} /><strong>尚未配置 Supabase Auth</strong><p>请先配置项目地址、匿名公钥和同步端点，再开启云端协作。</p></div>
      ) : auth.loading ? (
        <div className="cloud-auth-empty"><ShieldCheck size={22} /><strong>正在读取登录状态...</strong></div>
      ) : auth.user ? (
        <div className="cloud-auth-session"><div><strong>{auth.user.email ?? "已登录用户"}</strong><small>当前 Supabase 云端会话有效</small></div><Button icon={LogOut} loading={working} onClick={logout}>退出登录</Button></div>
      ) : (
        <CloudLoginForm
          onSuccess={() => notify("云端工作区登录成功。", "success")}
          onError={(error) => notify(`云端登录失败：${error.message}`, "error")}
        />
      )}
    </Modal>
  );
}

