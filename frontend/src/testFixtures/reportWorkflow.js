import { db } from "../data/db/clientDatabase";
import { previewMonthlySupplement,adoptMonthlySupplement } from "../data/repositories/profitReportRepository";

// Tests explicitly adopt true zero dispatch when dispatch is not their subject.
// Production never supplies this default on the user's behalf.
export async function adoptZeroDispatch(ledgerId){
  if(await db.monthlySupplementBatches.where('[ledgerId+kind+status]').equals([ledgerId,'dispatch','adopted']).count())return;
  const ledger=await db.ledgers.get(ledgerId);
  const input={ledgerId,workspaceId:ledger.workspaceId,period:ledger.period,kind:'dispatch',mode:'manual',adoptedQuantityExact:'0',rows:[]};
  await adoptMonthlySupplement(input,await previewMonthlySupplement(input));
}
