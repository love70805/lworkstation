import { useRef, useState } from 'react';
import { Button, Modal, useToast } from './UI';
import { readProductArchive } from '../lib/productArchiveImport';
import { previewProductArchive, saveProductArchive } from '../data/repositories/productArchiveRepository';
import CollectionProgressBar from './CollectionProgressBar';

export default function ProductArchiveImport() {
  const input = useRef(null), { notify } = useToast();
  const [candidate, setCandidate] = useState(null), [busy, setBusy] = useState(false), [stage, setStage] = useState(''), [error, setError] = useState('');
  async function read(file) {
    if (!file) return;
    setBusy(true); setError(''); setStage('正在读取商品档案…');
    try {
      const archive = await readProductArchive(file);
      setStage('正在匹配已有商品对应关系…');
      const preview = await previewProductArchive(archive);
      setCandidate({ archive, preview });
    } catch (failure) { setError(failure.message); } finally { setBusy(false); setStage(''); }
  }
  async function save() {
    setBusy(true); setError(''); setStage('正在保存商品资料…');
    try {
      await saveProductArchive(candidate.archive, candidate.preview.workspaceId);
      setCandidate(null); notify('商品档案已导入，可在商品资料中补齐档案。正式成本和历史利润保持原值。');
    } catch (failure) { setError(failure.message); } finally { setBusy(false); setStage(''); }
  }
  return <>
    <input ref={input} type="file" accept=".xlsx,.xls" className="visually-hidden" aria-label="选择 ERP 商品档案" onChange={event => { void read(event.target.files[0]); event.target.value = ''; }} />
    <Button disabled={busy} loading={busy} onClick={() => input.current?.click()}>导入 ERP 商品档案</Button>
    {stage ? <div role="status">{stage}<CollectionProgressBar label="商品档案导入进度" active /></div> : null}
    {error ? <p role="alert">{error}</p> : null}
    <Modal open={Boolean(candidate)} title="导入商品档案" description="只补齐名称、图片、属性和 1688 链接。文件中的采购单价不参与本月利润核算。" onClose={() => !busy && setCandidate(null)}
      footer={<><Button disabled={busy} onClick={() => setCandidate(null)}>取消</Button><Button variant="primary" loading={busy} disabled={busy} onClick={save}>导入资料</Button></>}>
      <p>{candidate?.archive.fileName}</p><p>读取 {candidate?.archive.rows.length} 条商品档案，匹配 {candidate?.preview.matchedWarehouseCount} 个仓库商品 / {candidate?.preview.rows.length} 个平台 SKU。</p>
      {candidate?.preview.unmatched.length ? <details><summary>{candidate.preview.unmatched.length} 个商品暂无可用对应关系</summary><p>资料会保留，取得对应关系后可继续补齐。不会使用截断的 SKU 文本猜测匹配。</p>{candidate.preview.unmatched.slice(0, 30).map(id => <p key={id}>{id}</p>)}</details> : null}
      <p>已人工维护的商品字段优先，导入只补空缺。</p>
    </Modal>
  </>;
}
