import { SETTINGS } from '../config.ts';

/** 表单可调输入和返回路径集中管理；密码约束与现有认证服务保持一致。 */
export const AUTH_FORM_SETTINGS = {
  minPasswordLength: SETTINGS.minPasswordLength,
  maxPasswordLength: SETTINGS.maxPasswordLength,
  maxDisplayNameLength: SETTINGS.maxDisplayNameLength,
  maxEmailLength: SETTINGS.maxEmailLength,
  verificationCooldownSeconds: 60,
  resetCooldownSeconds: 60,
  countdownTickMs: 1000,
  returnPaths: ['/', '/journal', '/insights', '/care'] as readonly string[],
};

export type AuthFormMode = 'signin' | 'signup' | 'reset';
export type AuthField = 'email' | 'password' | 'confirmPassword' | 'name';
export interface AuthFormValues { email: string; password: string; confirmPassword: string; name: string }
export type AuthFieldErrors = Partial<Record<AuthField, string>>;

/** 邮箱只去除首尾空白；密码保留用户原样输入，确认密码不得静默trim。 */
export function validateAuthForm(mode: AuthFormMode, values: AuthFormValues): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const email = values.email.trim();
  if (!email) errors.email = '请填写邮箱。';
  else if (email.length > AUTH_FORM_SETTINGS.maxEmailLength || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = '请填写有效的邮箱地址。';
  if (mode !== 'reset') {
    if (!values.password) errors.password = '请填写密码。';
    else if (values.password.length < AUTH_FORM_SETTINGS.minPasswordLength) errors.password = `密码至少需要 ${AUTH_FORM_SETTINGS.minPasswordLength} 位。`;
    else if (values.password.length > AUTH_FORM_SETTINGS.maxPasswordLength) errors.password = `密码不能超过 ${AUTH_FORM_SETTINGS.maxPasswordLength} 位。`;
  }
  if (mode === 'signup') {
    const name = values.name.trim();
    if (!name) errors.name = '请填写昵称。';
    else if (name.length > AUTH_FORM_SETTINGS.maxDisplayNameLength) errors.name = `昵称不能超过 ${AUTH_FORM_SETTINGS.maxDisplayNameLength} 个字。`;
    if (!values.confirmPassword) errors.confirmPassword = '请再次输入密码。';
    else if (values.confirmPassword !== values.password) errors.confirmPassword = '两次输入的密码不一致。';
  }
  return errors;
}

/** 站内精确白名单拒绝协议、双斜线和编码变体，不将任意returnTo交给路由。 */
export function safeAccountReturnTo(value: unknown): string {
  return typeof value === 'string' && AUTH_FORM_SETTINGS.returnPaths.includes(value) ? value : '/';
}
export function authModeFromParam(value: string | null): 'signin' | 'signup' { return value === 'signup' ? 'signup' : 'signin'; }

/** 可定位的服务端错误回到对应字段；凭据错误保留通用表述，避免泄露账号状态。 */
export function authErrorField(error: unknown): AuthField | null {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (code === 'auth/invalid-email' || code === 'auth/email-already-in-use') return 'email';
  return code === 'auth/weak-password' ? 'password' : null;
}
