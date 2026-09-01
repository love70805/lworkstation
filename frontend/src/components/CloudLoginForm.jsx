import { useState } from "react";
import { LogIn } from "lucide-react";
import { signInCloud } from "../data/cloudAuth";
import { Button } from "./UI";

export function CloudLoginForm({ signIn = signInCloud, onSuccess, onError }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setWorking(true);
    setErrorMessage("");
    try {
      const result = await signIn({ email, password });
      setPassword("");
      onSuccess?.(result);
    } catch (error) {
      const message = String(error?.message ?? "登录失败");
      setErrorMessage(message);
      onError?.(error);
    } finally {
      setWorking(false);
    }
  };

  return (
    <form className="cloud-auth-form" onSubmit={submit}>
      <label><span>邮箱</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required /></label>
      <label><span>密码</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" required /></label>
      {errorMessage ? <p className="cloud-auth-error" role="alert">云端登录失败：{errorMessage}</p> : null}
      <Button variant="primary" icon={LogIn} loading={working} type="submit">登录云端工作区</Button>
    </form>
  );
}
