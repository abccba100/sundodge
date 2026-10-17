import type { PlanRow } from '../protocol';
import { fmtClock, minuteInZone } from '../time';

interface Props {
  rows: (PlanRow | null)[];
  current: string;
  tz: string;
  onPick: (iso: string) => void;
}

/** Minutes in direct sun for each departure time: ShadeWalk route (bars) vs shortest route (line). */
export function DepartureChart({ rows, current, tz, onPick }: Props) {
  const ok = rows.filter((r): r is PlanRow => !!r);
  if (!ok.length) return <p className="muted">No route for these points.</p>;
  const W = 300, H = 120, padL = 26, padB = 20, padT = 8;
  const max = Math.max(1, ...ok.map((r) => Math.max(r.shortestSunMin, r.shadySunMin)));
  const bw = (W - padL) / rows.length;
  const y = (v: number) => padT + (H - padB - padT) * (1 - v / max);
  const linePts = rows
    .map((r, i) => (r ? `${padL + bw * i + bw / 2},${y(r.shortestSunMin)}` : null))
    .filter(Boolean)
    .join(' ');
  const curMin = minuteInZone(new Date(current), tz);
  return (
    <>
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Minutes in direct sun by departure time">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={padL} x2={W} y1={y(max * f)} y2={y(max * f)} className="grid" />
          <text x={padL - 4} y={y(max * f) + 3} className="axis" textAnchor="end">{(max * f).toFixed(max * f < 10 ? 1 : 0)}</text>
        </g>
      ))}
      {rows.map((r, i) => {
        if (!r) return null;
        const m = minuteInZone(new Date(r.time), tz);
        const isCur = Math.abs(m - curMin) < 3;
        return (
          <g key={r.time} className="bar" onClick={() => onPick(r.time)}>
            <rect x={padL + bw * i + 2} width={bw - 4} y={y(r.shadySunMin)} height={Math.max(0.5, H - padB - y(r.shadySunMin))} className={isCur ? 'cur' : ''} />
            <rect x={padL + bw * i} width={bw} y={padT} height={H - padB - padT} className="hit" />
            {i % 3 === 0 && <text x={padL + bw * i + bw / 2} y={H - 6} className="axis" textAnchor="middle">{fmtClock(m)}</text>}
          </g>
        );
      })}
      <polyline points={linePts} className="shortline" />
    </svg>
    <p className="muted chart-key">Minutes in direct sun if you leave at each time · bars: ShadeWalk route · dashed line: shortest route. Tap a bar to pick that time.</p>
    </>
  );
}
