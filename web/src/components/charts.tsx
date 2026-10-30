import { useMemo, useState, type MouseEvent } from 'react';
import { fmtStat, STAT_LABEL } from '../lib/format';
import { TrackPath } from '../lib/track';
import { surfaceColors } from '../lib/track';
import type { Animal, Stats, Venue } from '../lib/types';

const SERIES = { curve: '#3987e5', tight: '#d95926', down: '#199e70', up: '#c98500' };

function pathFrom(points: [number, number][], close = false): string {
  if (!points.length) return '';
  return `M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}${close ? 'Z' : ''}`;
}

export function TrackMap({ venue, mini = false }: { venue: Pick<Venue, 'segments' | 'lapLength' | 'lanes' | 'surface' | 'id'>; mini?: boolean }) {
  const geometry = useMemo(() => {
    const track = new TrackPath(venue.segments, venue.lapLength, venue.lanes || 10, 1);
    const width = mini ? 260 : 640;
    const pad = mini ? 10 : 26;
    const spanX = track.maxX - track.minX;
    const spanZ = track.maxZ - track.minZ;
    const scale = (width - pad * 2) / Math.max(spanX, spanZ * 1.0001, 1);
    const height = Math.max(mini ? 120 : 220, spanZ * scale + pad * 2);
    const offsetY = (height - spanZ * scale) / 2;
    const project = (x: number, z: number): [number, number] => [pad + (x - track.minX) * scale, offsetY + (z - track.minZ) * scale];
    const samples = track.samples(mini ? 4 : 1.5);
    const edge = (lateral: number) => samples.map((s) => {
      const p = track.point(s, lateral);
      return project(p.x, p.z);
    });
    const outer = edge(track.outerOffset());
    const inner = edge(track.innerOffset());
    const surface = pathFrom([...outer, ...[...inner].reverse()], true);
    const lanes = mini
      ? []
      : Array.from({ length: (venue.lanes || 10) - 1 }, (_, i) => pathFrom(edge(track.laneOffset(i + 1) + 0.7)));
    const mid = track.laneOffset(((venue.lanes || 10) + 1) / 2);
    const overlays = track.ranges
      .filter((range) => range.type !== 'STRAIGHT')
      .map((range) => {
        const points: [number, number][] = [];
        const steps = Math.max(2, Math.ceil((range.end - range.start) / 2));
        for (let i = 0; i <= steps; i += 1) {
          const p = track.point(range.start + ((range.end - range.start) * i) / steps - (i === steps ? 0.001 : 0), mid);
          points.push(project(p.x, p.z));
        }
        const kind = range.type === 'UPHILL' ? 'up' : range.type === 'DOWNHILL' ? 'down' : range.radius < 30 ? 'tight' : 'curve';
        return { d: pathFrom(points), kind: kind as keyof typeof SERIES, key: range.index };
      });
    const a = track.point(0, track.innerOffset() - 1.5);
    const b = track.point(0, track.outerOffset() + 1.5);
    const finish = [project(a.x, a.z), project(b.x, b.z)] as const;
    const arrowFrame = track.frame(venue.lapLength * 0.06);
    const arrowPoint = track.point(venue.lapLength * 0.06, track.outerOffset() + (mini ? 6 : 5));
    const [ax, ay] = project(arrowPoint.x, arrowPoint.z);
    const angle = (Math.atan2(arrowFrame.tz, arrowFrame.tx) * 180) / Math.PI;
    const strokeScale = scale;
    return { width, height, surface, lanes, overlays, finish, arrow: { x: ax, y: ay, angle }, strokeScale, hasHills: track.maxY > 0.05 };
  }, [venue.id, venue.segments, venue.lapLength, venue.lanes, mini]);
  const colors = surfaceColors(venue.surface);
  return (
    <svg className="trackmap" viewBox={`0 0 ${geometry.width} ${geometry.height}`} role="img" aria-label="Track map">
      <path d={geometry.surface} fill={colors.track} fillRule="evenodd" stroke="rgba(255,255,255,0.65)" strokeWidth={mini ? 1 : 1.5} />
      {geometry.lanes.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.6} />
      ))}
      {geometry.overlays.map((overlay) => (
        <path key={overlay.key} d={overlay.d} fill="none" stroke={SERIES[overlay.kind]} strokeWidth={mini ? 3 : 4} strokeLinecap="round" opacity={0.95} />
      ))}
      <line x1={geometry.finish[0][0]} y1={geometry.finish[0][1]} x2={geometry.finish[1][0]} y2={geometry.finish[1][1]} stroke="#fff" strokeWidth={mini ? 2.5 : 4} strokeDasharray={mini ? '2 2' : '3 3'} />
      <line x1={geometry.finish[0][0]} y1={geometry.finish[0][1]} x2={geometry.finish[1][0]} y2={geometry.finish[1][1]} stroke="#111" strokeWidth={mini ? 2.5 : 4} strokeDasharray={mini ? '2 2' : '3 3'} strokeDashoffset={mini ? 2 : 3} />
      <g transform={`translate(${geometry.arrow.x.toFixed(1)} ${geometry.arrow.y.toFixed(1)}) rotate(${geometry.arrow.angle.toFixed(1)})`}>
        <path d={mini ? 'M-5,-4 L5,0 L-5,4 Z' : 'M-8,-6 L8,0 L-8,6 Z'} fill="var(--accent)" />
      </g>
    </svg>
  );
}

export function TrackLegend({ venue }: { venue: Venue }) {
  const has = (kind: string) =>
    venue.segments.some((s) => (kind === 'tight' ? s.type === 'CURVE' && (s.radius ?? 99) < 30 : kind === 'curve' ? s.type === 'CURVE' && (s.radius ?? 0) >= 30 : s.type === (kind === 'up' ? 'UPHILL' : 'DOWNHILL')));
  const items: [keyof typeof SERIES, string][] = [
    ['curve', 'Curve'],
    ['tight', 'Tight curve (r < 30 m)'],
    ['up', 'Uphill'],
    ['down', 'Downhill'],
  ];
  return (
    <div className="legend">
      <span>
        <i style={{ background: '#fff' }} /> Start / finish
      </span>
      {items
        .filter(([kind]) => has(kind))
        .map(([kind, label]) => (
          <span key={kind}>
            <i style={{ background: SERIES[kind] }} /> {label}
          </span>
        ))}
    </div>
  );
}

export function ElevationProfile({ venue }: { venue: Venue }) {
  const data = useMemo(() => {
    const track = new TrackPath(venue.segments, venue.lapLength, venue.lanes || 10, 1);
    const samples = track.samples(2);
    return { points: samples.map((s) => [s, track.frame(s).y] as [number, number]), maxY: track.maxY, lap: track.lapLength };
  }, [venue.id, venue.segments, venue.lapLength]);
  if (data.maxY < 0.05) return <div className="small muted">Flat track: no elevation change.</div>;
  const width = 640;
  const height = 120;
  const pad = { l: 34, r: 10, t: 10, b: 22 };
  const x = (s: number) => pad.l + (s / data.lap) * (width - pad.l - pad.r);
  const y = (h: number) => height - pad.b - (h / Math.max(data.maxY, 1)) * (height - pad.t - pad.b);
  const line = pathFrom(data.points.map(([s, h]) => [x(s), y(h)]));
  const area = `${line}L${x(data.lap).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Elevation profile, highest point ${data.maxY.toFixed(1)} metres`}>
      <line x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} stroke="var(--line-2)" />
      <line x1={pad.l} x2={width - pad.r} y1={y(data.maxY)} y2={y(data.maxY)} stroke="var(--line)" strokeDasharray="3 4" />
      <text x={pad.l - 6} y={y(data.maxY) + 4} textAnchor="end" fill="var(--muted)" fontSize="10">
        {data.maxY.toFixed(1)}m
      </text>
      <text x={pad.l - 6} y={y(0) + 4} textAnchor="end" fill="var(--muted)" fontSize="10">
        0
      </text>
      <path d={area} fill="rgba(57,135,229,0.18)" />
      <path d={line} fill="none" stroke="#3987e5" strokeWidth={2} />
      <text x={x(0)} y={height - 6} fill="var(--muted)" fontSize="10">
        start
      </text>
      <text x={x(data.lap)} y={height - 6} fill="var(--muted)" fontSize="10" textAnchor="end">
        {Math.round(data.lap)} m
      </text>
    </svg>
  );
}

const STAGE_TINT: Record<string, string> = { ROOKIE: 'rgba(255,255,255,0.03)', PRIME: 'rgba(255,255,255,0.065)', VETERAN: 'rgba(255,255,255,0.03)' };

export function AgingChart({ animal }: { animal: Animal }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = useMemo(() => {
    const keys = Object.keys(STAT_LABEL) as (keyof Stats)[];
    return [...animal.agingHistory]
      .sort((a, b) => a.careerDay - b.careerDay)
      .map((row) => ({
        day: row.careerDay,
        date: row.day,
        stage: row.lifeStage,
        stats: row.stats,
        condition: (keys.reduce((sum, k) => sum + (animal.base[k] ? row.stats[k] / animal.base[k] : 1), 0) / keys.length) * 100,
      }));
  }, [animal]);
  if (points.length < 2) {
    return <div className="small muted">The aging curve fills in day by day (1 real day = 1 animal week). Not enough history yet.</div>;
  }
  const width = 640;
  const height = 220;
  const pad = { l: 40, r: 14, t: 22, b: 26 };
  const minDay = points[0]!.day;
  const maxDay = Math.max(points[points.length - 1]!.day, minDay + 1);
  const values = points.map((p) => p.condition);
  const lo = Math.floor(Math.min(...values, 95) - 1);
  const hi = Math.ceil(Math.max(...values, 100) + 1);
  const x = (d: number) => pad.l + ((d - minDay) / (maxDay - minDay)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const bands: { stage: string; from: number; to: number }[] = [];
  for (const p of points) {
    const last = bands[bands.length - 1];
    if (last && last.stage === p.stage) last.to = p.day;
    else bands.push({ stage: p.stage, from: p.day, to: p.day });
  }
  const line = pathFrom(points.map((p) => [x(p.day), y(p.condition)]));
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  const hovered = hover !== null ? points[hover] : null;
  const onMove = (event: MouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const day = minDay + ratio * (maxDay - minDay);
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(p.day - day) < Math.abs(points[best]!.day - day)) best = i;
    });
    setHover(best);
  };
  return (
    <div style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Condition relative to base stats by career day">
        {bands.map((band, i) => {
          const next = bands[i + 1];
          const x0 = x(band.from);
          const x1 = next ? x(next.from) : x(band.to);
          return (
            <g key={`${band.stage}-${band.from}`}>
              <rect x={x0} y={pad.t} width={Math.max(0, x1 - x0)} height={height - pad.t - pad.b} fill={STAGE_TINT[band.stage] ?? 'transparent'} />
              <text x={x0 + 4} y={pad.t - 7} fill="var(--muted)" fontSize="10" fontWeight={700} letterSpacing="0.08em">
                {band.stage}
              </text>
            </g>
          );
        })}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t === 100 ? undefined : '2 4'} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fill="var(--muted)" fontSize="10">
              {t}%
            </text>
          </g>
        ))}
        <path d={line} fill="none" stroke="#3987e5" strokeWidth={2} strokeLinejoin="round" />
        {hovered && (
          <g>
            <line x1={x(hovered.day)} x2={x(hovered.day)} y1={pad.t} y2={height - pad.b} stroke="var(--text-2)" strokeWidth={1} />
            <circle cx={x(hovered.day)} cy={y(hovered.condition)} r={4.5} fill="#3987e5" stroke="var(--bg)" strokeWidth={2} />
          </g>
        )}
        <text x={pad.l} y={height - 7} fill="var(--muted)" fontSize="10">
          day {minDay}
        </text>
        <text x={width - pad.r} y={height - 7} fill="var(--muted)" fontSize="10" textAnchor="end">
          day {maxDay}
        </text>
        <rect x={pad.l} y={pad.t} width={width - pad.l - pad.r} height={height - pad.t - pad.b} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hovered && (
        <div
          className="card small"
          style={{
            position: 'absolute',
            top: 4,
            ...(x(hovered.day) / width > 0.5 ? { right: `${101 - (x(hovered.day) / width) * 100}%` } : { left: `${(x(hovered.day) / width) * 100 + 1}%` }),
            padding: '8px 10px',
            pointerEvents: 'none',
            minWidth: 170,
          }}
        >
          <b>
            Day {hovered.day} · {hovered.stage.toLowerCase()}
          </b>
          <div className="muted tiny">{hovered.date}</div>
          <div>Condition {hovered.condition.toFixed(1)}% of base</div>
          {(Object.keys(STAT_LABEL) as (keyof Stats)[]).map((k) => (
            <div key={k} className="tiny">
              {STAT_LABEL[k]} {fmtStat(k, hovered.stats[k])}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
