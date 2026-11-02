import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireSaveOwner, saveAccess } from '../src/lib/save-policy.ts';

/** 覆盖访客、恢复会话、未验证和可保存四种状态，防止按钮文案与数据权限分离。 */
test('保存权限以真实登录与邮箱验证为准，不把访客体验当记录', () => {
  assert.equal(saveAccess({ ready: false, user: null }), 'checking');
  assert.equal(saveAccess({ ready: true, user: null }), 'signin');
  assert.equal(saveAccess({ ready: true, user: { uid: 'a', emailVerified: false } }), 'verify');
  assert.equal(saveAccess({ ready: true, user: { uid: 'a', emailVerified: true } }), 'allowed');
  assert.throws(() => requireSaveOwner({ ready: true, user: null }), /注册或登录/);
  assert.throws(() => requireSaveOwner({ ready: true, user: { uid: 'a', emailVerified: false } }), /验证邮箱/);
  assert.equal(requireSaveOwner({ ready: true, user: { uid: 'a', emailVerified: true } }), 'a');
});
