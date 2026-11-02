import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';
import { STAR_PATTERNS, STAR_SETTINGS } from '../../play-content';
import { distance, pointInBoard } from '../../lib/play';

/** 点击或划过下一颗星即可连线；没有限时、扣分或点错惩罚。 */
export default function ConstellationGame({ active, onInteract }: { active: boolean; onInteract: () => void }) {
  const [patternIndex, setPatternIndex] = useState(0);
  const [connected, setConnected] = useState(0);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const progressRef = useRef(0);
  const heldPointer = useRef<number | null>(null);
  const pattern = STAR_PATTERNS[patternIndex];
  const complete = connected === pattern.points.length;
  const segments = pattern.points.slice(0, connected).map(point => point.join(',')).join(' ');
  const reset = () => { progressRef.current = 0; setConnected(0); setPointer(null); heldPointer.current = null; };
  // 隐藏或暂停时结束拖动，回来后不会把普通悬停误当作之前那次划线。
  useEffect(() => { if (!active) { heldPointer.current = null; setPointer(null); } }, [active]);
  function connect(index: number) {
    if (!active || index !== progressRef.current || index >= pattern.points.length) return;
    onInteract(); progressRef.current += 1; setConnected(progressRef.current);
    if (progressRef.current === pattern.points.length) setPointer(null);
  }
  function follow(clientX: number, clientY: number, element: HTMLDivElement) {
    const point = pointInBoard(clientX, clientY, element.getBoundingClientRect(), STAR_SETTINGS.width, STAR_SETTINGS.height);
    setPointer(point);
    const next = pattern.points[progressRef.current];
    if (next && distance(point, { x: next[0], y: next[1] }) <= STAR_SETTINGS.hitRadius) connect(progressRef.current);
  }

  return <div className="constellation-game">
    <div className="star-patterns" role="group" aria-label="星光图案">{STAR_PATTERNS.map((item, index) => <button type="button" key={item.id} aria-pressed={patternIndex === index} className={patternIndex === index ? 'is-selected' : ''} disabled={!active} onClick={() => { reset(); setPatternIndex(index); }}>{item.title}</button>)}</div>
    <div className={`star-board ${complete ? 'is-complete' : ''}`} aria-label={`${pattern.title}的星光连线`} onPointerDown={event => { if (!active || event.button !== 0) return; event.preventDefault(); heldPointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); follow(event.clientX, event.clientY, event.currentTarget); }} onPointerMove={event => { if (active && heldPointer.current === event.pointerId) follow(event.clientX, event.clientY, event.currentTarget); }} onPointerUp={() => { heldPointer.current = null; setPointer(null); }} onPointerCancel={() => { heldPointer.current = null; setPointer(null); }} onLostPointerCapture={() => { heldPointer.current = null; setPointer(null); }}>
      <svg className="star-lines" viewBox={`0 0 ${STAR_SETTINGS.width} ${STAR_SETTINGS.height}`} aria-hidden="true">
        <defs><radialGradient id={`star-glow-${pattern.id}`}><stop stopColor="#e9d6af" stopOpacity=".18" /><stop offset="1" stopColor="#e9d6af" stopOpacity="0" /></radialGradient></defs>
        <ellipse cx="50" cy="36" rx="48" ry="34" fill={`url(#star-glow-${pattern.id})`} />
        {connected > 1 && <polyline points={complete && pattern.closed ? `${segments} ${pattern.points[0].join(',')}` : segments} fill="none" stroke="#ecd9b1" strokeWidth=".45" strokeLinecap="round" strokeLinejoin="round" />}
        {pointer && connected > 0 && !complete && <line x1={pattern.points[connected - 1][0]} y1={pattern.points[connected - 1][1]} x2={pointer.x} y2={pointer.y} stroke="#ecd9b1" strokeOpacity=".35" strokeWidth=".3" strokeDasharray="1.2 1.8" />}
        {[...Array(18)].map((_, index) => <circle key={index} cx={(index * 31 + 9) % 96 + 2} cy={(index * 17 + 5) % 68 + 2} r=".16" fill="#d1e2d9" opacity=".25" />)}
      </svg>
      {pattern.points.map(([x, y], index) => <button type="button" className={`star-point ${index < connected ? 'is-lit' : ''} ${index === connected ? 'is-next' : ''}`} style={{ left: `${x}%`, top: `${y / STAR_SETTINGS.height * 100}%` }} key={`${pattern.id}-${index}`} disabled={!active || index !== connected} tabIndex={index === connected && active ? 0 : -1} aria-label={`连接${pattern.title}的第${index + 1}颗星`} onClick={() => connect(index)}><span aria-hidden="true">✦</span></button>)}
      <div className="star-caption" aria-live="polite">{complete ? <><Sparkles size={14} />星光亮起来了</> : connected === 0 ? '从亮着的那颗开始' : null}</div>
    </div>
    <div className="star-footer"><span>点一点，或轻轻划过去</span><button type="button" className="play-soft-button" disabled={!active || connected === 0} onClick={reset}><RotateCcw size={15} />重新连</button></div>
  </div>;
}
