import { useEffect, useMemo, useRef, useState } from 'react'
import type { Match } from '../../shared/api'
import { fmtDate, fmtLevel } from '../../shared/util'

export interface Series {
  id: string
  name: string
  /** Palette slot 1–8; stays with the player while they're on the chart. */
  slot: number
  points: Array<{ t: number; level: number }>
}

/** A player's level after each confirmed match, starting from their starting level. */
export function levelHistory(playerId: string, startingLevel: number, createdAt: string, matches: Match[]) {
  const pts = [{ t: Date.parse(createdAt), level: startingLevel }]
  const rated = matches
    .filter((m) => m.status === 'confirmed' && m.levelAAfter != null)
    .sort((x, y) => x.date.localeCompare(y.date) || x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id))
  for (const m of rated) {
    const level = m.playerAId === playerId ? m.levelAAfter! : m.levelBAfter!
    pts.push({ t: Math.max(Date.parse(`${m.date}T12:00:00Z`), pts[0].t), level })
  }
  return pts
}

/** Level at time t: the most recent point at or before t. */
function valueAt(points: Series['points'], t: number): number | null {
  let v: number | null = null
  for (const p of points) {
    if (p.t <= t) v = p.level
    else break
  }
  return v
}

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = Math.max(1, max - min)
  const step0 = span / count
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0)!
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v)
  return out
}

/** Slots 5–8 reuse the four brand colours of slots 1–4, so they're drawn dashed to stay distinct. */
export const seriesDash = (slot: number) => (slot > 4 ? '6 4' : undefined)

/** Legend swatch: the series' colour and dash pattern. */
export function SeriesSwatch({ slot, width = 16 }: { slot: number; width?: number }) {
  return (
    <svg width={width} height={4} aria-hidden className="shrink-0">
      <line x1={1} x2={width - 1} y1={2} y2={2} stroke={`var(--series-${slot})`} strokeWidth={2.5} strokeLinecap="round" strokeDasharray={slot > 4 ? '4 3' : undefined} />
    </svg>
  )
}

const PAD = { top: 12, right: 16, bottom: 28, left: 48 }
const PLOT_H = 220

export function LevelChart({ series }: { series: Series[] }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { x, y, yTicks, xTicks, times, t0, t1 } = useMemo(() => {
    const all = series.flatMap((s) => s.points)
    const now = Date.now()
    const t0 = Math.min(...all.map((p) => p.t))
    const t1 = Math.max(now, ...all.map((p) => p.t))
    const lo = Math.min(...all.map((p) => p.level))
    const hi = Math.max(...all.map((p) => p.level))
    const padY = Math.max(20, (hi - lo) * 0.08)
    const yMin = lo - padY
    const yMax = hi + padY
    const innerW = width - PAD.left - PAD.right
    const x = (t: number) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * innerW
    const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * PLOT_H
    const months = (t1 - t0) / (30 * 86_400_000)
    const xTicks: number[] = []
    const d = new Date(t0)
    d.setUTCDate(1)
    const stepM = months > 48 ? 12 : months > 18 ? 6 : months > 6 ? 3 : 1
    while (d.getTime() <= t1) {
      if (d.getTime() >= t0) xTicks.push(d.getTime())
      d.setUTCMonth(d.getUTCMonth() + stepM)
    }
    const times = [...new Set(all.map((p) => p.t))].sort((a, b) => a - b)
    return { x, y, yTicks: niceTicks(yMin, yMax), xTicks, times, t0, t1 }
  }, [series, width])

  const svgH = PAD.top + PLOT_H + PAD.bottom
  const snap = (clientX: number) => {
    const rect = wrap.current!.getBoundingClientRect()
    const t = t0 + ((clientX - rect.left - PAD.left) / (width - PAD.left - PAD.right)) * (t1 - t0)
    let best = times[0]
    for (const c of times) if (Math.abs(c - t) < Math.abs(best - t)) best = c
    setHover(best)
  }
  const hoverX = hover != null ? x(hover) : 0

  return (
    <div ref={wrap} className="relative select-none">
      <svg
        width={width}
        height={svgH}
        role="img"
        aria-label={`Level over time for ${series.map((s) => s.name).join(', ')}. Use left and right arrow keys to read values.`}
        tabIndex={0}
        className="block touch-pan-y outline-none"
        onPointerMove={(e) => snap(e.clientX)}
        onPointerDown={(e) => snap(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          const i = hover == null ? times.length - 1 : times.indexOf(hover) + (e.key === 'ArrowRight' ? 1 : -1)
          setHover(times[Math.max(0, Math.min(times.length - 1, i))])
        }}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--chart-axis)" className="tabular-nums">
              {fmtLevel(v)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={PAD.top + PLOT_H + 18} textAnchor="middle" fontSize={11} fill="var(--chart-axis)">
            {new Date(t).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })}
          </text>
        ))}
        {series.map((s) => (
          <polyline
            key={s.id}
            fill="none"
            stroke={`var(--series-${s.slot})`}
            strokeWidth={2.25}
            strokeDasharray={seriesDash(s.slot)}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={s.points.map((p) => `${x(p.t)},${y(p.level)}`).join(' ')}
          />
        ))}
        {hover != null && (
          <>
            <line x1={hoverX} x2={hoverX} y1={PAD.top} y2={PAD.top + PLOT_H} stroke="var(--chart-axis)" strokeWidth={1} opacity={0.6} />
            {series.map((s) => {
              const v = valueAt(s.points, hover)
              return v == null ? null : (
                <circle key={s.id} cx={hoverX} cy={y(v)} r={4} fill={`var(--series-${s.slot})`} stroke="var(--white)" strokeWidth={2} className="dark:stroke-ink-900" />
              )
            })}
          </>
        )}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-36 fade-in rounded-lg bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200 dark:bg-ink-800 dark:ring-ink-700"
          style={hoverX > width / 2 ? { right: width - hoverX + 12 } : { left: hoverX + 12 }}
        >
          <div className="mb-1 muted">{fmtDate(new Date(hover).toISOString())}</div>
          {series.map((s) => {
            const v = valueAt(s.points, hover)
            return (
              <div key={s.id} className="flex items-center gap-2 py-0.5">
                <SeriesSwatch slot={s.slot} width={14} />
                <strong className="tabular-nums">{v == null ? '—' : fmtLevel(v)}</strong>
                <span className="truncate muted">{s.name}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
