import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createWorkspaceRecovery } = createRequire(import.meta.url)('./workspace-recovery.cjs');
function fixture() {
  let foreground = true, destroyed = false, crashed = false, invalidations = 0;
  const sent = [], failures = [], recovered = [], timers = new Map(); let id = 0;
  const contents = { isDestroyed: () => destroyed, isCrashed: () => crashed,
    invalidate: () => invalidations++, send: (...args) => sent.push(args) };
  let current = contents;
  const recovery = createWorkspaceRecovery({ getContents: () => current, isForeground: () => foreground,
    onFailure: value => failures.push(value), onRecovered: () => recovered.push(true),
    schedule: (callback, ms) => { assert.equal(ms, 8000); timers.set(++id, callback); return id; }, cancel: key => timers.delete(key) });
  return { recovery, contents, sent, failures, recovered,
    foreground: value => foreground = value, destroyed: () => destroyed = true, crashed: () => crashed = true,
    replace: () => current = { ...contents }, invalidations: () => invalidations,
    tick: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); },
    reply: ready => recovery.acknowledge(contents, { token: sent.at(-1)?.[1], ready }) };
}
{
  const f = fixture(); f.recovery.check(); f.recovery.check();
  assert.equal(f.sent.length, 1, 'focus/show/restore coalesce');
  assert.equal(f.recovery.acknowledge(f.contents, null), false);
  assert.equal(f.recovery.acknowledge({}, {token: f.sent[0][1], ready: true}), false);
  assert.equal(f.recovery.acknowledge(f.contents, {token: 'stale', ready: true}), false);
  assert.equal(f.reply(true), true); f.tick();
  assert.equal(f.failures.length, 0); assert.equal(f.invalidations(), 2);
  assert.equal(f.recovered.length, 0, 'healthy form is not remounted');
}
{
  const f = fixture(); f.recovery.check(); f.tick();
  assert.match(f.failures[0], /暂未响应/); assert.match(f.failures[0], /尚未保存/);
  assert.equal(f.reply(true), true); assert.equal(f.recovered.length, 1, 'late response restores same page');
}
{
  const f = fixture(); f.recovery.check(); f.reply(false);
  assert.match(f.failures[0], /显示异常/); f.tick(); assert.equal(f.failures.length, 1);
}
for (const reason of ['foreground', 'pause', 'replace', 'dispose']) {
  const f = fixture(); f.recovery.check();
  if (reason === 'foreground') f.foreground(false);
  else if (reason === 'replace') f.replace();
  else f.recovery[reason]();
  f.tick(); assert.equal(f.reply(true), false); assert.equal(f.failures.length, 0, reason);
}
for (const reason of ['destroyed', 'crashed']) {
  const f = fixture(); f[reason](); f.recovery.check();
  assert.match(f.failures[0], /进程已退出/); assert.equal(f.sent.length, 0);
}
{
  const f = fixture(); f.recovery.check(); f.tick();
  f.recovery.pause(); f.foreground(false); f.tick(); f.foreground(true);
  assert.equal(f.recovery.needsRecovery(), true);
  f.recovery.check(); f.reply(true);
  assert.equal(f.recovered.length, 1, 'reenter after timeout/minimize recovers without reload');
  assert.equal(f.recovery.needsRecovery(), false);
  f.recovery.check(); f.tick(); f.recovery.reset();
  assert.equal(f.recovery.needsRecovery(), false, 'explicit navigation resets recovery state');
}
{
  const f = fixture(); f.foreground(false); f.recovery.check(); assert.equal(f.sent.length, 0);
  f.foreground(true); f.contents.send = () => { throw Error('closed'); }; f.recovery.check();
  assert.match(f.failures[0], /恢复失败/); f.tick(); assert.equal(f.failures.length, 1);
}
console.log('workspace recovery: foreground repaint, authenticated probes, timeout/late reply, blank/crash and cancellation passed');
