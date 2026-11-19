import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, PieChart as PieChartIcon } from 'lucide-react';
import {
  formatAmount,
  getTaskCompletedReferenceMs,
  isRowPopulated,
  parseCurrencyValue,
  type TaskRow,
  type TaskStatus,
} from '../types/task';

interface BillingAnalyticsDashboardProps {
  tasks: TaskRow[];
  currencySymbol: string;
  onFilterByStatus: (status: TaskStatus | 'ALL') => void;
}

type TrendMode = 'daily' | 'cumulative';

interface DailyCompletionPoint {
  dateKey: string;
  shortLabel: string;
  fullLabel: string;
  completed: number;
  cumulative: number;
  completedValue: number;
}

interface StatusPieDatum {
  name: string;
  value: TaskStatus;
  count: number;
  percentage: number;
  contractValue: number;
  color: string;
  bgClass: string;
}

const STATUS_CHART_CONFIG: Array<{
  name: string;
  value: TaskStatus;
  color: string;
  bgClass: string;
}> = [
  { name: 'Completed', value: 'Completed', color: '#059669', bgClass: 'bg-emerald-600' },
  { name: 'In Progress', value: 'In Progress', color: '#1A365D', bgClass: 'bg-[#1A365D]' },
  { name: 'Under Review', value: 'Under Review', color: '#D97706', bgClass: 'bg-amber-600' },
  { name: 'Not Started', value: 'Not Started', color: '#64748B', bgClass: 'bg-slate-500' },
  { name: 'On Hold', value: 'On Hold', color: '#DC2626', bgClass: 'bg-red-600' },
  { name: 'Unassigned', value: '', color: '#CBD5E1', bgClass: 'bg-slate-300' },
];

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatShortDate(date: Date): string {
  return `${SHORT_MONTHS[date.getMonth()]} ${date.getDate()}`;
}

function formatFullDate(date: Date): string {
  return `${SHORT_MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

interface TrendTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: DailyCompletionPoint }>;
  currencySymbol: string;
}

const TrendChartTooltip: React.FC<TrendTooltipProps> = ({
  active,
  payload,
  currencySymbol,
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="rounded-md border border-slate-200 bg-white px-3.5 py-2.5 text-xs shadow-md">
      <p className="font-semibold text-[#1A365D]">{point.fullLabel}</p>
      <div className="mt-1.5 space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Completed on day</span>
          <span className="font-mono font-semibold text-slate-900 tabular-nums">
            {point.completed} {point.completed === 1 ? 'task' : 'tasks'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">30-day cumulative</span>
          <span className="font-mono font-semibold text-emerald-700 tabular-nums">
            {point.cumulative} {point.cumulative === 1 ? 'task' : 'tasks'}
          </span>
        </div>
        {point.completedValue > 0 && (
          <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-1">
            <span className="text-slate-500">Completed value</span>
            <span className="font-mono font-semibold text-[#1A365D] tabular-nums">
              {formatAmount(point.completedValue, currencySymbol)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

interface StatusTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: StatusPieDatum }>;
  currencySymbol: string;
}

const StatusPieTooltip: React.FC<StatusTooltipProps> = ({
  active,
  payload,
  currencySymbol,
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="rounded-md border border-slate-200 bg-white px-3.5 py-2.5 text-xs shadow-md">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-xs shrink-0 ${item.bgClass}`}
        />
        <span className="font-semibold text-slate-900">{item.name}</span>
      </div>
      <div className="mt-1.5 space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Tasks</span>
          <span className="font-mono font-semibold text-slate-900 tabular-nums">
            {item.count} ({item.percentage.toFixed(1)}%)
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Contract value</span>
          <span className="font-mono font-semibold text-[#1A365D] tabular-nums">
            {formatAmount(item.contractValue, currencySymbol)}
          </span>
        </div>
      </div>
    </div>
  );
};

export const BillingAnalyticsDashboard: React.FC<
  BillingAnalyticsDashboardProps
> = ({ tasks, currencySymbol, onFilterByStatus }) => {
  const [trendMode, setTrendMode] = useState<TrendMode>('daily');

  const populatedTasks = useMemo(() => tasks.filter(isRowPopulated), [tasks]);

  // Build exact rolling 30-day task completion series (oldest -> today)
  const completionAnalytics = useMemo(() => {
    const today = new Date();
    const endDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );

    const bucketMap = new Map<
      string,
      {
        dateKey: string;
        shortLabel: string;
        fullLabel: string;
        completed: number;
        completedValue: number;
      }
    >();
    const orderedKeys: string[] = [];

    for (let offset = 29; offset >= 0; offset -= 1) {
      const d = new Date(endDay);
      d.setDate(endDay.getDate() - offset);
      const key = toLocalDateKey(d);
      orderedKeys.push(key);
      bucketMap.set(key, {
        dateKey: key,
        shortLabel: formatShortDate(d),
        fullLabel: formatFullDate(d),
        completed: 0,
        completedValue: 0,
      });
    }

    let totalCompletedAllTime = 0;
    let outsideWindowOrUndated = 0;

    for (const task of populatedTasks) {
      if (task.taskStatus !== 'Completed') continue;
      totalCompletedAllTime += 1;

      const refMs = getTaskCompletedReferenceMs(task);
      if (refMs === null) {
        outsideWindowOrUndated += 1;
        continue;
      }

      // Date-only strings like dueDate resolve via UTC midnight, while ISO timestamps carry timezone.
      // Convert cleanly using local calendar date unless refMs came from a YYYY-MM-DD dueDate fallback.
      const hasExplicitTimestamp = Boolean(task.completedAt);
      const refDate = new Date(refMs);
      const key = hasExplicitTimestamp
        ? toLocalDateKey(refDate)
        : `${refDate.getUTCFullYear()}-${String(
            refDate.getUTCMonth() + 1
          ).padStart(2, '0')}-${String(refDate.getUTCDate()).padStart(2, '0')}`;

      const bucket = bucketMap.get(key);
      if (bucket) {
        bucket.completed += 1;
        bucket.completedValue += parseCurrencyValue(task.taskPrice);
      } else {
        outsideWindowOrUndated += 1;
      }
    }

    let runningTotal = 0;
    let last7DaysCount = 0;
    let peakDayCount = 0;
    let completedValue30d = 0;

    const series: DailyCompletionPoint[] = orderedKeys.map((key, idx) => {
      const b = bucketMap.get(key)!;
      runningTotal += b.completed;
      completedValue30d += b.completedValue;
      if (b.completed > peakDayCount) {
        peakDayCount = b.completed;
      }
      if (idx >= orderedKeys.length - 7) {
        last7DaysCount += b.completed;
      }
      return {
        dateKey: b.dateKey,
        shortLabel: b.shortLabel,
        fullLabel: b.fullLabel,
        completed: b.completed,
        cumulative: runningTotal,
        completedValue: b.completedValue,
      };
    });

    return {
      series,
      totalIn30Days: runningTotal,
      last7DaysCount,
      peakDayCount,
      completedValue30d,
      totalCompletedAllTime,
      outsideWindowOrUndated,
    };
  }, [populatedTasks]);

  // Build Task Status pie distribution
  const statusPieData = useMemo<StatusPieDatum[]>(() => {
    const total = populatedTasks.length;
    if (total === 0) return [];

    return STATUS_CHART_CONFIG.map((cfg) => {
      const matching = populatedTasks.filter((t) => t.taskStatus === cfg.value);
      const contractValue = matching.reduce(
        (sum, t) => sum + parseCurrencyValue(t.taskPrice),
        0
      );
      return {
        name: cfg.name,
        value: cfg.value,
        count: matching.length,
        percentage: (matching.length / total) * 100,
        contractValue,
        color: cfg.color,
        bgClass: cfg.bgClass,
      };
    }).filter((item) => item.count > 0);
  }, [populatedTasks]);

  const completionSharePct = useMemo(() => {
    if (populatedTasks.length === 0) return 0;
    return (completionAnalytics.totalCompletedAllTime / populatedTasks.length) * 100;
  }, [completionAnalytics.totalCompletedAllTime, populatedTasks.length]);

  const isCumulative = trendMode === 'cumulative';
  const strokeColor = isCumulative ? '#059669' : '#1A365D';
  const gradientId = isCumulative
    ? 'billingTrendCumulativeFill'
    : 'billingTrendDailyFill';

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
      {/* Left: 30-Day Task Completion Trend */}
      <section className="flex flex-col rounded-lg border border-slate-200 bg-white lg:col-span-7">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[#1A365D]">
              <BarChart3 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <h2 className="text-base font-semibold">
                Task Completion Trend (Last 30 Days)
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-600">
              {isCumulative
                ? 'Cumulative tasks marked Completed across the trailing 30-day window.'
                : 'Daily count of tasks marked Completed over the last 30 days.'}
            </p>
          </div>

          <div
            role="group"
            aria-label="Completion trend display mode"
            className="flex items-center gap-1 rounded-md bg-slate-100 p-1 w-fit shrink-0"
          >
            <button
              type="button"
              onClick={() => setTrendMode('daily')}
              className={`cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                trendMode === 'daily'
                  ? 'bg-white text-[#1A365D] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Daily
            </button>
            <button
              type="button"
              onClick={() => setTrendMode('cumulative')}
              className={`cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                trendMode === 'cumulative'
                  ? 'bg-white text-[#1A365D] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Cumulative
            </button>
          </div>
        </div>

        {/* Inline KPI Strip for 30-Day Velocity */}
        <div className="grid grid-cols-3 divide-x divide-slate-200 border-b border-slate-200 bg-[#F9FBFD] text-xs">
          <div className="px-5 py-3">
            <p className="text-[11px] font-medium text-slate-500">
              Completed (30d)
            </p>
            <p className="mt-0.5 font-mono text-base font-semibold text-[#1A365D] tabular-nums">
              {completionAnalytics.totalIn30Days}
            </p>
          </div>
          <div className="px-5 py-3">
            <p className="text-[11px] font-medium text-slate-500">
              Last 7 Days
            </p>
            <p className="mt-0.5 font-mono text-base font-semibold text-emerald-700 tabular-nums">
              {completionAnalytics.last7DaysCount}
            </p>
          </div>
          <div className="px-5 py-3">
            <p className="text-[11px] font-medium text-slate-500">
              30d Completed Value
            </p>
            <p className="mt-0.5 font-mono text-base font-semibold text-slate-900 tabular-nums truncate">
              {formatAmount(completionAnalytics.completedValue30d, currencySymbol)}
            </p>
          </div>
        </div>

        {/* Recharts AreaChart */}
        <div className="flex-1 px-4 pt-5 pb-4">
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={completionAnalytics.series}
                margin={{ top: 8, right: 16, left: -12, bottom: 0 }}
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor={strokeColor}
                      stopOpacity={0.22}
                    />
                    <stop
                      offset="95%"
                      stopColor={strokeColor}
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#E2E8F0"
                />
                <XAxis
                  dataKey="shortLabel"
                  tick={{ fill: '#64748B', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: '#CBD5E1' }}
                  minTickGap={28}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: '#64748B', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, (dataMax: number) => Math.max(dataMax, 3)]}
                />
                <Tooltip
                  content={
                    <TrendChartTooltip currencySymbol={currencySymbol} />
                  }
                />
                <Area
                  type="monotone"
                  dataKey={isCumulative ? 'cumulative' : 'completed'}
                  name={isCumulative ? 'Cumulative Completed' : 'Completed'}
                  stroke={strokeColor}
                  strokeWidth={2.25}
                  fill={`url(#${gradientId})`}
                  activeDot={{
                    r: 4.5,
                    fill: strokeColor,
                    stroke: '#FFFFFF',
                    strokeWidth: 2,
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-2 text-[11px] text-slate-500">
            <span>
              {completionAnalytics.totalIn30Days === 0
                ? 'No tasks completed in the last 30 days yet. Mark any task Completed in the ledger to plot daily completions.'
                : `Peak day: ${completionAnalytics.peakDayCount} ${
                    completionAnalytics.peakDayCount === 1 ? 'task' : 'tasks'
                  } completed.`}
            </span>
            {completionAnalytics.outsideWindowOrUndated > 0 && (
              <span className="font-mono tabular-nums text-slate-500">
                +{completionAnalytics.outsideWindowOrUndated} completed prior to
                30d window
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Right: Pie Chart of Tasks by Task Status */}
      <section className="flex flex-col rounded-lg border border-slate-200 bg-white lg:col-span-5">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2 text-[#1A365D]">
            <PieChartIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <h2 className="text-base font-semibold">Tasks by Task Status</h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-600">
            Click any slice or status row to filter the Task Plan ledger.
          </p>
        </div>

        <div className="flex flex-1 flex-col justify-between px-6 py-4">
          <div className="relative h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusPieData}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={88}
                  paddingAngle={statusPieData.length > 1 ? 2 : 0}
                  stroke="#FFFFFF"
                  strokeWidth={2}
                  onClick={(_data, index) => {
                    const entry = statusPieData[index];
                    if (entry) {
                      onFilterByStatus(entry.value ? entry.value : 'ALL');
                    }
                  }}
                  className="cursor-pointer"
                >
                  {statusPieData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={
                    <StatusPieTooltip currencySymbol={currencySymbol} />
                  }
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Centered Donut Metric */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                {populatedTasks.length}
              </span>
              <span className="text-[11px] font-medium text-slate-500">
                {completionSharePct.toFixed(0)}% done
              </span>
            </div>
          </div>

          {/* Interactive Status Legend Breakdown */}
          <div className="mt-3 divide-y divide-slate-100 border-t border-slate-200">
            {statusPieData.map((item) => (
              <button
                key={item.name}
                type="button"
                onClick={() =>
                  onFilterByStatus(item.value ? item.value : 'ALL')
                }
                className="flex w-full cursor-pointer items-center justify-between gap-3 py-2 text-left text-xs transition-colors hover:bg-[#F5F9FD] px-2 -mx-2 rounded"
              >
                <span className="inline-flex items-center gap-2 min-w-0">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-xs ${item.bgClass}`}
                    aria-hidden="true"
                  />
                  <span className="font-medium text-slate-800 truncate">
                    {item.name}
                  </span>
                </span>
                <span className="flex items-center gap-3 shrink-0 font-mono tabular-nums">
                  <span className="font-semibold text-slate-900">
                    {item.count}
                  </span>
                  <span className="w-11 text-right text-[11px] text-slate-500">
                    {item.percentage.toFixed(1)}%
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
