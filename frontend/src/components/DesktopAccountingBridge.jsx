import { useEffect } from 'react';
import { getActiveMemberContext } from '../data/repositories/selectionRepository';
import { toggleAccountingMode } from '../data/repositories/inventoryAccountingRepository';

export default function DesktopAccountingBridge() {
  useEffect(() => {
    return window.shopeersDesktopRuntime?.onAccountingToggle?.(() => {
      void getActiveMemberContext().then(member => toggleAccountingMode(member.workspaceId)).catch(() => {});
    });
  }, []);
  return null;
}
