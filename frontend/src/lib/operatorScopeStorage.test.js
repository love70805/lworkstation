// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import { operatorStorageKey, readOperatorConfig, saveOperatorConfig } from './operatorScopeStorage';
import { activeOperatorScope } from '../domain/operatorScope';
beforeEach(() => localStorage.clear());
it('persists named schemes and mode after a fresh read and isolates workspaces', () => {
  const profiles = [{ id: 'A', name: '小林', pairs: [{ store: '甲', supplierNumber: '001' }] }, { id: 'B', name: '小王', pairs: [] }];
  saveOperatorConfig('W', { version: 1, mode: 'mine', activeProfileId: 'A', profiles });
  expect(activeOperatorScope(readOperatorConfig('W')).pairs).toEqual(profiles[0].pairs);
  saveOperatorConfig('W', { ...readOperatorConfig('W'), activeProfileId: 'B' });
  expect(activeOperatorScope(readOperatorConfig('W'))).toEqual({ mode: 'mine', pairs: [] });
  expect(readOperatorConfig('Other').profiles).toEqual([]);
  saveOperatorConfig('W', { ...readOperatorConfig('W'), mode: 'all' });
  expect(readOperatorConfig('W').mode).toBe('all');
});
it('fails closed on corrupt storage and propagates failed saves', () => {
  localStorage.setItem(operatorStorageKey('W'), '{broken');
  expect(readOperatorConfig('W').mode).toBe('mine');
  expect(() => saveOperatorConfig('W', {}, { setItem() { throw new Error('quota'); } })).toThrow('quota');
});
