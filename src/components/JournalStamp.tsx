import type { MoodScore } from '../types';

/** 本地矢量心情邮票；无评分时使用安静陪伴表情，不替用户选择情绪。 */
export default function JournalStamp({ mood = null, className = '' }: { mood?: MoodScore | null; className?: string }) {
  const quiet = mood === null || mood <= 2;
  const color = mood === 1 ? '#dde6f0' : mood === 2 ? '#e6e0ed' : mood === 3 ? '#dcebe2' : mood === 4 ? '#f3e8cb' : mood === 5 ? '#f6dfcc' : '#e7ece6';
  return <svg className={`journal-stamp ${className}`} viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <path d="M18 12h64l6 6v64l-6 6H18l-6-6V18Z" fill={color} stroke="currentColor" strokeOpacity=".14" strokeDasharray="2 4" />
    <path d="M26 58C24 35 35 25 50 25s26 10 24 33c-1 16-11 22-24 22S27 74 26 58Z" fill="#fffdf5" stroke="currentColor" strokeOpacity=".13" />
    <ellipse cx="26" cy="60" rx="5" ry="8" fill="#fffdf5" stroke="currentColor" strokeOpacity=".1" transform="rotate(15 26 60)" />
    <ellipse cx="74" cy="60" rx="5" ry="8" fill="#fffdf5" stroke="currentColor" strokeOpacity=".1" transform="rotate(-15 74 60)" />
    <ellipse cx="39" cy="78" rx="7" ry="3.5" fill="#fffdf5" /><ellipse cx="61" cy="78" rx="7" ry="3.5" fill="#fffdf5" />
    <ellipse cx="40" cy="49" rx="2.4" ry="3.5" fill="currentColor" /><ellipse cx="60" cy="49" rx="2.4" ry="3.5" fill="currentColor" />
    <circle cx="39.4" cy="47.8" r=".8" fill="white" /><circle cx="59.4" cy="47.8" r=".8" fill="white" />
    <ellipse cx="35" cy="57" rx="5" ry="2" fill="#e7b8ae" opacity=".45" /><ellipse cx="65" cy="57" rx="5" ry="2" fill="#e7b8ae" opacity=".45" />
    <path d={quiet ? 'M46 62q4 2 8 0' : mood === 3 ? 'M46 61q4 4 8 0' : 'M44 60q6 9 12 0'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    {mood === 1 && <path d="m37 41 6-2m14 0 6 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
    {mood !== null && mood >= 4 && <path d="m77 25 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5Z" fill="#b99758" opacity=".7" />}
  </svg>;
}
