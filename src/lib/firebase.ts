import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword, getAuth, onAuthStateChanged, reload, sendEmailVerification, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signOut as firebaseSignOut, updateProfile, type User } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { SETTINGS } from '../config';

/** Firebase 的公开连接配置统一由部署环境提供；私钥不得放入 VITE 变量。 */
const cloudConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY?.trim(),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim(),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim(),
  appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim(),
};
export const cloudAvailable = Object.values(cloudConfig).every((value) => typeof value === 'string' && value.trim().length > 0);
const app = cloudAvailable ? (getApps()[0] ?? initializeApp(cloudConfig)) : null;
export const firebaseAuth = app ? getAuth(app) : null;
// Web默认仅内存缓存；getFirestore复用已有实例，HMR不重复配置，也不启用IndexedDB。
export const firestore = app ? getFirestore(app) : null;
if (firebaseAuth) firebaseAuth.languageCode = 'zh-CN';

/** 全站共享认证状态，避免每个页面独立初始化或保存敏感账号信息。 */
export interface AuthSession {
  user: User | null;
  ready: boolean;
  available: boolean;
  signIn: (email: string, password: string, remember: boolean) => Promise<void>;
  signUp: (email: string, password: string, name: string, remember: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  reloadVerification: () => Promise<void>;
  sendVerification: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateName: (name: string) => Promise<void>;
}
const AuthContext = createContext<AuthSession | null>(null);
const cloudUnavailable = '账号与云同步尚未连接。访客只能在当前页面保留草稿，暂时无法保存记录。';
const sessionChanged = () => Object.assign(new Error('账号状态已变化，请重新操作。'), { code: 'auth/session-changed' });

/** 将服务错误转为可操作的中文说明，不输出 SDK 内部信息或凭据。 */
export function friendlyCloudError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const messages: Record<string, string> = {
    'auth/invalid-email': '请填写有效的邮箱地址。',
    'auth/email-already-in-use': '这个邮箱已经注册，可以直接登录或重置密码。',
    'auth/invalid-credential': '邮箱或密码不正确，请检查后重试。',
    'auth/user-not-found': '邮箱或密码不正确，请检查后重试。',
    'auth/wrong-password': '邮箱或密码不正确，请检查后重试。',
    'auth/weak-password': `密码至少需要 ${SETTINGS.minPasswordLength} 位，请换一个更长的密码。`,
    'auth/too-many-requests': '操作有些频繁，请稍后再试。',
    'auth/network-request-failed': '暂时无法连接账号服务，请检查网络后重试。',
    'auth/operation-not-allowed': '邮箱登录暂不可用，请稍后再试。',
    'auth/unauthorized-continue-uri': '邮件返回地址尚未配置，请联系网站维护者。',
    'auth/user-disabled': '这个账号目前无法使用，请联系网站维护者。',
    'auth/session-changed': '账号状态已变化，请重新操作。',
    'permission-denied': '暂无访问权限，请确认已验证邮箱并重新登录。',
    'unavailable': '云端暂时无法连接，你的当前编辑仍保留在页面中。',
  };
  return messages[code] ?? (error instanceof Error && !code ? error.message : '操作暂未完成，请稍后重试。');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // 包装对象保证邮箱验证和昵称变更时，即使 User 引用不变也会刷新界面。
  const [state, setState] = useState<{ user: User | null; ready: boolean }>({ user: null, ready: !cloudAvailable });
  const identity = useRef({ active: true, intent: 0, version: 0, user: firebaseAuth?.currentUser ?? null, queue: Promise.resolve() });
  // 身份只以SDK当前用户为准；同一身份的observer刷新不推进代次。
  const currentUser = () => {
    const user = firebaseAuth?.currentUser ?? null;
    if (identity.current.user !== user) { identity.current.user = user; identity.current.version += 1; }
    return user;
  };
  useEffect(() => {
    if (!firebaseAuth) return;
    identity.current.active = true;
    // 排队的通知也读取此刻的SDK身份，不能让旧回调重新发布已退出的用户。
    const publish = () => setState(previous => identity.current.active ? { user: currentUser(), ready: true } : previous);
    const unsubscribe = onAuthStateChanged(firebaseAuth, publish, publish);
    return () => { identity.current.active = false; identity.current.intent += 1; unsubscribe(); };
  }, []);

  const session = useMemo<AuthSession>(() => {
    const requireAuth = () => {
      if (!firebaseAuth) throw new Error(cloudUnavailable);
      return firebaseAuth;
    };
    const requireUser = () => {
      requireAuth();
      const user = currentUser();
      if (!user) throw new Error('请先登录你的账号。');
      return user;
    };
    const ensureIntent = (intent: number) => {
      if (!identity.current.active || identity.current.intent !== intent) throw sessionChanged();
    };
    // 登录、创建、退出在SDK层按顺序执行；旧create请求不能在新signOut完成后自动登录。
    const changeIdentity = <T,>(operation: (intent: number) => Promise<T>) => {
      const intent = ++identity.current.intent;
      const promise = identity.current.queue.then(() => { ensureIntent(intent); return operation(intent); });
      identity.current.queue = promise.then(() => undefined, () => undefined);
      return { intent, promise };
    };
    const ownsUser = (user: User, intent = identity.current.intent) => {
      currentUser();
      const version = identity.current.version;
      return () => identity.current.active && identity.current.intent === intent && currentUser() === user && identity.current.version === version;
    };
    // 每个异步阶段开始与结束都检查归属；注销意图一出现即使后续步骤失效。
    const userStep = async <T,>(owns: () => boolean, operation: () => Promise<T>): Promise<T> => {
      if (!owns()) throw sessionChanged();
      try {
        const result = await operation();
        if (!owns()) throw sessionChanged();
        return result;
      } catch (error) { if (!owns()) throw sessionChanged(); throw error; }
    };
    const publishUser = (user: User, owns: () => boolean) => {
      if (!owns()) throw sessionChanged();
      setState(previous => owns() ? { user, ready: true } : previous);
    };
    const emailActions = { url: `${SETTINGS.publicUrl}/account`, handleCodeInApp: false };
    return {
      ...state,
      available: cloudAvailable,
      async signIn(email, password, remember) {
        const auth = requireAuth();
        await changeIdentity(async intent => {
          await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
          ensureIntent(intent);
          await signInWithEmailAndPassword(auth, email.trim(), password);
          ensureIntent(intent);
        }).promise;
      },
      async signUp(email, password, name, remember) {
        if (password.length < SETTINGS.minPasswordLength || password.length > SETTINGS.maxPasswordLength) throw new Error(`密码请使用 ${SETTINGS.minPasswordLength}—${SETTINGS.maxPasswordLength} 位。`);
        const displayName = name.trim();
        if (!displayName || displayName.length > SETTINGS.maxDisplayNameLength) throw new Error(`昵称请填写 1—${SETTINGS.maxDisplayNameLength} 个字。`);
        const auth = requireAuth();
        const request = changeIdentity(async intent => {
          await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
          ensureIntent(intent);
          const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
          ensureIntent(intent);
          return result.user.uid;
        });
        const uid = await request.promise;
        ensureIntent(request.intent);
        const user = requireUser();
        if (user.uid !== uid) throw sessionChanged();
        const owns = ownsUser(user, request.intent);
        await userStep(owns, () => updateProfile(user, { displayName }));
        publishUser(user, owns);
        try {
          await userStep(owns, () => sendEmailVerification(user, emailActions));
        } catch {
          if (!owns()) throw sessionChanged();
          throw new Error('账号已创建，但验证邮件暂未发出。请在账号页重新发送验证邮件。');
        }
      },
      async signOut() {
        const auth = requireAuth();
        await changeIdentity(async intent => { await firebaseSignOut(auth); ensureIntent(intent); }).promise;
        // 身份变动统一交给observer，退出的迟到响应不能清空新登录用户。
      },
      async reloadVerification() {
        const user = requireUser();
        const owns = ownsUser(user);
        await userStep(owns, () => reload(user));
        await userStep(owns, () => user.getIdToken(true));
        publishUser(user, owns);
        if (!user.emailVerified) throw new Error('还没有检测到验证结果，请先打开邮件中的验证链接。');
      },
      async sendVerification() { const user = requireUser(); await userStep(ownsUser(user), () => sendEmailVerification(user, emailActions)); },
      async resetPassword(email) {
        try { await sendPasswordResetEmail(requireAuth(), email.trim(), emailActions); }
        catch (error) {
          // 无此账号也返回同样结果，避免通过找回页面探测其他人的注册邮箱。
          if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'auth/user-not-found')) throw error;
        }
      },
      async updateName(name) {
        const displayName = name.trim();
        if (!displayName || displayName.length > SETTINGS.maxDisplayNameLength) throw new Error(`昵称请填写 1—${SETTINGS.maxDisplayNameLength} 个字。`);
        const user = requireUser();
        const owns = ownsUser(user);
        await userStep(owns, () => updateProfile(user, { displayName }));
        publishUser(user, owns);
      },
    };
  }, [state]);

  return createElement(AuthContext.Provider, { value: session }, children);
}

/** 页面必须位于 AuthProvider 下，防止出现相互独立的认证状态。 */
export function useAuthSession(): AuthSession {
  const session = useContext(AuthContext);
  if (!session) throw new Error('请在 AuthProvider 中使用账号功能。');
  return session;
}
