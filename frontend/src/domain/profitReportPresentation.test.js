import { expect, it } from 'vitest';
import { dispatchRegistrantNames, profitReportFileName } from './profitReportPresentation';

it('names formal downloads with frozen dispatch registrants and ledger month without revision or projection suffixes', () => {
  const report = { period:'2026-09',kind:'financial',revision:3,createdAt:'2026-10-17',registrantNames:['张三'] };
  expect(profitReportFileName(report,{dispatchRows:[{ownerMarker:'其他人'}]})).toBe('张三2026年9月利润表.xlsx');
  expect(profitReportFileName({...report,kind:'pre_deduction'})).toBe('张三2026年9月利润表（未扣款）.xlsx');
});
it('derives legacy names only from frozen rows and does not invent an owner for manual dispatch', () => {
  const rows=[{ownerMarker:' 李四 '},{ownerMarker:'张三'},{ownerMarker:'李四'},{manual:true,ownerMarker:'人工成员'},{}];
  expect(dispatchRegistrantNames(rows)).toEqual(['李四','张三']);
  expect(profitReportFileName({period:'2027-01',kind:'financial'},{dispatchRows:rows})).toBe('李四、张三2027年1月利润表.xlsx');
  expect(profitReportFileName({period:'2026-09',kind:'financial'},{dispatchRows:[{manual:true}]})).toBe('2026年9月利润表.xlsx');
});
it('keeps filenames safe on Windows without changing the business name in the snapshot', () => {
  const report={period:'2026-12',kind:'financial',registrantNames:['甲/乙:*?"<>|\\\u0000']};
  expect(profitReportFileName(report)).toBe('甲-乙---------2026年12月利润表.xlsx');
  expect(report.registrantNames).toEqual(['甲/乙:*?"<>|\\\u0000']);
});
