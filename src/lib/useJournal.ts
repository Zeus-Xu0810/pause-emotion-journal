import { useEffect, useRef, useState } from 'react';
import type { AuthSession } from './firebase';
import { friendlyCloudError } from './firebase';
import * as repository from './repository';
import { makeGuestEntry } from './domain';
import type { CareSession, EntryDraft, MoodEntry } from '../types';

/** 统一管理访客内存和个人云端；账号切换时先撤订阅、清空上一人的画面。 */
export function useJournal(session: AuthSession, onNotice: (message: string) => void) {
  const [guestEntries, setGuestEntries] = useState<MoodEntry[]>([]);
  const [guestSessions, setGuestSessions] = useState<CareSession[]>([]);
  const [cloudEntries, setCloudEntries] = useState<MoodEntry[]>([]);
  const [cloudSessions, setCloudSessions] = useState<CareSession[]>([]);
  const [loadedUid, setLoadedUid] = useState<string | null>(null);
  const [sync, setSync] = useState<'idle' | 'saving' | 'synced' | 'error'>('idle');
  const previousUid = useRef<string | null>(null);
  const uid = session.user?.uid ?? null;
  const cloud = Boolean(uid && session.user?.emailVerified);

  useEffect(() => {
    let active = true;
    const changedAccount = previousUid.current && previousUid.current !== uid;
    if (changedAccount) { setGuestEntries([]); setGuestSessions([]); }
    previousUid.current = uid;
    setCloudEntries([]);
    setCloudSessions([]);
    setLoadedUid(null);
    setSync('idle');
    if (!uid || !session.user?.emailVerified) return;
    const failed = (error: Error) => { if (active) { setSync('error'); onNotice(friendlyCloudError(error)); } };
    const stopEntries = repository.subscribeEntries(uid, entries => { if (active) { setCloudEntries(entries); setLoadedUid(uid); } }, failed, fromCache => { if (active) setSync(fromCache ? 'idle' : 'synced'); });
    const stopSessions = repository.subscribeCareSessions(uid, sessions => { if (active) { setCloudSessions(sessions); setLoadedUid(uid); } }, failed);
    return () => { active = false; stopEntries(); stopSessions(); };
  }, [uid, session.user?.emailVerified, onNotice]);

  /** 只有服务器确认后才返回成功；网络失败时编辑器由调用方保留。 */
  async function save(draft: EntryDraft, editing: MoodEntry | null) {
    if (session.user && !session.user.emailVerified) throw new Error('请先到「我的空间」验证邮箱，当前输入仍保留在页面中。');
    setSync('saving');
    try {
      if (cloud && uid) {
        const entry = editing ? await repository.updateEntry(uid, editing, draft) : await repository.createEntry(uid, draft);
        setSync('synced');
        return entry;
      }
      const entry = editing ? { ...editing, ...draft, revision: editing.revision + 1, updatedAt: new Date().toISOString() } : makeGuestEntry(draft);
      setGuestEntries(entries => [entry, ...entries.filter(item => item.id !== entry.id)].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)));
      setSync('idle');
      return entry;
    } catch (error) { setSync('error'); throw error; }
  }
  async function remove(entry: MoodEntry) {
    if (cloud && uid) { setSync('saving'); try { await repository.deleteEntry(uid, entry); setSync('synced'); } catch (error) { setSync('error'); throw error; } }
    else setGuestEntries(entries => entries.filter(item => item.id !== entry.id));
  }
  async function saveCare(careSession: CareSession) {
    if (session.user && !session.user.emailVerified) throw new Error('练习已结束。验证邮箱后才能保存到云端；你仍可继续体验。');
    if (cloud && uid) { setSync('saving'); try { await repository.saveCareSession(uid, careSession); setSync('synced'); } catch (error) { setSync('error'); throw error; } }
    else setGuestSessions(sessions => [careSession, ...sessions]);
  }

  /** 迁移必须由用户主动触发；逐条成功后移出待迁移列表，失败可安全重试。 */
  async function importGuest() {
    if (!cloud || !uid) throw new Error('请先登录并验证邮箱。');
    setSync('saving');
    try {
      for (const entry of guestEntries) {
        const { mood, feelings, contexts, note, occurredAt } = entry;
        await repository.createEntry(uid, { mood, feelings, contexts, note, occurredAt });
        setGuestEntries(current => current.filter(item => item.id !== entry.id));
      }
      for (const care of guestSessions) {
        await repository.saveCareSession(uid, { ...care, entryId: null });
        setGuestSessions(current => current.filter(item => item.id !== care.id));
      }
      setSync('synced');
    } catch (error) { setSync('error'); throw error; }
  }
  // 渲染时就按加载者 UID 隔离，不能等副作用清空后才隐藏前一账号数据。
  const switching = Boolean(previousUid.current && previousUid.current !== uid);
  return { entries: cloud ? loadedUid === uid ? cloudEntries : [] : switching ? [] : guestEntries, sessions: cloud ? loadedUid === uid ? cloudSessions : [] : switching ? [] : guestSessions, cloud, sync: cloud && loadedUid !== uid ? 'idle' : sync, save, remove, saveCare, importGuest, pendingGuest: cloud && !switching ? guestEntries.length + guestSessions.length : 0 };
}
