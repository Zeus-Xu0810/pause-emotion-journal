import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Footprints, Headphones, Leaf, Wind } from 'lucide-react';
import { PLAY_ACTIVITIES, type PlayActivityId } from '../play-content';
import { selectDrawingOwner } from '../lib/playDrawing';
import type { CareSession, MoodScore } from '../types';
import PlayStudio from './PlayStudio';
import '../play.css';

/** 新旧活动共用账号与反馈入口，具体玩法不上传画作或操作轨迹。 */
export interface PlayHubProps { mood: MoodScore | null; entryId?: string | null; onComplete: (session: CareSession) => Promise<void>; onNotice: (message: string) => void; ownerKey: string }
function ActivityArtwork({ activity }: { activity: PlayActivityId }) {
  return <svg viewBox="0 0 300 200" fill="none" aria-hidden="true" className={`play-card-art play-art-${activity}`}>
    {activity === 'drawing' ? <><path d="M57 133C71 100 85 65 104 75C130 88 87 150 125 139C154 131 142 60 173 63C205 65 166 146 204 131C217 125 228 100 242 91" stroke="#5d8672" strokeWidth="12" strokeLinecap="round" /><path d="M80 153C128 170 199 161 224 143" stroke="#cc9986" strokeWidth="6" strokeLinecap="round" /><circle cx="68" cy="67" r="7" fill="#baa773" /></> : activity === 'constellation' ? <><path d="M150 66L128 47L103 55L92 79L102 105L124 127L150 150L176 127L198 105L208 79L197 55L172 47Z" stroke="#9c95b3" strokeWidth="1.4" />{[[150, 66], [128, 47], [103, 55], [92, 79], [102, 105], [124, 127], [150, 150], [176, 127], [198, 105], [208, 79], [197, 55], [172, 47]].map(([x, y], index) => <circle key={index} cx={x} cy={y} r={index === 6 ? 4 : 2.4} fill="#a49ab7" />)}<path d="M236 48V59M230.5 53.5H241.5" stroke="#b5a46e" strokeLinecap="round" /></> : <><circle cx="81" cy="44" r="4" fill="#c6ad6e" /><circle cx="207" cy="65" r="5" fill="#c6ad6e" /><circle cx="159" cy="31" r="3" fill="#c6ad6e" /><path d="M114 130L102 141M186 130L198 141M137 156L134 166M163 156L166 166" stroke="#d8d6c4" strokeWidth="7" strokeLinecap="round" /><ellipse cx="150" cy="129" rx="43" ry="34" fill="#fffcef" /><ellipse cx="138" cy="126" rx="2" ry="3" fill="#577366" /><ellipse cx="162" cy="126" rx="2" ry="3" fill="#577366" /><path d="M143 137Q150 144 157 137" stroke="#577366" strokeWidth="1.8" strokeLinecap="round" /></>}
  </svg>;
}
function PlayHubContent(props: PlayHubProps) {
  const [activity, setActivity] = useState<PlayActivityId | null>(null);
  // 即使没有打开涂鸦，账号变化也会释放上一位使用者的画作。
  useEffect(() => { selectDrawingOwner(props.ownerKey); }, [props.ownerKey]);
  if (activity) return <PlayStudio {...props} key={`${props.ownerKey}-${activity}`} activityId={activity} onBack={() => setActivity(null)} />;
  return <section className="play-hub" aria-label="放松活动">
    <div className="play-activity-grid">{PLAY_ACTIVITIES.map(item => <button type="button" className="play-activity-card" key={item.id} style={{ '--activity-paper': item.color } as React.CSSProperties} onClick={() => setActivity(item.id)}><ActivityArtwork activity={item.id} /><span className="play-card-copy"><strong>{item.title}</strong><span>{item.hint}</span></span><ArrowUpRight size={18} className="play-card-arrow" /></button>)}</div>
    <div className="play-classics"><p>也可以，慢一点</p><div><Link to="/care?type=breathing"><Wind size={17} />呼吸</Link><Link to="/care?type=mindfulness"><Leaf size={17} />正念</Link><Link to="/care?type=music"><Headphones size={17} />声音</Link><Link to="/care?type=movement"><Footprints size={17} />活动</Link></div></div>
  </section>;
}

/** 账号切换时重建全部会话状态，避免把前一个账号的反馈提交给新账号。 */
export default function PlayHub(props: PlayHubProps) { return <PlayHubContent {...props} key={props.ownerKey} />; }
