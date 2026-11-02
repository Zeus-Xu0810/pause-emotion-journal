import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_FORM_SETTINGS, authErrorField, authModeFromParam, safeAccountReturnTo, validateAuthForm, type AuthFormValues } from '../src/lib/auth-form.ts';

/** 使用有效基线逐项验证输入边界，不调用真实账号或邮件服务。 */
const values = (patch: Partial<AuthFormValues> = {}): AuthFormValues => ({ email: 'person@example.com', password: 'a secure password', confirmPassword: 'a secure password', name: '小圆', ...patch });

test('登录、注册和找回密码只验证各自所需字段', () => {
  assert.deepEqual(validateAuthForm('signin', values({ name: '', confirmPassword: '' })), {});
  assert.deepEqual(validateAuthForm('reset', values({ name: '', password: '', confirmPassword: '' })), {});
  assert.ok(validateAuthForm('signup', values({ name: '  ', confirmPassword: '' })).name);
  assert.ok(validateAuthForm('signup', values({ name: '  ', confirmPassword: '' })).confirmPassword);
});

test('邮箱接受首尾空白和子域名，拒绝空值、内嵌空白与超长地址', () => {
  assert.deepEqual(validateAuthForm('reset', values({ email: ' person+pause@notes.example.com  ' })), {});
  for (const email of ['', 'person', 'a@@example.com', 'a b@example.com', 'a@example. com', `${'a'.repeat(AUTH_FORM_SETTINGS.maxEmailLength)}@example.com`]) {
    assert.ok(validateAuthForm('reset', values({ email })).email, email);
  }
});

test('密码长度边界与确认密码严格比较，不静默删除空白', () => {
  const minimum = 'a'.repeat(AUTH_FORM_SETTINGS.minPasswordLength);
  assert.deepEqual(validateAuthForm('signup', values({ password: minimum, confirmPassword: minimum })), {});
  assert.ok(validateAuthForm('signin', values({ password: minimum.slice(1) })).password);
  const maximum = 'a'.repeat(AUTH_FORM_SETTINGS.maxPasswordLength);
  assert.deepEqual(validateAuthForm('signin', values({ password: maximum })), {});
  assert.ok(validateAuthForm('signin', values({ password: `${maximum}a` })).password);
  assert.ok(validateAuthForm('signup', values({ password: ' password ', confirmPassword: 'password' })).confirmPassword);
  assert.deepEqual(validateAuthForm('signup', values({ password: ' password ', confirmPassword: ' password ' })), {});
});

test('昵称与认证服务一致，空白和超限在本地就拒绝', () => {
  assert.ok(validateAuthForm('signup', values({ name: '  ' })).name);
  assert.deepEqual(validateAuthForm('signup', values({ name: '圆'.repeat(AUTH_FORM_SETTINGS.maxDisplayNameLength) })), {});
  assert.ok(validateAuthForm('signup', values({ name: '圆'.repeat(AUTH_FORM_SETTINGS.maxDisplayNameLength + 1) })).name);
});

test('返回地址只接受精确站内白名单，拒绝外链与编码绕过', () => {
  for (const path of ['/', '/journal', '/insights', '/care']) assert.equal(safeAccountReturnTo(path), path);
  for (const path of ['https://example.com', '//example.com', '/%2fexample.com', '/care?next=https://example.com', '/journal/../account', '\\example.com', 'javascript:alert(1)', null, undefined]) assert.equal(safeAccountReturnTo(path), '/');
  assert.equal(authModeFromParam('signup'), 'signup');
  assert.equal(authModeFromParam('reset'), 'signin');
});

test('只把可定位的服务错误关联字段，凭据错误不探测账号', () => {
  assert.equal(authErrorField({ code: 'auth/email-already-in-use' }), 'email');
  assert.equal(authErrorField({ code: 'auth/weak-password' }), 'password');
  assert.equal(authErrorField({ code: 'auth/invalid-credential' }), null);
  assert.equal(authErrorField(new Error('网络错误')), null);
});
