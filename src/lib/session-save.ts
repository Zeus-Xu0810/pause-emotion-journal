/** 账号门槛已经有独立对话框，不再叠加同一错误的全局通知。 */
export function isAuthenticationRequired(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'auth-required';
}

/** 记录精度为整秒，不把不足一秒的试触伪造为一秒完成记录。 */
export function hasRecordableSessionTime(milliseconds: number): boolean {
  return Number.isFinite(milliseconds) && milliseconds >= 1000;
}
