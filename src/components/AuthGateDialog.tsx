import { useEffect, useRef } from 'react';
import { ArrowRight, LockKeyhole, X } from 'lucide-react';

interface AuthGateDialogProps {
  kind: 'signin' | 'verify';
  onClose: () => void;
  onContinue: (mode: 'signin' | 'signup') => void;
}

/** 原生模态对话框负责焦点约束与背景禁用，关闭后回到刚才的保存按钮。 */
export default function AuthGateDialog({ kind, onClose, onContinue }: AuthGateDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const current = dialog.current;
    current?.showModal();
    // React挂载时dialog尚未打开，需在showModal后将焦点交给主要操作。
    current?.querySelector<HTMLButtonElement>('.primary-button')?.focus();
    return () => { current?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="modal auth-gate-dialog" aria-labelledby="auth-gate-title" aria-describedby="auth-gate-copy" onCancel={event => { event.preventDefault(); onClose(); }}>
    <button className="icon-button auth-gate-close" type="button" aria-label="关闭登录提示" onClick={onClose}><X size={20} /></button>
    <span className="auth-gate-mark" aria-hidden="true"><LockKeyhole size={26} strokeWidth={1.5} /></span>
    <h2 id="auth-gate-title">{kind === 'verify' ? '先验证邮箱，再记下' : '登录后，记下这一刻'}</h2>
    <p className="auth-gate-copy" id="auth-gate-copy">{kind === 'verify' ? '完成邮箱验证后才能保存。当前内容尚未记录。' : '记录需要注册或登录后才能保存。当前内容尚未记录。'}</p>
    <div className="auth-gate-actions"><button className="primary-button" type="button" autoFocus onClick={() => onContinue('signin')}>{kind === 'verify' ? '去验证邮箱' : '登录并继续'}<ArrowRight size={18} /></button>{kind === 'signin' && <button className="secondary-button" type="button" onClick={() => onContinue('signup')}>注册账号</button>}</div>
    <button className="text-button auth-gate-later" type="button" onClick={onClose}>暂不记录</button>
  </dialog>;
}
