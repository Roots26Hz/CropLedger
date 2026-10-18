/**
 * N, P and K trends as three small multiples. The nutrients share a unit
 * (mg/kg) but sit on very different scales (P ≈ 30, K ≈ 180), so each gets
 * its own panel and axis instead of a cramped shared axis.
 */
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatClock } from "../utils/format";

export interface NpkPoint {
  /** Sequence position on the x axis (e.g. device nonce). */
  x: number;
  /** Milliseconds since epoch (shown in the tooltip). */
  t: number;
  n: number;
  p: number;
  k: number;
  anomaly?: boolean;
}

const SERIES = [
  { key: "n", name: "Nitrogen", short: "N", color: "var(--color-npk-n)" },
  { key: "p", name: "Phosphorus", short: "P", color: "var(--color-npk-p)" },
  { key: "k", name: "Potassium", short: "K", color: "var(--color-npk-k)" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

interface TooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  seriesKey: SeriesKey;
  name: string;
}

function ChartTooltip({ active, payload, seriesKey, name }: TooltipProps) {
  const point = payload?.[0]?.payload as NpkPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-[var(--shadow-pop)]">
      <p className="text-ink-faint">
        Reading {point.x} · {formatClock(point.t)}
      </p>
      <p className="mt-0.5 font-medium text-ink">
        {name}: <span className="tabular">{point[seriesKey]}</span> mg/kg
      </p>
      {point.anomaly && <p className="mt-0.5 font-medium text-danger-600">Edge AI: anomaly</p>}
    </div>
  );
}

function AnomalyDot(props: { cx?: number; cy?: number; payload?: NpkPoint }) {
  const { cx, cy, payload } = props;
  if (!payload?.anomaly || cx === undefined || cy === undefined) return null;
  return <circle cx={cx} cy={cy} r={4.5} fill="var(--color-danger-500)" stroke="var(--color-surface)" strokeWidth={2} />;
}

export function NpkTrendChart({ data, height = 150 }: { data: NpkPoint[]; height?: number }) {
  const latest = data.at(-1);
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {SERIES.map((s) => (
        <figure key={s.key} className="min-w-0">
          <figcaption className="mb-1 flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
              <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} aria-hidden="true" />
              {s.name} ({s.short}) · mg/kg
            </span>
            {latest && <span className="tabular text-lg font-semibold text-ink" title="Latest value">{latest[s.key]}</span>}
          </figcaption>
          <div style={{ height }} role="img" aria-label={`${s.name} over time, ${data.length} readings`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid vertical={false} stroke="var(--color-line)" strokeWidth={1} />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  allowDecimals={false}
                  tickFormatter={(x: number) => `#${x}`}
                  tick={{ fontSize: 10, fill: "var(--color-ink-faint)" }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--color-line)" }}
                  minTickGap={40}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tick={{ fontSize: 10, fill: "var(--color-ink-faint)" }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  allowDecimals={false}
                />
                <Tooltip
                  content={(props) => <ChartTooltip active={props.active} payload={props.payload} seriesKey={s.key} name={s.name} />}
                  cursor={{ stroke: "var(--color-line-strong)", strokeWidth: 1 }}
                />
                <Line
                  type="linear"
                  dataKey={s.key}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={<AnomalyDot />}
                  activeDot={{ r: 4.5, stroke: "var(--color-surface)", strokeWidth: 2, fill: s.color }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </figure>
      ))}
    </div>
  );
}
