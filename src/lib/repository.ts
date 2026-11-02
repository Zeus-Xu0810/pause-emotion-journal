import { collection, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, Timestamp, type DocumentData } from 'firebase/firestore';
import { CONTEXTS, FEELINGS, SETTINGS } from '../config';
import type { CareSession, EntryDraft, MoodEntry, MoodScore } from '../types';
import { firebaseAuth, firestore } from './firebase';

/** 数据入口只接受当前已验证账号的 UID；安全规则会再次独立校验。 */
function privateDatabase(uid: string) {
  if (!firestore || !firebaseAuth) throw new Error('云同步尚未连接，当前是访客体验。');
  if (firebaseAuth.currentUser?.uid !== uid || !firebaseAuth.currentUser.emailVerified) throw new Error('请先登录并验证邮箱，再同步你的日记。');
  return firestore;
}
function onlineDatabase(uid: string) {
  const db = privateDatabase(uid);
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('目前处于离线状态。编辑仍保留在本页，联网后请再次保存。');
  return db;
}

/** 文本和标签在客户端先给出友好校验；云端规则执行同等限制。 */
function validateDraft(draft: EntryDraft) {
  if (!Number.isInteger(draft.mood) || draft.mood < 1 || draft.mood > 5) throw new Error('请选择此刻的情绪。');
  if (draft.note.length > SETTINGS.maxNoteLength) throw new Error(`日记最多写 ${SETTINGS.maxNoteLength} 字。`);
  if (!Number.isFinite(Date.parse(draft.occurredAt))) throw new Error('请选择有效的记录时间。');
  if (draft.feelings.length > FEELINGS.length || draft.feelings.some((item) => !FEELINGS.includes(item))) throw new Error('请从现有感受中选择。');
  if (draft.contexts.length > CONTEXTS.length || draft.contexts.some((item) => !CONTEXTS.includes(item))) throw new Error('请从现有情境中选择。');
}
function toIso(value: unknown): string {
  return value instanceof Timestamp ? value.toDate().toISOString() : new Date(0).toISOString();
}
function readEntry(id: string, data: DocumentData): MoodEntry {
  return { id, mood: data.mood as MoodScore, feelings: data.feelings, contexts: data.contexts, note: data.note, occurredAt: toIso(data.occurredAt), createdAt: toIso(data.createdAt), updatedAt: toIso(data.updatedAt), revision: data.revision };
}
function writeDraft(draft: EntryDraft) {
  return { mood: draft.mood, feelings: [...new Set(draft.feelings)], contexts: [...new Set(draft.contexts)], note: draft.note, occurredAt: Timestamp.fromDate(new Date(draft.occurredAt)) };
}

/** 个人时间线使用单字段索引；未获服务器确认的本地写入不冒充已同步。 */
export function subscribeEntries(uid: string, onData: (entries: MoodEntry[]) => void, onError: (error: Error) => void, onServerState?: (fromCache: boolean) => void): () => void {
  const db = privateDatabase(uid);
  return onSnapshot(query(collection(db, 'users', uid, 'entries'), orderBy('occurredAt', 'desc')), { includeMetadataChanges: true }, (snapshot) => {
    if (!snapshot.metadata.hasPendingWrites) onData(snapshot.docs.map((item) => readEntry(item.id, item.data())));
    // 缓存首快照和待确认写入均不能显示为“云端已同步”。
    onServerState?.(snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites);
  }, onError);
}
export function subscribeCareSessions(uid: string, onData: (sessions: CareSession[]) => void, onError: (error: Error) => void): () => void {
  const db = privateDatabase(uid);
  return onSnapshot(query(collection(db, 'users', uid, 'careSessions'), orderBy('createdAt', 'desc')), { includeMetadataChanges: true }, (snapshot) => {
    if (!snapshot.metadata.hasPendingWrites) onData(snapshot.docs.map((item) => ({ ...item.data(), id: item.id, createdAt: toIso(item.data().createdAt) } as CareSession)));
  }, onError);
}

/** 新建等待真实事务确认；返回值的显示时间随后由实时订阅替换成服务端时间。 */
export async function createEntry(uid: string, draft: EntryDraft): Promise<MoodEntry> {
  validateDraft(draft);
  const db = onlineDatabase(uid);
  const reference = doc(collection(db, 'users', uid, 'entries'));
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(reference);
    if (current.exists()) throw new Error('记录编号发生冲突，请重试。');
    transaction.set(reference, { ...writeDraft(draft), createdAt: serverTimestamp(), updatedAt: serverTimestamp(), revision: 1 });
  });
  // 避免写入成功后再次读取失败，让用户误以为未保存而重复创建。
  const displayedAt = new Date().toISOString();
  return { ...draft, id: reference.id, createdAt: displayedAt, updatedAt: displayedAt, revision: 1 };
}

/** 比较编辑开始时的版本；多设备变化时保留调用方草稿并明确报冲突。 */
export async function updateEntry(uid: string, entry: MoodEntry, draft: EntryDraft): Promise<MoodEntry> {
  validateDraft(draft);
  const db = onlineDatabase(uid);
  const reference = doc(db, 'users', uid, 'entries', entry.id);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(reference);
    if (!current.exists()) throw new Error('这条日记已在另一处删除。你可以把当前草稿另存一条。');
    if (current.data().revision !== entry.revision) throw new Error('这条日记已在另一台设备更新。当前草稿已保留，请载入最新版本，或另存一条。');
    transaction.update(reference, { ...writeDraft(draft), updatedAt: serverTimestamp(), revision: entry.revision + 1 });
  });
  return { ...entry, ...draft, updatedAt: new Date().toISOString(), revision: entry.revision + 1 };
}
export async function deleteEntry(uid: string, entry: MoodEntry): Promise<void> {
  const db = onlineDatabase(uid);
  const reference = doc(db, 'users', uid, 'entries', entry.id);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(reference);
    if (!current.exists()) return;
    if (current.data().revision !== entry.revision) throw new Error('这条日记已有新版本，请查看最新内容后再删除。');
    transaction.delete(reference);
  });
}

/** 练习只保存完成反馈，不写入音频、诊断结论或第三方模型内容。 */
export async function saveCareSession(uid: string, session: CareSession): Promise<void> {
  const db = onlineDatabase(uid);
  const reference = doc(db, 'users', uid, 'careSessions', session.id);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(reference);
    if (current.exists()) return;
    // 练习期间原日记可能被其他设备删除；脱开关联仍能保存真实练习反馈。
    let entryId = session.entryId;
    if (entryId) {
      const relatedEntry = await transaction.get(doc(db, 'users', uid, 'entries', entryId));
      if (!relatedEntry.exists()) entryId = null;
    }
    transaction.set(reference, {
      type: session.type, title: session.title, durationSeconds: session.durationSeconds,
      beforeMood: session.beforeMood, feedback: session.feedback, entryId, createdAt: serverTimestamp(),
    });
  });
}
