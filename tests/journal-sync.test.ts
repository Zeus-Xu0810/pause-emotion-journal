import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveJournalState, finishJournalRequest, startJournalRequest, type JournalReadState, type JournalRequests } from '../src/lib/journal-sync.ts';

/** 所有异步样本固定在一个身份代次，回归读取重连与并发保存的真实交错顺序。 */
const epoch = 4;
const read = (overrides: Partial<JournalReadState> = {}): JournalReadState => ({ epoch, entriesReady: true, sessionsReady: true, failed: false, entriesSynced: true, sessionsSynced: true, ...overrides });
const idle = (): JournalRequests => ({ epoch, count: 0, batchFailed: false });

test('首次两路都经服务器确认才结束加载，之后离线保留可查看状态', () => {
  assert.deepEqual(deriveJournalState(epoch, true, read({ entriesReady: false, sessionsReady: false, entriesSynced: false, sessionsSynced: false }), idle()), { sync: 'idle', loadFailed: false, loading: true });
  assert.equal(deriveJournalState(epoch, true, read({ sessionsReady: false, sessionsSynced: false }), idle()).loading, true);
  assert.equal(deriveJournalState(epoch, true, read(), idle()).sync, 'synced');
  // 已读标记是锁存状态；缓存模式只让连接提示回到等待，不让列表重新变为空白。
  assert.deepEqual(deriveJournalState(epoch, true, read({ entriesSynced: false, sessionsSynced: false }), idle()), { sync: 'idle', loadFailed: false, loading: false });
});

test('一批并发保存有失败时，仍等待其他保存，最后保留失败直到新一批重试', () => {
  let writes = startJournalRequest(idle(), epoch);
  writes = startJournalRequest(writes, epoch);
  writes = finishJournalRequest(writes, epoch, true);
  assert.equal(deriveJournalState(epoch, true, read(), writes).sync, 'saving');
  writes = finishJournalRequest(writes, epoch, false);
  assert.equal(deriveJournalState(epoch, true, read(), writes).sync, 'error');
  // 后续服务器元数据成功不能冒充刚才失败的保存已经成功。
  assert.equal(deriveJournalState(epoch, true, read({ entriesSynced: true }), writes).sync, 'error');
  writes = startJournalRequest(writes, epoch);
  assert.equal(deriveJournalState(epoch, true, read(), writes).sync, 'saving');
  writes = finishJournalRequest(writes, epoch, false);
  assert.equal(deriveJournalState(epoch, true, read(), writes).sync, 'synced');
});

test('读取重连不丢失旧保存的计数，旧完成不能提前宣告新保存已同步', () => {
  let writes = startJournalRequest(idle(), epoch);
  const retrying = read({ entriesReady: false, sessionsReady: false, entriesSynced: false, sessionsSynced: false });
  assert.equal(deriveJournalState(epoch, true, retrying, writes).sync, 'saving');
  writes = startJournalRequest(writes, epoch);
  writes = finishJournalRequest(writes, epoch, false);
  assert.equal(writes.count, 1);
  assert.equal(deriveJournalState(epoch, true, read(), writes).sync, 'saving');
  writes = finishJournalRequest(writes, epoch, false);
  assert.equal(deriveJournalState(epoch, true, read(), writes).sync, 'synced');
});

test('关怀读取终止后，日记元数据与成功保存均不能掩盖重连入口', () => {
  const failedRead = read({ failed: true });
  let writes = startJournalRequest(idle(), epoch);
  assert.equal(deriveJournalState(epoch, true, failedRead, writes).sync, 'saving');
  writes = finishJournalRequest(writes, epoch, false);
  assert.deepEqual(deriveJournalState(epoch, true, failedRead, writes), { sync: 'error', loadFailed: true, loading: false });
  assert.deepEqual(deriveJournalState(epoch, true, read({ entriesReady: false, sessionsReady: false, entriesSynced: false, sessionsSynced: false }), writes), { sync: 'idle', loadFailed: false, loading: true });
});

test('换身份立即进入新读取，旧失败和旧请求不得污染新身份', () => {
  const nextEpoch = epoch + 1;
  const oldRead = read({ failed: true });
  const oldWrites = startJournalRequest(idle(), epoch);
  assert.deepEqual(deriveJournalState(nextEpoch, true, oldRead, oldWrites), { sync: 'idle', loadFailed: false, loading: true });
  const newWrites = startJournalRequest(oldWrites, nextEpoch);
  assert.equal(finishJournalRequest(newWrites, epoch, true), newWrites);
  assert.equal(newWrites.count, 1);
  assert.equal(deriveJournalState(nextEpoch, true, oldRead, newWrites).sync, 'saving');
  assert.deepEqual(deriveJournalState(nextEpoch, false, oldRead, newWrites), { sync: 'idle', loadFailed: false, loading: false });
});
