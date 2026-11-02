import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasRecordableSessionTime, isAuthenticationRequired } from '../src/lib/session-save.ts';

/** 只有账号门槛已有对话框；网络与权限错误仍需正常提示，不能一概吞掉。 */
test('仅识别账号对话框的明确错误代码', () => {
  assert.equal(isAuthenticationRequired(Object.assign(new Error('需要账号'), { code: 'auth-required' })), true);
  for (const error of [new Error('网络失败'), { code: 'permission-denied' }, { code: 'unavailable' }, null, 'auth-required']) assert.equal(isAuthenticationRequired(error), false);
});

/** 精度不足的试触不生成虚构时长，满一秒的真实活动可以保留。 */
test('活动时长在一秒边界正确区分，并拒绝非有限值', () => {
  for (const value of [-1, 0, 500, 999.999, NaN, Infinity]) assert.equal(hasRecordableSessionTime(value), false);
  for (const value of [1000, 1000.001, 60000]) assert.equal(hasRecordableSessionTime(value), true);
});
