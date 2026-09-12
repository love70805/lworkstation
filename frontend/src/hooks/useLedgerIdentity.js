import { useEffect, useRef } from "react";

// Async cost actions must stop after unmount or scope changes. Restore the
// committed identity after cleanup, including StrictMode's effect replay.
export function useLedgerIdentity(ledgerId) {
  const identity = useRef(ledgerId);
  identity.current = ledgerId;
  useEffect(() => {
    identity.current = ledgerId;
    return () => { identity.current = null; };
  }, [ledgerId]);
  return identity;
}
