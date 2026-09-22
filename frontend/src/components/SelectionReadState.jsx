import { useCallback, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertCircle } from "lucide-react";
import { Button, EmptyState, Panel } from "./UI";

// Catch inside the observable so a failed read remains a local, retryable state.
// Incrementing the attempt starts a fresh subscription without remounting filters.
export function useSelectionRead(read) {
  const [attempt, setAttempt] = useState(0);
  const result = useLiveQuery(async () => {
    try { return { attempt, status: "ready", data: await read(), error: "" }; }
    catch (error) { return { attempt, status: "error", data: undefined, error: error?.message || "本机数据读取失败。" }; }
  }, [read, attempt], undefined);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  if (!result || result.attempt !== attempt) return { status: "loading", data: undefined, error: "", retry };
  return { ...result, retry };
}

export default function SelectionReadState({ read, label }) {
  if (read.status === "ready") return null;
  if (read.status === "loading") return <Panel><p role="status">正在读取{label}…</p></Panel>;
  return <Panel role="alert"><EmptyState icon={AlertCircle} title={`${label}读取失败`} description={`${read.error} 当前筛选已保留，请重试读取。`} action={<Button onClick={read.retry}>重试读取</Button>} /></Panel>;
}
