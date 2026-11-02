/** 读取状态和写入批次分开管理；重连读取不能重置仍在进行的写入。 */
export type JournalSyncState = 'idle' | 'saving' | 'synced' | 'error';
export interface JournalReadState {
  epoch: number;
  entriesReady: boolean;
  sessionsReady: boolean;
  failed: boolean;
  entriesSynced: boolean;
  sessionsSynced: boolean;
}
export interface JournalRequests { epoch: number; count: number; batchFailed: boolean }

/** 同一批并发写入共享失败标记；新一批主动重试才清除上次写入失败。 */
export function startJournalRequest(previous: JournalRequests, epoch: number): JournalRequests {
  const continuing = previous.epoch === epoch && previous.count > 0;
  return { epoch, count: continuing ? previous.count + 1 : 1, batchFailed: continuing && previous.batchFailed };
}
export function finishJournalRequest(previous: JournalRequests, epoch: number, failed: boolean): JournalRequests {
  if (previous.epoch !== epoch || previous.count === 0) return previous;
  return { ...previous, count: previous.count - 1, batchFailed: previous.batchFailed || failed };
}

/** 单一推导入口保证保存中优先，其次保留任一路读取失败或当前写入批次失败。 */
export function deriveJournalState(epoch: number, cloud: boolean, read: JournalReadState, writes: JournalRequests) {
  const currentRead = read.epoch === epoch;
  const currentWrites = writes.epoch === epoch;
  const failed = currentRead && read.failed;
  const ready = currentRead && read.entriesReady && read.sessionsReady;
  let sync: JournalSyncState = 'idle';
  if (cloud) {
    if (currentWrites && writes.count > 0) sync = 'saving';
    else if (failed || (currentWrites && writes.batchFailed)) sync = 'error';
    else if (ready && read.entriesSynced && read.sessionsSynced) sync = 'synced';
  }
  return { sync, loadFailed: cloud && failed, loading: cloud && !failed && !ready };
}
