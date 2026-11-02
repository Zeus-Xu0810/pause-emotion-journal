import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

/** 测试只访问本地模拟器，绝不使用真实项目或用户日记。 */
const TEST_SETTINGS = { projectId: 'demo-pause-emotion-journal', emulatorHost: '127.0.0.1', emulatorPort: 8080 };
let environment;
let alice;
let bob;
let visitor;
let unverified;
const entryPath = 'users/alice/entries/entry-1';
const carePath = 'users/alice/careSessions/session-1';

/** 所有有效样本从同一结构产生，攻击用例仅改变待验证字段。 */
function validEntry(overrides = {}) {
  return { mood: 3, feelings: ['平静'], contexts: ['独处'], note: '今天慢慢走了一小段路。', occurredAt: Timestamp.fromDate(new Date()), createdAt: serverTimestamp(), updatedAt: serverTimestamp(), revision: 1, ...overrides };
}
function validCare(overrides = {}) {
  return { type: 'breathing', title: '舒缓呼吸', durationSeconds: 60, beforeMood: 3, feedback: 'same', entryId: null, createdAt: serverTimestamp(), ...overrides };
}

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: TEST_SETTINGS.projectId,
    firestore: { host: TEST_SETTINGS.emulatorHost, port: TEST_SETTINGS.emulatorPort, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  alice = environment.authenticatedContext('alice', { email_verified: true }).firestore();
  bob = environment.authenticatedContext('bob', { email_verified: true }).firestore();
  unverified = environment.authenticatedContext('alice', { email_verified: false }).firestore();
  visitor = environment.unauthenticatedContext().firestore();
});
beforeEach(async () => { await environment.clearFirestore(); });
after(async () => { await environment?.cleanup(); });

/** 先验证正常创建、读取、查询、修改与单条删除，避免规则把产品功能全部关闭。 */
test('已验证账号可以管理自己的完整日记', async () => {
  const reference = doc(alice, entryPath);
  await assertSucceeds(setDoc(reference, validEntry()));
  await assertSucceeds(getDoc(reference));
  await assertSucceeds(getDocs(query(collection(alice, 'users/alice/entries'), orderBy('occurredAt', 'desc'))));
  await assertSucceeds(updateDoc(reference, { note: '补充一个片刻。', revision: 2, updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(reference));
});
test('游客与未验证邮箱无法读写日记', async () => {
  await setDoc(doc(alice, entryPath), validEntry());
  for (const database of [visitor, unverified]) {
    await assertFails(getDoc(doc(database, entryPath)));
    await assertFails(getDocs(collection(database, 'users/alice/entries')));
    await assertFails(setDoc(doc(database, 'users/alice/entries/new-entry'), validEntry()));
  }
});
test('另一账号不能读取、创建、修改或删除本人的记录', async () => {
  await setDoc(doc(alice, entryPath), validEntry());
  await assertFails(getDoc(doc(bob, entryPath)));
  await assertFails(getDocs(collection(bob, 'users/alice/entries')));
  await assertFails(setDoc(doc(bob, 'users/alice/entries/other-entry'), validEntry()));
  await assertFails(updateDoc(doc(bob, entryPath), { note: '越权', revision: 2, updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(bob, entryPath)));
});

/** 同一组污染样本分别攻击 create 与 update，捕获仅在创建时校验的绕过漏洞。 */
const invalidChanges = [
  ['正文超长', { note: '字'.repeat(2001) }],
  ['正文错误类型', { note: 12 }],
  ['非法心情', { mood: 7 }],
  ['小数心情', { mood: 2.5 }],
  ['数组混入对象', { feelings: [{ name: '焦虑' }] }],
  ['数组混入数字', { contexts: [123] }],
  ['不在词表中的感受', { feelings: ['admin'] }],
  ['重复标签', { contexts: ['工作', '工作'] }],
  ['过大标签数组', { feelings: Array(20).fill('焦虑') }],
  ['额外所有者字段', { ownerId: 'bob' }],
  ['权限字段污染', { role: 'admin' }],
  ['日期错误类型', { occurredAt: '2026-02-31' }],
  ['伪造将来日期', { occurredAt: Timestamp.fromDate(new Date('2099-01-01')) }],
  ['额外任意字段', { arbitraryData: 'unexpected' }],
];
for (const [description, changes] of invalidChanges) {
  test(`创建和更新都拒绝：${description}`, async () => {
    await assertFails(setDoc(doc(alice, 'users/alice/entries/invalid'), validEntry(changes)));
    await setDoc(doc(alice, entryPath), validEntry());
    await assertFails(updateDoc(doc(alice, entryPath), { ...changes, revision: 2, updatedAt: serverTimestamp() }));
  });
}
test('不能移除必要字段、修改创建时间、回退版本或伪造更新时间', async () => {
  const reference = doc(alice, entryPath);
  await setDoc(reference, validEntry());
  const withoutNote = validEntry({ revision: 2 });
  delete withoutNote.note;
  await assertFails(setDoc(reference, withoutNote));
  await assertFails(updateDoc(reference, { createdAt: Timestamp.fromDate(new Date('2020-01-01')), revision: 2, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(reference, { note: '旧版本覆盖', revision: 1, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(reference, { note: '跳版本', revision: 3, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(reference, { revision: 2, updatedAt: Timestamp.fromDate(new Date('2020-01-01')) }));
});
test('每一个必要字段在创建和更新后都必须存在', async () => {
  await setDoc(doc(alice, entryPath), validEntry());
  for (const field of Object.keys(validEntry())) {
    const data = validEntry();
    delete data[field];
    await assertFails(setDoc(doc(alice, 'users/alice/entries/missing-field'), data));
    await assertFails(updateDoc(doc(alice, entryPath), { revision: 2, updatedAt: serverTimestamp(), [field]: deleteField() }));
  }
});

/** 练习为不可覆盖的完成事件，日记关联只能指向当前用户自己的记录。 */
test('练习记录正常保存读取，不能覆盖历史或越权查看', async () => {
  await assertSucceeds(setDoc(doc(alice, carePath), validCare()));
  await assertSucceeds(getDocs(query(collection(alice, 'users/alice/careSessions'), orderBy('createdAt', 'desc'))));
  await assertFails(updateDoc(doc(alice, carePath), { feedback: 'better' }));
  await assertFails(getDoc(doc(bob, carePath)));
  await assertFails(getDoc(doc(visitor, carePath)));
  await assertSucceeds(deleteDoc(doc(alice, carePath)));
});
test('拒绝练习负值、长标题、错类型、额外权限字段和跨用户引用', async () => {
  for (const changes of [{ durationSeconds: -1 }, { durationSeconds: 999999 }, { title: '字'.repeat(81) }, { type: 'diagnosis' }, { feedback: 'cured' }, { beforeMood: '5' }, { role: 'admin' }, { entryId: '../bob/entry' }, { entryId: 'missing-entry' }]) {
    await assertFails(setDoc(doc(alice, carePath), validCare(changes)));
  }
  await setDoc(doc(alice, entryPath), validEntry());
  await assertSucceeds(setDoc(doc(alice, carePath), validCare({ entryId: 'entry-1' })));
});
test('父级用户文档、任意新集合和未知深层路径均默认拒绝', async () => {
  for (const path of ['users/alice', 'users/bob', 'publicProfiles/alice', 'users/alice/entries/entry-1/private/raw']) {
    await assertFails(setDoc(doc(alice, path), { email: 'private@example.test', role: 'admin' }));
    await assertFails(getDoc(doc(alice, path)));
  }
});
