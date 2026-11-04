import { computeDerived } from './derivedComputations';
self.onmessage = ({ data: { kind, input, jobId } }) => {
  try {
    self.postMessage({ jobId, type: 'progress', progress: { label: kind === 'profit' ? '正在核算成本与利润' : kind === 'cost-reconciliation' ? '正在整理采购证据' : '正在计算数据' } });
    self.postMessage({ jobId, value: computeDerived(kind, input) });
  } catch (error) { self.postMessage({ jobId, error: error.message }); }
};
