import { computeDerived } from './derivedComputations';
let buffered = null;
self.onmessage = async ({ data }) => {
  const { jobId, type } = data;
  try {
    if (type === 'initialize') { buffered = data; return; }
    if (type === 'append') {
      if (buffered?.jobId !== jobId || !Array.isArray(buffered.input[data.field])) throw new Error('后台计算来源不完整，请重新读取。');
      buffered.input[data.field].push(...data.rows); return;
    }
    const job = type === 'compute' ? buffered : data;
    if (!job || job.jobId !== jobId) throw new Error('后台计算来源不完整，请重新读取。');
    const { kind, input } = job;
    buffered = null;
    self.postMessage({ jobId, type: 'progress', progress: { label: kind === 'profit' ? '正在核算成本与利润' : kind === 'cost-reconciliation' ? '正在整理采购证据' : '正在计算数据' } });
    self.postMessage({ jobId, value: await computeDerived(kind, input) });
  } catch (error) { self.postMessage({ jobId, error: error.message }); }
};
