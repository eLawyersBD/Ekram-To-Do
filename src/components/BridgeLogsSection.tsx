import React, { useMemo, useState } from 'react';
import {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type {
  BridgeApiLogEntry,
  BridgeLogAction,
} from '../services/driveBridge';
import type { ConfirmDialogRequest } from '../types/task';

interface BridgeLogsSectionProps {
  logs: BridgeApiLogEntry[];
  loading: boolean;
  checkingConnection: boolean;
  onRefreshLogs: () => Promise<void>;
  onCheckConnection: () => Promise<void>;
  onClearLogs: () => Promise<void>;
  onRequestConfirm: (req: ConfirmDialogRequest) => void;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
}

type OutcomeFilter = 'all' | 'success' | 'failed';
type ActionFilter = 'all' | BridgeLogAction;

const ACTION_LABELS: Record<BridgeLogAction, string> = {
  diagnose: 'Check Connection',
  verifySecret: 'Verify Secret',
  ping: 'Status Ping',
  syncMaster: 'Master Sync',
  createSnapshot: 'Snapshot Sheet',
};

function formatTimestampParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '—', time: '' };
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
  return `${Math.floor(diffHours / 24)}d ago`;
}

function formatRawPayload(raw: string | null): string {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export const BridgeLogsSection: React.FC<BridgeLogsSectionProps> = ({
  logs,
  loading,
  checkingConnection,
  onRefreshLogs,
  onCheckConnection,
  onClearLogs,
  onRequestConfirm,
  onNotify,
}) => {
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all');
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const stats = useMemo(() => {
    let success = 0;
    let failed = 0;
    let totalDuration = 0;
    for (const item of logs) {
      if (item.ok) success += 1;
      else failed += 1;
      totalDuration += item.durationMs || 0;
    }
    const avgMs = logs.length > 0 ? Math.round(totalDuration / logs.length) : 0;
    return { total: logs.length, success, failed, avgMs };
  }, [logs]);

  // Chronological recent sequence (up to 40 most recent responses, oldest -> newest left-to-right)
  const timelineEntries = useMemo(() => logs.slice(0, 40).reverse(), [logs]);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((entry) => {
      if (outcomeFilter === 'success' && !entry.ok) return false;
      if (outcomeFilter === 'failed' && entry.ok) return false;
      if (actionFilter !== 'all' && entry.action !== actionFilter) return false;
      if (!q) return true;
      const haystack = [
        ACTION_LABELS[entry.action] || entry.action,
        entry.endpoint,
        entry.summary,
        entry.rawError || '',
        entry.rawResponsePreview || '',
        entry.spreadsheetTitle || '',
        entry.httpStatus ? String(entry.httpStatus) : '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [logs, outcomeFilter, actionFilter, searchQuery]);

  const hasActiveFilters =
    outcomeFilter !== 'all' || actionFilter !== 'all' || searchQuery.trim() !== '';

  const resetFilters = () => {
    setOutcomeFilter('all');
    setActionFilter('all');
    setSearchQuery('');
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopyText = async (id: string, text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      onNotify(`Copied ${label} to clipboard.`);
      window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
    } catch {
      onNotify(`Could not copy ${label} to clipboard.`, 'error');
    }
  };

  const handleRequestClear = () => {
    onRequestConfirm({
      title: 'Clear Bridge API Logs?',
      description: `Remove all ${logs.length} recorded Google Apps Script bridge API responses from server memory?`,
      confirmLabel: 'Clear Bridge Logs',
      tone: 'danger',
      onConfirm: async () => {
        await onClearLogs();
        setExpandedIds(new Set());
      },
    });
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-xs">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[#1A365D]">
            <Activity className="h-4 w-4 shrink-0" aria-hidden="true" />
            <h2 className="text-lg font-bold tracking-tight">
              Google Apps Script Bridge Logs
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Live server-side record of recent Google Apps Script Web App
            responses, HTTP statuses, round-trip timings, and raw error payloads.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span className="font-mono font-semibold text-slate-900 tabular-nums">
              {stats.total}
            </span>
            <span>total requests</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono font-semibold text-emerald-700 tabular-nums">
              {stats.success} succeeded
            </span>
            <span aria-hidden="true">·</span>
            <span
              className={`font-mono font-semibold tabular-nums ${
                stats.failed > 0 ? 'text-red-700' : 'text-slate-600'
              }`}
            >
              {stats.failed} failed
            </span>
            {stats.total > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-700 tabular-nums">
                  {stats.avgMs}ms avg response
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onCheckConnection}
            disabled={checkingConnection}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[#1A365D] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#132948] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
          >
            {checkingConnection ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Activity className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {checkingConnection ? 'Checking...' : 'Check Connection'}
          </button>

          <button
            type="button"
            onClick={onRefreshLogs}
            disabled={loading}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Refresh
          </button>

          <button
            type="button"
            onClick={handleRequestClear}
            disabled={logs.length === 0}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Clear Logs
          </button>
        </div>
      </div>

      {/* Visual Response Outcome Strip (Recent Chronological Sequence) */}
      {timelineEntries.length > 0 && (
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-800">
              Recent Response Timeline (oldest → newest)
            </span>
            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-xs bg-emerald-600" />
                Success
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-xs bg-red-600" />
                Failure
              </span>
              <span className="font-mono tabular-nums">
                Last {timelineEntries.length}{' '}
                {timelineEntries.length === 1 ? 'call' : 'calls'}
              </span>
            </div>
          </div>

          <div
            className="mt-2.5 flex items-end gap-1 h-8"
            role="list"
            aria-label="Recent bridge API response outcomes"
          >
            {timelineEntries.map((entry) => {
              const ts = formatTimestampParts(entry.timestamp);
              const isSelected = expandedIds.has(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="listitem"
                  onClick={() => toggleExpand(entry.id)}
                  title={`${ts.date} ${ts.time} — ${
                    ACTION_LABELS[entry.action] || entry.action
                  } — ${entry.ok ? 'Success' : 'Failed'} (${entry.durationMs}ms)\n${
                    entry.rawError || entry.summary
                  }`}
                  className={`flex-1 max-w-4 min-w-1.5 cursor-pointer rounded-xs transition-opacity hover:opacity-80 ${
                    entry.ok ? 'bg-emerald-600 h-6' : 'bg-red-600 h-8'
                  } ${isSelected ? 'ring-2 ring-[#1A365D] ring-offset-1' : ''}`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-[#F9FBFD] px-6 py-3.5 xl:flex-row xl:items-center xl:justify-between">
        <div
          role="group"
          aria-label="Filter bridge responses by outcome"
          className="flex items-center gap-1 rounded-md bg-slate-100 p-1 w-fit"
        >
          {(
            [
              { value: 'all', label: 'All Responses', count: stats.total },
              { value: 'success', label: 'Succeeded', count: stats.success },
              { value: 'failed', label: 'Failed', count: stats.failed },
            ] as const
          ).map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setOutcomeFilter(tab.value)}
              className={`cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                outcomeFilter === tab.value
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

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search raw errors, payloads, status..."
              aria-label="Search bridge API logs"
              className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-7 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#1A365D] focus:outline-none focus:ring-1 focus:ring-[#1A365D]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear bridge logs search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <select
            aria-label="Filter by bridge action"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value as ActionFilter)}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-[#1A365D] focus:outline-none"
          >
            <option value="all">All Actions</option>
            <option value="verifySecret">Verify Secret</option>
            <option value="diagnose">Check Connection</option>
            <option value="ping">Status Ping</option>
            <option value="syncMaster">Master Sync</option>
            <option value="createSnapshot">Snapshot Sheet</option>
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

      {/* Responses Table */}
      {loading && logs.length === 0 ? (
        <div className="px-6 py-12 text-center text-xs text-slate-500">
          Loading recent Google Apps Script responses...
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-semibold text-slate-800">
            {logs.length === 0
              ? 'No Google Apps Script API responses recorded yet'
              : 'No bridge responses match your current filters'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {logs.length === 0
              ? 'Click Check Connection to send a live test ping to your Apps Script Web App and inspect the raw response here.'
              : 'Try resetting the outcome, action, or search filters.'}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            {logs.length === 0 ? (
              <button
                type="button"
                onClick={onCheckConnection}
                disabled={checkingConnection}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[#1A365D] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#132948] disabled:opacity-50"
              >
                <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                Run Check Connection
              </button>
            ) : (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Reset Filters
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-[#E6F0FA] text-left font-semibold text-slate-900">
                <th className="w-8 px-3 py-3" aria-label="Expand payload" />
                <th className="px-3 py-3 whitespace-nowrap">Timestamp</th>
                <th className="px-3 py-3 whitespace-nowrap">Action</th>
                <th className="px-3 py-3 text-right whitespace-nowrap">HTTP</th>
                <th className="px-3 py-3 text-right whitespace-nowrap">
                  Duration
                </th>
                <th className="px-3 py-3">Response / Raw Error</th>
                <th className="px-6 py-3 text-right whitespace-nowrap">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredLogs.map((entry) => {
                const ts = formatTimestampParts(entry.timestamp);
                const rel = formatRelativeTime(entry.timestamp);
                const isExpanded = expandedIds.has(entry.id);
                const formattedRaw = formatRawPayload(entry.rawResponsePreview);

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
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="font-semibold text-slate-900">
                          {ACTION_LABELS[entry.action] || entry.action}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {entry.endpoint}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[11.5px] tabular-nums whitespace-nowrap">
                        <span
                          className={
                            entry.httpStatus === null
                              ? 'text-slate-400'
                              : entry.httpStatus >= 200 && entry.httpStatus < 300
                                ? 'text-slate-800'
                                : 'font-semibold text-red-700'
                          }
                        >
                          {entry.httpStatus ?? 'N/A'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[11.5px] text-slate-600 tabular-nums whitespace-nowrap">
                        {entry.durationMs}ms
                      </td>
                      <td className="px-3 py-2.5 max-w-xl">
                        <p
                          className={`leading-relaxed ${
                            entry.ok
                              ? 'text-slate-800'
                              : 'font-medium text-red-800'
                          }`}
                        >
                          {entry.rawError || entry.summary}
                        </p>
                        {entry.spreadsheetTitle && (
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            Sheet: {entry.spreadsheetTitle}
                            {typeof entry.rowCount === 'number' && (
                              <span className="font-mono tabular-nums">
                                {' '}
                                · {entry.rowCount} rows
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-2.5 text-right whitespace-nowrap">
                        <span
                          className={
                            entry.ok
                              ? 'font-semibold text-emerald-700'
                              : 'font-semibold text-red-700'
                          }
                        >
                          {entry.ok ? 'Succeeded' : 'Failed'}
                        </span>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-[#F7FAFE]">
                        <td colSpan={7} className="px-11 py-4 space-y-3">
                          <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[11.5px] text-slate-600">
                            <span>
                              UTC:{' '}
                              <span className="font-mono text-slate-900 tabular-nums">
                                {entry.timestamp}
                              </span>
                            </span>
                            <span>
                              Folder ID:{' '}
                              <span className="font-mono text-slate-900">
                                {entry.folderId}
                              </span>
                            </span>
                            {entry.spreadsheetUrl && (
                              <a
                                href={entry.spreadsheetUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline"
                              >
                                Open Google Sheet
                                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                              </a>
                            )}
                          </div>

                          {entry.rawError && (
                            <div>
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="text-[11px] font-semibold text-red-800">
                                  Raw Error Message
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopyText(
                                      `${entry.id}-err`,
                                      entry.rawError || '',
                                      'raw error'
                                    );
                                  }}
                                  className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-[#1A365D] hover:underline"
                                >
                                  {copiedId === `${entry.id}-err` ? (
                                    <>
                                      <Check className="h-3 w-3 text-emerald-700" />
                                      Copied
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3 w-3" />
                                      Copy Error
                                    </>
                                  )}
                                </button>
                              </div>
                              <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50/70 p-3 font-mono text-[11.5px] leading-relaxed text-red-900 whitespace-pre-wrap break-words">
                                {entry.rawError}
                              </pre>
                            </div>
                          )}

                          {formattedRaw && (
                            <div>
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="text-[11px] font-semibold text-slate-700">
                                  Raw Apps Script Response Payload
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopyText(
                                      `${entry.id}-raw`,
                                      formattedRaw,
                                      'raw response'
                                    );
                                  }}
                                  className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-[#1A365D] hover:underline"
                                >
                                  {copiedId === `${entry.id}-raw` ? (
                                    <>
                                      <Check className="h-3 w-3 text-emerald-700" />
                                      Copied
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3 w-3" />
                                      Copy Payload
                                    </>
                                  )}
                                </button>
                              </div>
                              <pre className="ledger-scroll max-h-64 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3.5 font-mono text-[11.5px] leading-relaxed text-slate-100 whitespace-pre-wrap break-words">
                                {formattedRaw}
                              </pre>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
