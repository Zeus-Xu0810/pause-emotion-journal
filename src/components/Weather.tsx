import type { MoodScore } from '../types';

/** 手绘天气随自评变化，图形由本地 SVG 绘制，无第三方图片请求。 */
export default function Weather({ mood = 3, mini = false }: { mood?: MoodScore; mini?: boolean }) {
  const sunny = mood >= 4;
  const cloudy = mood < 5;
  return <svg className={mini ? 'mini-weather' : 'weather-art'} viewBox="0 0 260 150" fill="none" aria-hidden="true">
    {!mini && <><path d="M29 120h27m-14 8h40m104-3h35" stroke="currentColor" opacity=".18" strokeLinecap="round" /><circle cx="40" cy="39" r="2" fill="currentColor" opacity=".3" /><path d="M220 45v8m-4-4h8" stroke="currentColor" opacity=".4" strokeLinecap="round" /></>}
    {sunny && <g className="weather-sun" stroke="currentColor" strokeWidth={mini ? 6 : 2.6} strokeLinecap="round"><circle cx={mood === 5 ? 130 : 154} cy="66" r={mood === 5 ? 35 : 28} fill="currentColor" fillOpacity=".14" />{Array.from({ length: 10 }, (_, i) => <path key={i} d={`M${(mood === 5 ? 130 : 154) + Math.cos(i * Math.PI / 5) * 46} ${66 + Math.sin(i * Math.PI / 5) * 46}l${Math.cos(i * Math.PI / 5) * 10} ${Math.sin(i * Math.PI / 5) * 10}`} />)}</g>}
    {cloudy && <g stroke="currentColor" strokeWidth={mini ? 6 : 2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M76 99c-19 0-26-25-12-37 8-7 16-6 24-3 4-24 35-33 53-17 9 8 12 16 11 25 16-9 35 1 35 16 0 10-8 17-19 17Z" fill="var(--paper, #f8f9f5)" /><path d="M102 77c2-5 7-8 13-8" opacity=".3" />{mood === 1 && <g className="weather-rain"><path d="m91 112-5 10m34-10-5 10m34-10-5 10" /></g>}{mood === 2 && <path d="M82 116h61m-43 9h58" opacity=".5" />}</g>}
    {mood === 5 && <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M118 65v3m24-3v3m-25 10c6 8 18 8 25 0" /></g>}
  </svg>;
}
