import { useEffect, useRef, useState } from 'react';
import type { AuthSession } from './firebase';
import { friendlyCloudError } from './firebase';
import * as repository from './repository';
import { requireSaveOwner } from './save-policy';
import type { CareSession, EntryDraft, MoodEntry } from '../types';

type SyncState = 'idle' | 'saving' | 'synced' | 'error';
interface JournalData { epoch: number; entries: MoodEntry[]; sessions: CareSession[]; entriesReady: boolean; sessionsReady: boolean; failed: boolean }
const emptyData = (epoch: number): JournalData => ({ epoch, entries: [], sessions: [], entriesReady: false, sessionsReady: false, failed: false });

/** 仅管理本人云记录；未登录只允许编辑草稿和体验活动，不能创建“访客已保存”记录。 */
export function useJournal(session: AuthSession, onNotice: (message: string) => void) {
  const uid = session.user?.uid ?? null;
  const cloud = Boolean(uid && session.user?.emailVerified);
  const key = `${uid ?? 'guest'}:${session.user?.emailVerified ? 1 : 0}:${session.ready ? 1 : 0}`;
  const ownership = useRef({ key, epoch: 0 });
  // 渲染时就隔离旧身份，不能等待订阅清理后再隐藏前一人的数据。
  if (ownership.current.key !== key) ownership.current = { key, epoch: ownership.current.epoch + 1 };
  const epoch = ownership.current.epoch;
  const [reconnect, setReconnect] = useState(0);
  const [data, setData] = useState<JournalData>(() => emptyData(epoch));
  const [status, setStatus] = useState<{ epoch: number; value: SyncState }>({ epoch, value: 'idle' });
  const requests = useRef({ epoch, count: 0 });
  const current = () => ownership.current.epoch === epoch;
  const publish = (value: SyncState) => { if (current()) setStatus({ epoch, value }); };

  useEffect(() => {
    let active = true; let reported = false;
    let stopEntries = () => {}; let stopSessions = () => {};
    requests.current = { epoch, count: 0 };
    setData(emptyData(epoch)); setStatus({ epoch, value: 'idle' });
    if (!cloud || !uid) return;
    const valid = () => active && ownership.current.epoch === epoch;
    const failed = (error: Error) => { if (valid()) { setData(previous => previous.epoch === epoch ? { ...previous, failed: true } : previous); setStatus({ epoch, value: 'error' }); if (!reported) onNotice(friendlyCloudError(error)); reported = true; } };
    try {
      stopEntries = repository.subscribeEntries(uid, entries => {
        if (valid()) setData(previous => previous.epoch === epoch ? { ...previous, entries, entriesReady: true } : previous);
      }, failed, fromCache => {
        if (valid() && !(requests.current.epoch === epoch && requests.current.count > 0)) { setStatus({ epoch, value: fromCache ? 'idle' : 'synced' }); if (!fromCache) reported = false; }
      });
      stopSessions = repository.subscribeCareSessions(uid, sessions => {
        if (valid()) setData(previous => previous.epoch === epoch ? { ...previous, sessions, sessionsReady: true } : previous);
      }, failed);
    } catch (error) { failed(error instanceof Error ? error : new Error('暂时无法连接个人记录。')); }
    return () => { active = false; stopEntries(); stopSessions(); };
  }, [uid, cloud, epoch, reconnect, onNotice]);

  /** 每次写入带身份代次，旧账号的迟到响应不能覆盖新账号的同步提示。 */
  async function mutate<T>(operation: (owner: string) => Promise<T>): Promise<T> {
    if (!current()) throw new Error('账号已变化，请在当前账号中重新操作。');
    const owner = requireSaveOwner(session);
    if (requests.current.epoch !== epoch) requests.current = { epoch, count: 0 };
    requests.current.count += 1; publish('saving');
    try {
      const result = await operation(owner);
      if (current()) { requests.current.count = Math.max(0, requests.current.count - 1); publish(requests.current.count ? 'saving' : 'synced'); }
      return result;
    } catch (error) {
      if (current()) { requests.current.count = Math.max(0, requests.current.count - 1); publish('error'); }
      throw error;
    }
  }
  const save = (draft: EntryDraft, editing: MoodEntry | null) => mutate(owner => editing ? repository.updateEntry(owner, editing, draft) : repository.createEntry(owner, draft));
  const remove = (entry: MoodEntry) => mutate(owner => repository.deleteEntry(owner, entry));
  const saveCare = (care: CareSession) => mutate(owner => repository.saveCareSession(owner, care));
  const visible = cloud && data.epoch === epoch;
  return {
    entries: visible ? data.entries : [], sessions: visible ? data.sessions : [], cloud,
    // 读取失败与真实空列表分开呈现；重连只重建订阅，不刷新页面或清除草稿。
    loadFailed: cloud && visible && data.failed && (!data.entriesReady || !data.sessionsReady),
    loading: cloud && !data.failed && (!visible || !data.entriesReady || !data.sessionsReady),
    retry: () => setReconnect(value => value + 1),
    sync: status.epoch === epoch ? status.value : 'idle', save, remove, saveCare,
  };
}
