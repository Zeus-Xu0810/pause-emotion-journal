import { useEffect, useRef, useState } from 'react';
import type { AuthSession } from './firebase';
import { friendlyCloudError } from './firebase';
import * as repository from './repository';
import { requireSaveOwner } from './save-policy';
import { deriveJournalState, finishJournalRequest, startJournalRequest, type JournalReadState, type JournalRequests } from './journal-sync';
import type { CareSession, EntryDraft, MoodEntry } from '../types';

interface JournalData extends JournalReadState { entries: MoodEntry[]; sessions: CareSession[] }
const emptyData = (epoch: number): JournalData => ({ epoch, entries: [], sessions: [], entriesReady: false, sessionsReady: false, failed: false, entriesSynced: false, sessionsSynced: false });

/** 仅管理本人云记录；未登录只允许编辑草稿和体验活动，不能创建“访客已保存”记录。 */
export function useJournal(session: AuthSession, onNotice: (message: string) => void) {
  const uid = session.user?.uid ?? null;
  const cloud = Boolean(session.ready && uid && session.user?.emailVerified);
  const key = `${uid ?? 'guest'}:${session.user?.emailVerified ? 1 : 0}:${session.ready ? 1 : 0}`;
  const ownership = useRef({ key, user: session.user, epoch: 0 });
  // 渲染时就隔离旧身份，不能等待订阅清理后再隐藏前一人的数据。
  if (ownership.current.key !== key || ownership.current.user !== session.user) ownership.current = { key, user: session.user, epoch: ownership.current.epoch + 1 };
  const epoch = ownership.current.epoch;
  const [reconnect, setReconnect] = useState(0);
  const [data, setData] = useState<JournalData>(() => emptyData(epoch));
  const requests = useRef<JournalRequests>({ epoch, count: 0, batchFailed: false });
  const [writes, setWrites] = useState(requests.current);
  // 只有身份变化才能废弃写入桶，同身份读取重连保留所有待确认请求。
  if (requests.current.epoch !== epoch) requests.current = { epoch, count: 0, batchFailed: false };
  const current = () => ownership.current.epoch === epoch;

  useEffect(() => {
    let active = true; let reported = false;
    let stopEntries = () => {}; let stopSessions = () => {};
    setData(emptyData(epoch));
    if (!cloud || !uid) return;
    const valid = () => active && ownership.current.epoch === epoch;
    const update = (change: (previous: JournalData) => JournalData) => {
      if (valid()) setData(previous => valid() && previous.epoch === epoch ? change(previous) : previous);
    };
    // 终止读取错误保留到主动重连；另一条订阅的成功或写入成功不能覆盖它。
    const failed = (error: Error) => { if (valid()) { update(previous => ({ ...previous, failed: true })); if (!reported) onNotice(friendlyCloudError(error)); reported = true; } };
    try {
      stopEntries = repository.subscribeEntries(uid, entries => {
        update(previous => ({ ...previous, entries }));
      }, failed, fromCache => {
        // 首次须服务器确认，之后离线只改变连接状态，不收回已可查看的数据。
        update(previous => ({ ...previous, entriesReady: previous.entriesReady || !fromCache, entriesSynced: !fromCache }));
      });
      stopSessions = repository.subscribeCareSessions(uid, sessions => {
        update(previous => ({ ...previous, sessions }));
      }, failed, fromCache => {
        update(previous => ({ ...previous, sessionsReady: previous.sessionsReady || !fromCache, sessionsSynced: !fromCache }));
      });
    } catch (error) {
      failed(error instanceof Error ? error : new Error('暂时无法连接个人记录。'));
      // 第二条订阅初始化失败时，也立即释放已创建的第一条订阅。
      stopEntries(); stopSessions(); stopEntries = () => {}; stopSessions = () => {};
    }
    return () => { active = false; stopEntries(); stopSessions(); };
  }, [uid, cloud, epoch, reconnect, onNotice]);

  /** 每次写入带身份代次，旧账号的迟到响应不能覆盖新账号的同步提示。 */
  async function mutate<T>(operation: (owner: string) => Promise<T>): Promise<T> {
    if (!current()) throw new Error('账号已变化，请在当前账号中重新操作。');
    const owner = requireSaveOwner(session);
    requests.current = startJournalRequest(requests.current, epoch); setWrites(requests.current);
    let failed = true;
    try {
      const result = await operation(owner);
      failed = false;
      return result;
    } finally {
      if (current()) { requests.current = finishJournalRequest(requests.current, epoch, failed); setWrites(requests.current); }
    }
  }
  const save = (draft: EntryDraft, editing: MoodEntry | null) => mutate(owner => editing ? repository.updateEntry(owner, editing, draft) : repository.createEntry(owner, draft));
  const remove = (entry: MoodEntry) => mutate(owner => repository.deleteEntry(owner, entry));
  const saveCare = (care: CareSession) => mutate(owner => repository.saveCareSession(owner, care));
  const visible = cloud && data.epoch === epoch;
  const status = deriveJournalState(epoch, cloud, data, writes);
  return {
    entries: visible ? data.entries : [], sessions: visible ? data.sessions : [], cloud,
    // 已加载后的终止错误同样需要重连入口；重连不刷新页面或清除编辑草稿。
    loadFailed: status.loadFailed, loading: status.loading,
    retry: () => setReconnect(value => value + 1),
    sync: status.sync, save, remove, saveCare,
  };
}
