import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  History,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  AUDIT_CATEGORY_LABELS,
  AUDIT_SEVERITY_LABELS,
  buildAuditLogCsv,
  type AuditCategory,
  type AuditLogEntry,
  type AuditSeverity,
} from '../types/audit';
import type { ConfirmDialogRequest } from '../types/task';
import { downloadCsvFile } from '../utils/csvExport';

interface AuditLogViewerSectionProps {
  logs: AuditLogEntry[];
  onClearLogs: () => void;
  onRequestConfirm: (req: ConfirmDialogRequest) => void;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
}

type CategoryFilter = 'all' | AuditCategory;
type SeverityFilter = 'all' | AuditSeverity;
type TimeRangeFilter = 'all' | '24h' | '7d' | '30d';

const PAGE_SIZE = 25;

function formatTimestampParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { date: '—', time: '' };
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}:${seconds}`,
  };
}

function formatRelativeTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

function getSeverityTextClass(severity: AuditSeverity): string {
  switch (severity) {
    case 'success':
      return 'text-emerald-700 font-semibold';
    case 'warning':
      return 'text-amber-700 font-semibold';
    case 'error':
      return 'text-red-700 font-semibold';
    default:
      return 'text-slate-600 font-medium';
  }
}

export const AuditLogViewerSection: React.FC<AuditLogViewerSectionProps> = ({
  logs,
  onClearLogs,
  onRequestConfirm,
  onNotify,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [actorFilter, setActorFilter] = useState<string>('ALL');
  const [timeRange, setTimeRange] = useState<TimeRangeFilter>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);

  // Distinct actors present in the audit log
  const actorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of logs) {
      if (!map.has(entry.actorUsername)) {
        map.set(entry.actorUsername, entry.actorName || entry.actorUsername);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [logs]);

  // Summary counts across the full log
  const counts = useMemo(() => {
    let bridge = 0;
    let task = 0;
    let user = 0;
    let archive = 0;
    let exportCount = 0;
    let errors = 0;

    for (const entry of logs) {
      if (entry.category === 'bridge') bridge += 1;
      else if (entry.category === 'task') task += 1;
      else if (entry.category === 'user') user += 1;
      else if (entry.category === 'archive') archive += 1;
      else if (entry.category === 'export') exportCount += 1;
      if (entry.severity === 'error') errors += 1;
    }

    return {
      total: logs.length,
      bridge,
      task,
      user,
      archive,
      export: exportCount,
      errors,
    };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const nowMs = Date.now();
    const cutoffMs =
      timeRange === '24h'
        ? nowMs - 24 * 60 * 60 * 1000
        : timeRange === '7d'
          ? nowMs - 7 * 24 * 60 * 60 * 1000
          : timeRange === '30d'
            ? nowMs - 30 * 24 * 60 * 60 * 1000
            : 0;

    return logs.filter((entry) => {
      if (categoryFilter !== 'all' && entry.category !== categoryFilter) {
        return false;
      }
      if (severityFilter !== 'all' && entry.severity !== severityFilter) {
        return false;
      }
      if (actorFilter !== 'ALL' && entry.actorUsername !== actorFilter) {
        return false;
      }
      if (cutoffMs > 0) {
        const ts = Date.parse(entry.timestamp);
        if (!Number.isFinite(ts) || ts < cutoffMs) return false;
      }
      if (!q) return true;
      const metaText = entry.metadata
        ? Object.entries(entry.metadata)
            .map(([k, v]) => `${k} ${v}`)
            .join(' ')
        : '';
      const haystack = [
        entry.action,
        entry.details,
        entry.target || '',
        entry.actorUsername,
        entry.actorName,
        AUDIT_CATEGORY_LABELS[entry.category] || entry.category,
        AUDIT_SEVERITY_LABELS[entry.severity] || entry.severity,
        metaText,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [logs, searchQuery, categoryFilter, severityFilter, actorFilter, timeRange]);

  const displayedLogs = useMemo(
    () => filteredLogs.slice(0, visibleCount),
    [filteredLogs, visibleCount]
  );

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    categoryFilter !== 'all' ||
    severityFilter !== 'all' ||
    actorFilter !== 'ALL' ||
    timeRange !== 'all';

  const resetFilters = () => {
    setSearchQuery('');
    setCategoryFilter('all');
    setSeverityFilter('all');
    setActorFilter('ALL');
    setTimeRange('all');
    setVisibleCount(PAGE_SIZE);
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExportCsv = () => {
    if (filteredLogs.length === 0) {
      onNotify('No audit log entries match the current filters to export.', 'error');
      return;
    }
    const csv = buildAuditLogCsv(filteredLogs);
    const dateStamp = new Date().toISOString().slice(0, 10);
    downloadCsvFile(csv, `Task_Plan_Audit_Log_${dateStamp}.csv`);
    onNotify(
      `Exported ${filteredLogs.length} audit ${
        filteredLogs.length === 1 ? 'entry' : 'entries'
      } to CSV.`
    );
  };

  const handleRequestClear = () => {
    onRequestConfirm({
      title: 'Clear Audit Log History?',
      description: `Remove all ${logs.length} stored audit log entries from this workspace? A single record of this reset will be logged for traceability.`,
      confirmLabel: 'Clear Audit Log',
      tone: 'danger',
      onConfirm: () => {
        onClearLogs();
        setExpandedIds(new Set());
        setVisibleCount(PAGE_SIZE);
      },
    });
  };

  const categoryTabs: Array<{
    value: CategoryFilter;
    label: string;
    count: number;
  }> = [
    { value: 'all', label: 'All Events', count: counts.total },
    { value: 'bridge', label: 'Bridge Sync', count: counts.bridge },
    { value: 'task', label: 'Tasks', count: counts.task },
    { value: 'user', label: 'Users', count: counts.user },
    { value: 'archive', label: 'Archive', count: counts.archive },
    { value: 'export', label: 'Exports', count: counts.export },
  ];

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-xs">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[#1A365D]">
            <History className="h-4 w-4 shrink-0" aria-hidden="true" />
            <h2 className="text-lg font-bold tracking-tight">
              Global Audit Log
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Chronological admin trail of automatic Drive bridge syncs, task
            ledger edits, archive sweeps, exports, and user account activity.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span className="font-mono font-semibold text-slate-800 tabular-nums">
              {counts.total}
            </span>
            <span>total recorded events</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-slate-700 tabular-nums">
              {counts.bridge}
            </span>
            <span>bridge syncs</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-slate-700 tabular-nums">
              {counts.task}
            </span>
            <span>task updates</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-slate-700 tabular-nums">
              {counts.user}
            </span>
            <span>user events</span>
            {counts.errors > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono font-semibold text-red-700 tabular-nums">
                  {counts.errors} {counts.errors === 1 ? 'failure' : 'failures'}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredLogs.length === 0}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export Log CSV
          </button>
          <button
            type="button"
            onClick={handleRequestClear}
            disabled={logs.length === 0}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Clear Log
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="space-y-3 border-b border-slate-200 bg-[#F9FBFD] px-6 py-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          {/* Segmented Category Filter */}
          <div
            role="group"
            aria-label="Filter audit events by category"
            className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1"
          >
            {categoryTabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => {
                  setCategoryFilter(tab.value);
                  setVisibleCount(PAGE_SIZE);
                }}
                className={`cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  categoryFilter === tab.value
                    ? 'bg-white text-[#1A365D] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
                <span className="ml-1.5 font-mono text-[11px] text-slate-400 tabular-nums">
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Search & Secondary Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-56">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setVisibleCount(PAGE_SIZE);
                }}
                placeholder="Search action, target, details..."
                aria-label="Search audit log"
                className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-7 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#1A365D] focus:outline-none focus:ring-1 focus:ring-[#1A365D]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear audit search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <select
              aria-label="Filter by actor"
              value={actorFilter}
              onChange={(e) => {
                setActorFilter(e.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-[#1A365D] focus:outline-none"
            >
              <option value="ALL">All Actors</option>
              {actorOptions.map(([username, name]) => (
                <option key={username} value={username}>
                  {username === 'system'
                    ? 'System (Automated)'
                    : `${username}${name && name !== username ? ` — ${name}` : ''}`}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by outcome"
              value={severityFilter}
              onChange={(e) => {
                setSeverityFilter(e.target.value as SeverityFilter);
                setVisibleCount(PAGE_SIZE);
              }}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-[#1A365D] focus:outline-none"
            >
              <option value="all">All Outcomes</option>
              <option value="success">Success</option>
              <option value="info">Recorded</option>
              <option value="warning">Warning</option>
              <option value="error">Failed</option>
            </select>

            <select
              aria-label="Filter by time window"
              value={timeRange}
              onChange={(e) => {
                setTimeRange(e.target.value as TimeRangeFilter);
                setVisibleCount(PAGE_SIZE);
              }}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-[#1A365D] focus:outline-none"
            >
              <option value="all">All Time</option>
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-[#1A365D] hover:underline whitespace-nowrap"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      {filteredLogs.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-semibold text-slate-800">
            {logs.length === 0
              ? 'No audit events recorded yet'
              : 'No audit events match your current filters'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {logs.length === 0
              ? 'Task edits, automatic Drive bridge syncs, exports, and user sign-ins will appear here automatically with timestamps.'
              : 'Try broadening your search query, time window, or category filter.'}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-[#E6F0FA] text-left font-semibold text-slate-900">
                  <th className="w-8 px-3 py-3" aria-label="Expand details" />
                  <th className="px-3 py-3 whitespace-nowrap">Timestamp</th>
                  <th className="px-3 py-3 whitespace-nowrap">Category</th>
                  <th className="px-3 py-3 whitespace-nowrap">Actor</th>
                  <th className="px-3 py-3">Event & Details</th>
                  <th className="px-6 py-3 text-right whitespace-nowrap">
                    Outcome
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {displayedLogs.map((entry) => {
                  const ts = formatTimestampParts(entry.timestamp);
                  const rel = formatRelativeTime(entry.timestamp);
                  const isExpanded = expandedIds.has(entry.id);
                  const hasMeta =
                    Boolean(entry.metadata) &&
                    Object.keys(entry.metadata || {}).length > 0;

                  return (
                    <React.Fragment key={entry.id}>
                      <tr
                        onClick={() => toggleExpand(entry.id)}
                        className="cursor-pointer transition-colors hover:bg-[#F5F9FD]"
                      >
                        <td className="px-3 py-2.5 text-slate-400">
                          {isExpanded ? (
                            <ChevronDown
                              className="h-3.5 w-3.5 text-[#1A365D]"
                              aria-hidden="true"
                            />
                          ) : (
                            <ChevronRight
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="font-mono text-[11.5px] font-medium text-slate-900 tabular-nums">
                            {ts.date}{' '}
                            <span className="text-slate-500">{ts.time}</span>
                          </div>
                          {rel && (
                            <div className="text-[11px] text-slate-400 tabular-nums">
                              {rel}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap font-medium text-slate-700">
                          {AUDIT_CATEGORY_LABELS[entry.category] || entry.category}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="font-mono text-[11.5px] font-semibold text-slate-900">
                            {entry.actorUsername}
                          </div>
                          {entry.actorName &&
                            entry.actorName !== entry.actorUsername && (
                              <div className="text-[11px] text-slate-500">
                                {entry.actorName}
                              </div>
                            )}
                        </td>
                        <td className="px-3 py-2.5 max-w-xl">
                          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                            <span className="font-semibold text-slate-900">
                              {entry.action}
                            </span>
                            {entry.target && (
                              <>
                                <span
                                  className="text-slate-300"
                                  aria-hidden="true"
                                >
                                  ·
                                </span>
                                <span className="font-mono text-[11.5px] text-[#1A365D]">
                                  {entry.target}
                                </span>
                              </>
                            )}
                          </div>
                          <p className="mt-0.5 text-slate-600 leading-relaxed">
                            {entry.details}
                          </p>
                        </td>
                        <td className="px-6 py-2.5 text-right whitespace-nowrap">
                          <span className={getSeverityTextClass(entry.severity)}>
                            {AUDIT_SEVERITY_LABELS[entry.severity]}
                          </span>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-[#F7FAFE]">
                          <td colSpan={6} className="px-11 py-3">
                            <div className="grid grid-cols-1 gap-x-8 gap-y-2 text-[11.5px] sm:grid-cols-2 lg:grid-cols-4">
                              <div>
                                <span className="block text-slate-500">
                                  Exact Timestamp (UTC ISO)
                                </span>
                                <span className="font-mono text-slate-800 tabular-nums">
                                  {entry.timestamp}
                                </span>
                              </div>
                              <div>
                                <span className="block text-slate-500">
                                  Actor Role
                                </span>
                                <span className="font-medium text-slate-800 capitalize">
                                  {entry.actorRole || 'system'}
                                </span>
                              </div>
                              {entry.target && (
                                <div>
                                  <span className="block text-slate-500">
                                    Target Resource
                                  </span>
                                  <span className="font-mono text-slate-800 break-all">
                                    {entry.target}
                                  </span>
                                </div>
                              )}
                              {hasMeta &&
                                Object.entries(entry.metadata || {}).map(
                                  ([key, val]) => (
                                    <div key={key}>
                                      <span className="block text-slate-500">
                                        {key}
                                      </span>
                                      <span className="font-mono text-slate-800 break-all tabular-nums">
                                        {String(val)}
                                      </span>
                                    </div>
                                  )
                                )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-3 text-xs text-slate-500">
            <span className="font-mono tabular-nums">
              Showing {displayedLogs.length} of {filteredLogs.length}{' '}
              {filteredLogs.length === 1 ? 'event' : 'events'}
            </span>
            {displayedLogs.length < filteredLogs.length && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                  className="cursor-pointer font-medium text-[#1A365D] hover:underline"
                >
                  Load {Math.min(PAGE_SIZE, filteredLogs.length - displayedLogs.length)} more
                </button>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => setVisibleCount(filteredLogs.length)}
                  className="cursor-pointer font-medium text-slate-600 hover:text-slate-900 hover:underline"
                >
                  Show all ({filteredLogs.length})
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
};
