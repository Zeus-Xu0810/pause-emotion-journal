/** 记录权限先检查身份，再校验内容；访客点击保存也能得到明确入口。 */
export type SaveAccess = 'checking' | 'signin' | 'verify' | 'allowed';
export interface SaveIdentity { ready: boolean; user: { uid: string; emailVerified: boolean } | null }
export function saveAccess(identity: SaveIdentity): SaveAccess {
  if (!identity.ready) return 'checking';
  if (!identity.user) return 'signin';
  return identity.user.emailVerified ? 'allowed' : 'verify';
}

/** 仓库层再次执行同一规则，不能通过其他页面绕开登录提示保存访客记录。 */
export function requireSaveOwner(identity: SaveIdentity): string {
  const access = saveAccess(identity);
  if (access === 'checking') throw new Error('正在确认登录状态，请稍后重试。');
  if (access === 'signin') throw new Error('请先注册或登录，当前内容尚未记录。');
  if (access === 'verify') throw new Error('请先验证邮箱，再保存记录。当前草稿仍保留在本页。');
  return identity.user!.uid;
}
