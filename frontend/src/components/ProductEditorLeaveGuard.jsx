import { useEffect, useRef } from "react";
import { useBlocker } from "react-router-dom";
import { Button, Modal } from "./UI";

export default function ProductEditorLeaveGuard({ dirty, saving, onSave, allowNavigationRef }) {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    dirtyRef.current && !allowNavigationRef.current
    && `${currentLocation.pathname}${currentLocation.search}` !== `${nextLocation.pathname}${nextLocation.search}`
  ));
  useEffect(() => {
    const protectRefresh = (event) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectRefresh);
    return () => window.removeEventListener("beforeunload", protectRefresh);
  }, []);
  const stay = () => { if (!saving) blocker.reset?.(); };
  const saveAndLeave = async () => {
    if (await onSave()) blocker.proceed?.();
  };
  return <Modal open={blocker.state === "blocked"} title="商品有未保存修改" description="保存后离开，或放弃本次修改。继续编辑会保留当前输入。" onClose={stay}
    footer={<><Button disabled={saving} onClick={stay}>继续编辑</Button><Button disabled={saving} onClick={() => blocker.proceed?.()}>放弃修改</Button><Button variant="primary" loading={saving} disabled={saving} onClick={saveAndLeave}>保存后离开</Button></>} />;
}
