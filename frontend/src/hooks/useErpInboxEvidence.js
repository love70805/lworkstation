import { useLiveQuery } from 'dexie-react-hooks';
import { getErpCostInbox } from '../data/database';

// Subscribe only while one receipt is opened. Match the originating projection
// as well as its ID so a switch or equal-ID update cannot show stale evidence.
export function useErpInboxEvidence(summary) {
  const loaded = useLiveQuery(async () => {
    if (!summary?.displayOnly) return null;
    try {
      const inbox = await getErpCostInbox(summary.id);
      if (!inbox || inbox.workspaceId !== summary.workspaceId || inbox.ledgerId !== summary.ledgerId) throw new Error('原始回传已不存在或不属于当前账本。');
      return { summary, inbox };
    } catch (error) { return { summary, error: error.message || '采购证据读取失败。' }; }
  }, [summary], null);
  if (!summary?.displayOnly) return { inbox: summary, loading: false, error: null };
  if (loaded?.summary !== summary) return { inbox: null, loading: true, error: null };
  return { inbox: loaded.inbox, loading: false, error: loaded.error };
}
