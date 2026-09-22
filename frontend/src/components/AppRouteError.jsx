import { useRouteError } from "react-router-dom";
import { Button, Panel } from "./UI";

export default function AppRouteError() {
  const error = useRouteError();
  return <main className="route-loader"><Panel role="alert">
    <h1>页面暂时无法读取</h1>
    <p>请重新加载页面，或返回经营概览后重试。</p>
    <div className="page-actions"><Button variant="primary" onClick={() => window.location.reload()}>重新加载页面</Button><a className="button button-secondary" href="/workspace">返回经营概览</a></div>
    <details><summary>错误详情</summary><p>{error?.message || "页面运行时发生错误。"}</p></details>
  </Panel></main>;
}
