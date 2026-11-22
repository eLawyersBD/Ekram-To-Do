import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  CheckSquare,
  Clock,
  ExternalLink,
  FileSpreadsheet,
  Folder,
  FolderPlus,
  Link2,
  Loader2,
  Maximize2,
  RefreshCw,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import {
  TASK_STATUS_OPTIONS,
  formatAmount,
  getDaysOverdue,
  getDueDateState,
  isRowPopulated,
  parseCurrencyValue,
  type TaskRow,
  type TaskStatus,
} from '../types/task';
import { DEFAULT_TARGET_DRIVE_FOLDER_URL } from '../services/googleSheets';
import type {
  BridgeConfig,
  BridgeStatusResponse,
  BridgeSyncState,
} from '../services/driveBridge';
import type { AppUser } from '../types/auth';

type SortField = 'taskStatus' | 'dueDate' | 'taskPrice';
type SortDirection = 'asc' | 'desc';

interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

const STATUS_SORT_ORDER: Record<Exclude<TaskStatus, ''>, number> = {
  'Not Started': 1,
  'In Progress': 2,
  'Under Review': 3,
  'On Hold': 4,
  Completed: 5,
};

const SORT_FIELD_LABELS: Record<SortField, string> = {
  taskStatus: 'Task Status',
  dueDate: 'Due Date',
  taskPrice: 'Task Price',
};

interface TaskLedgerTableProps {
  rows: Array<{ task: TaskRow; slNo: number }>;
  currencySymbol: string;
  users: AppUser[];
  isAdmin: boolean;
  isSignedIn: boolean;
  isExportingSheet: boolean;
  lastSavedSheet: { title: string; url: string } | null;
  bridgeStatus: BridgeStatusResponse | null;
  bridgeConfig: BridgeConfig;
  bridgeSyncState: BridgeSyncState;
  bridgeLastSyncedAt: string | null;
  bridgeLastError: string | null;
  hasPendingMasterChanges?: boolean;
  onSyncMasterNow: () => Promise<boolean | void>;
  onOpenBridgeSettings: () => void;
  onUpdateField: <K extends keyof TaskRow>(
    taskId: string,
    field: K,
    value: TaskRow[K]
  ) => void;
  onBulkUpdateStatus: (taskIds: string[], status: TaskStatus) => void;
  onSaveToGoogleSheet: (
    targetTasks: TaskRow[],
    sheetTitle: string,
    isSelectionOnly: boolean
  ) => void;
  onOpenDrivePicker: (task: TaskRow, slNo: number) => void;
  onOpenDetailDrawer: (task: TaskRow, slNo: number) => void;
  onDeleteRow: (task: TaskRow, slNo: number) => void;
  onAddRow: () => void;
}

function formatShortTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getStatusTextClass(status: TaskStatus): string {
  switch (status) {
    case 'Completed':
      return 'bg-emerald-50/75 text-emerald-800 font-semibold';
    case 'In Progress':
      return 'bg-blue-50/75 text-[#1A365D] font-semibold';
    case 'Under Review':
      return 'bg-amber-50/80 text-amber-800 font-semibold';
    case 'On Hold':
      return 'bg-rose-50/80 text-rose-800 font-semibold';
    case 'Not Started':
      return 'bg-slate-100/70 text-slate-700 font-medium';
    default:
      return 'text-slate-400';
  }
}

export const TaskLedgerTable: React.FC<TaskLedgerTableProps> = ({
  rows,
  currencySymbol,
  users,
  isAdmin,
  isSignedIn,
  isExportingSheet,
  lastSavedSheet,
  bridgeStatus,
  bridgeConfig,
  bridgeSyncState,
  bridgeLastSyncedAt,
  bridgeLastError,
  hasPendingMasterChanges = false,
  onSyncMasterNow,
  onOpenBridgeSettings,
  onUpdateField,
  onBulkUpdateStatus,
  onSaveToGoogleSheet,
  onOpenDrivePicker,
  onOpenDetailDrawer,
  onDeleteRow,
  onAddRow,
}) => {
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkStatus, setBulkStatus] = useState<TaskStatus | '__UNSET__'>('__UNSET__');
  const [sheetTitleInput, setSheetTitleInput] = useState<string>(
    () => `Task Plan and Status - ${new Date().toISOString().slice(0, 10)}`
  );
  const [manualSyncFeedback, setManualSyncFeedback] = useState<
    'idle' | 'just-synced' | 'error'
  >('idle');
  const manualFeedbackTimerRef = useRef<number | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (manualFeedbackTimerRef.current !== null) {
        window.clearTimeout(manualFeedbackTimerRef.current);
      }
    };
  }, []);

  const handleManualSyncToMaster = async () => {
    if (bridgeSyncState === 'syncing') return;
    if (manualFeedbackTimerRef.current !== null) {
      window.clearTimeout(manualFeedbackTimerRef.current);
      manualFeedbackTimerRef.current = null;
    }
    setManualSyncFeedback('idle');
    const result = await onSyncMasterNow();
    if (result === true) {
      setManualSyncFeedback('just-synced');
      manualFeedbackTimerRef.current = window.setTimeout(() => {
        setManualSyncFeedback('idle');
        manualFeedbackTimerRef.current = null;
      }, 4000);
    } else if (result === false) {
      setManualSyncFeedback('error');
    }
  };

  const handleToggleSort = (field: SortField) => {
    setSortConfig((prev) => {
      if (!prev || prev.field !== field) {
        return { field, direction: 'asc' };
      }
      if (prev.direction === 'asc') {
        return { field, direction: 'desc' };
      }
      return null;
    });
  };

  const sortedRows = useMemo(() => {
    if (!sortConfig) return rows;

    const { field, direction } = sortConfig;
    const multiplier = direction === 'asc' ? 1 : -1;

    return [...rows].sort((a, b) => {
      if (field === 'dueDate') {
        const aDate = (a.task.dueDate || '').trim();
        const bDate = (b.task.dueDate || '').trim();
        if (!aDate && !bDate) return a.slNo - b.slNo;
        if (!aDate) return 1;
        if (!bDate) return -1;
        const cmp = aDate.localeCompare(bDate);
        return cmp !== 0 ? cmp * multiplier : a.slNo - b.slNo;
      }

      if (field === 'taskPrice') {
        const aRaw = a.task.taskPrice.trim();
        const bRaw = b.task.taskPrice.trim();
        if (!aRaw && !bRaw) return a.slNo - b.slNo;
        if (!aRaw) return 1;
        if (!bRaw) return -1;
        const diff =
          parseCurrencyValue(aRaw) - parseCurrencyValue(bRaw);
        return diff !== 0 ? diff * multiplier : a.slNo - b.slNo;
      }

      // field === 'taskStatus'
      const aStatus = a.task.taskStatus;
      const bStatus = b.task.taskStatus;
      if (!aStatus && !bStatus) return a.slNo - b.slNo;
      if (!aStatus) return 1;
      if (!bStatus) return -1;
      const diff = STATUS_SORT_ORDER[aStatus] - STATUS_SORT_ORDER[bStatus];
      return diff !== 0 ? diff * multiplier : a.slNo - b.slNo;
    });
  }, [rows, sortConfig]);

  const getAriaSort = (
    field: SortField
  ): 'ascending' | 'descending' | 'none' => {
    if (!sortConfig || sortConfig.field !== field) return 'none';
    return sortConfig.direction === 'asc' ? 'ascending' : 'descending';
  };

  const renderSortIcon = (field: SortField) => {
    if (!sortConfig || sortConfig.field !== field) {
      return (
        <ArrowUpDown
          className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-colors group-hover/sort:text-[#1A365D]"
          aria-hidden="true"
        />
      );
    }
    return sortConfig.direction === 'asc' ? (
      <ArrowUp
        className="h-3.5 w-3.5 shrink-0 text-[#1A365D]"
        aria-hidden="true"
      />
    ) : (
      <ArrowDown
        className="h-3.5 w-3.5 shrink-0 text-[#1A365D]"
        aria-hidden="true"
      />
    );
  };

  const visibleTaskIds = useMemo(() => rows.map((r) => r.task.id), [rows]);

  const selectedVisibleIds = useMemo(
    () => visibleTaskIds.filter((id) => selectedIds.has(id)),
    [visibleTaskIds, selectedIds]
  );

  const selectedCount = selectedVisibleIds.length;
  const allVisibleSelected =
    visibleTaskIds.length > 0 && selectedCount === visibleTaskIds.length;
  const someVisibleSelected =
    selectedCount > 0 && selectedCount < visibleTaskIds.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  // Prune any selected IDs that are no longer in the visible row set
  useEffect(() => {
    const visibleSet = new Set(visibleTaskIds);
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visibleSet.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [visibleTaskIds]);

  const handleToggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleTaskIds));
    }
  };

  const handleToggleSelectRow = (taskId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
    setBulkStatus('__UNSET__');
  };

  const handleApplyBulkStatus = () => {
    if (selectedVisibleIds.length === 0 || bulkStatus === '__UNSET__') return;
    onBulkUpdateStatus(selectedVisibleIds, bulkStatus);
    setSelectedIds(new Set());
    setBulkStatus('__UNSET__');
  };

  const handleTriggerSheetExport = () => {
    if (selectedCount > 0) {
      const selectedTasks = sortedRows
        .filter((item) => selectedIds.has(item.task.id))
        .map((item) => item.task);
      onSaveToGoogleSheet(selectedTasks, sheetTitleInput, true);
      return;
    }

    const visibleTasks = sortedRows.map((item) => item.task);
    const populatedVisible = visibleTasks.filter(isRowPopulated);
    const tasksToExport =
      populatedVisible.length > 0 ? populatedVisible : visibleTasks;
    onSaveToGoogleSheet(tasksToExport, sheetTitleInput, false);
  };

  const activeUsers = users.filter((u) => u.isActive);
  const totalVisiblePrice = rows.reduce(
    (sum, item) => sum + parseCurrencyValue(item.task.taskPrice),
    0
  );
  const totalVisiblePaid = rows.reduce(
    (sum, item) => sum + parseCurrencyValue(item.task.paidReceiveAmount),
    0
  );
  const totalVisibleDue = Math.max(0, totalVisiblePrice - totalVisiblePaid);

  const bridgeConnected = Boolean(bridgeStatus?.connected);
  const bridgeConfigured = Boolean(bridgeStatus?.configured);
  const targetFolderUrl =
    bridgeStatus?.folderUrl || DEFAULT_TARGET_DRIVE_FOLDER_URL;
  const formattedSyncTime = formatShortTime(bridgeLastSyncedAt);
  const isSyncingMaster = bridgeSyncState === 'syncing';
  const masterSyncHasError =
    bridgeSyncState === 'error' || manualSyncFeedback === 'error';

  return (
    <div className="space-y-3">
      {/* Direct Google Drive Folder Auto-Sync & Snapshot Toolbar (Admin Only) */}
      {isAdmin && (
      <div className="flex flex-col gap-2.5 rounded-xl border border-[#8FA6C1]/70 bg-gradient-to-r from-[#F4F8FD] via-white to-[#F2FAF6] px-4 py-2.5 text-xs shadow-2xs xl:flex-row xl:items-center xl:justify-between">
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-slate-600 min-w-0"
        >
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#1A365D] whitespace-nowrap">
            <FileSpreadsheet
              className="h-4 w-4 shrink-0 text-emerald-700"
              aria-hidden="true"
            />
            Drive Folder Sync
          </span>

          <a
            href={targetFolderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-[#1A365D] hover:underline whitespace-nowrap"
          >
            <Folder
              className="h-3.5 w-3.5 shrink-0 text-[#1A365D]"
              aria-hidden="true"
            />
            <span>{bridgeStatus?.folderName || 'Target Drive Folder'}</span>
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
          </a>

          <span className="text-slate-300" aria-hidden="true">
            ·
          </span>

          {isSyncingMaster ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#1A365D] whitespace-nowrap">
              <Loader2
                className="h-3.5 w-3.5 animate-spin shrink-0"
                aria-hidden="true"
              />
              Syncing to Master Sheet...
            </span>
          ) : masterSyncHasError ? (
            <span
              title={bridgeLastError || 'Master Sheet sync failed'}
              className="inline-flex items-center gap-1.5 font-medium text-red-700"
            >
              <AlertCircle
                className="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              <span className="max-w-[260px] truncate sm:max-w-[340px]">
                {bridgeLastError || 'Master Sheet sync failed'}
              </span>
              {isAdmin && (
                <button
                  type="button"
                  onClick={onOpenBridgeSettings}
                  className="cursor-pointer font-semibold text-[#1A365D] hover:underline whitespace-nowrap"
                >
                  Settings
                </button>
              )}
            </span>
          ) : manualSyncFeedback === 'just-synced' ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 whitespace-nowrap">
              <CheckCircle2
                className="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              <span>Master Sheet synced</span>
              {formattedSyncTime && (
                <span className="font-mono text-[11px] font-medium text-emerald-800/80 tabular-nums">
                  ({formattedSyncTime})
                </span>
              )}
            </span>
          ) : bridgeConnected ? (
            hasPendingMasterChanges ? (
              <span
                title="Local edits are waiting for the background debounce timer. Click Sync to Master Sheet to save immediately."
                className="inline-flex items-center gap-1.5 font-medium text-amber-700 whitespace-nowrap"
              >
                <Clock
                  className="h-3.5 w-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span>Unsynced changes pending</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-slate-600 whitespace-nowrap">
                <CheckCircle2
                  className="h-3.5 w-3.5 shrink-0 text-emerald-700"
                  aria-hidden="true"
                />
                <span className="font-medium text-emerald-700">
                  {bridgeConfig.autoSyncEnabled
                    ? 'Auto-Sync Active'
                    : 'Auto-Sync Paused'}
                </span>
                {formattedSyncTime && (
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                    ({formattedSyncTime})
                  </span>
                )}
              </span>
            )
          ) : (
            <span className="inline-flex items-center gap-1.5 text-slate-500">
              <span>
                {bridgeConfigured
                  ? 'Bridge configured (not verified)'
                  : 'Bridge not configured'}
              </span>
              {isAdmin && (
                <>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={onOpenBridgeSettings}
                    className="inline-flex cursor-pointer items-center gap-1 font-semibold text-[#1A365D] hover:underline whitespace-nowrap"
                  >
                    <Settings className="h-3 w-3 shrink-0" aria-hidden="true" />
                    Setup in Settings
                  </button>
                </>
              )}
            </span>
          )}

          {bridgeConfig.masterSheetUrl && (
            <>
              <span className="text-slate-300" aria-hidden="true">
                ·
              </span>
              <a
                href={bridgeConfig.masterSheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-[#1A365D] hover:underline whitespace-nowrap"
              >
                <span>Open Master Sheet</span>
                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
              </a>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Dedicated Manual Sync to Master Sheet Button */}
          <button
            type="button"
            onClick={handleManualSyncToMaster}
            disabled={isSyncingMaster}
            title={
              bridgeConfigured
                ? `Immediately sync active tasks to "${bridgeConfig.masterSheetTitle}" without waiting for the background debounce`
                : 'Configure the Apps Script bridge in Settings to enable Master Sheet sync'
            }
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap ${
              isSyncingMaster
                ? 'bg-[#1A365D] text-white'
                : manualSyncFeedback === 'just-synced'
                  ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                  : masterSyncHasError
                    ? 'border border-red-300 bg-red-50 text-red-800 hover:bg-red-100'
                    : 'bg-[#1A365D] text-white hover:bg-[#132948]'
            }`}
          >
            {isSyncingMaster ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
                Syncing Master Sheet...
              </>
            ) : manualSyncFeedback === 'just-synced' ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Synced to Master Sheet
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {masterSyncHasError
                  ? 'Retry Master Sheet Sync'
                  : 'Sync to Master Sheet'}
              </>
            )}
          </button>
        </div>
      </div>
      )}

      {/* Bulk-Action Toolbar — shown whenever 1+ rows are selected */}
      {selectedCount > 0 && (
        <div
          role="region"
          aria-label="Bulk task actions"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#8FA6C1] bg-[#E6F0FA] px-3.5 py-2 text-xs text-slate-900"
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#1A365D]">
              <CheckSquare className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="font-mono tabular-nums">{selectedCount}</span>{' '}
              {selectedCount === 1 ? 'row' : 'rows'} selected
            </span>
            {someVisibleSelected && (
              <>
                <span className="text-slate-400" aria-hidden="true">
                  ·
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set(visibleTaskIds))}
                  className="cursor-pointer font-medium text-[#1A365D] hover:underline"
                >
                  Select all {visibleTaskIds.length} visible
                </button>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="bulk-task-status-select"
              className="font-medium text-slate-700"
            >
              Update Task Status:
            </label>
            <select
              id="bulk-task-status-select"
              value={bulkStatus}
              onChange={(e) =>
                setBulkStatus(e.target.value as TaskStatus | '__UNSET__')
              }
              className="rounded-md border border-[#8FA6C1] bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:border-[#1A365D] focus:outline-none focus:ring-1 focus:ring-[#1A365D]"
            >
              <option value="__UNSET__">Choose new status...</option>
              {TASK_STATUS_OPTIONS.map((opt) => (
                <option key={opt || 'blank'} value={opt}>
                  {opt || '— (Clear Status)'}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleApplyBulkStatus}
              disabled={bulkStatus === '__UNSET__'}
              className="cursor-pointer rounded-md bg-[#1A365D] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#132948] disabled:cursor-not-allowed disabled:opacity-45"
            >
              Apply to {selectedCount} {selectedCount === 1 ? 'Row' : 'Rows'}
            </button>
            <button
              type="button"
              onClick={handleClearSelection}
              aria-label="Clear selected rows"
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="ledger-scroll overflow-x-auto border border-[#8FA6C1] rounded-xl bg-white shadow-2xs">
        <table className="w-full min-w-[1580px] border-collapse text-[13.5px]">
          <thead>
            <tr className="bg-gradient-to-b from-[#EDF4FC] to-[#E1ECF8] text-left text-[#0F2547]">
              <th className="w-[40px] border-b border-r border-[#8FA6C1] px-2 py-2.5 text-center">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={visibleTaskIds.length === 0}
                  onChange={handleToggleSelectAll}
                  aria-label="Select all visible rows"
                  className="h-3.5 w-3.5 cursor-pointer rounded border-slate-400 accent-[#1A365D] align-middle disabled:cursor-not-allowed disabled:opacity-40"
                />
              </th>
              <th className="w-[62px] border-b border-r border-[#8FA6C1] px-2.5 py-2.5 text-center text-xs font-bold whitespace-nowrap">
                SL NO
              </th>
            <th className="w-[130px] border-b border-r border-[#8FA6C1] px-3 py-2.5 text-xs font-bold whitespace-nowrap">
              EL Invoice ID
            </th>
            <th className="w-[155px] border-b border-r border-[#8FA6C1] px-3 py-2.5 text-xs font-bold whitespace-nowrap">
              Client Name
            </th>
            <th className="w-[165px] border-b border-r border-[#8FA6C1] px-3 py-2.5 text-xs font-bold whitespace-nowrap">
              Company Name
            </th>
            <th className="w-[210px] border-b border-r border-[#8FA6C1] px-3 py-2.5 text-xs font-bold whitespace-nowrap">
              Task Name
            </th>
            <th className="w-[130px] border-b border-r border-[#8FA6C1] px-3 py-2.5 text-xs font-bold whitespace-nowrap">
              Task By
            </th>
            <th
              aria-sort={getAriaSort('taskStatus')}
              className={`w-[135px] border-b border-r border-[#8FA6C1] p-0 text-xs font-bold whitespace-nowrap transition-colors ${
                sortConfig?.field === 'taskStatus'
                  ? 'bg-[#D7E6F7] text-[#1A365D]'
                  : 'hover:bg-[#DCEAF8]'
              }`}
            >
              <button
                type="button"
                onClick={() => handleToggleSort('taskStatus')}
                title="Click to sort by Task Status"
                className="group/sort flex w-full cursor-pointer items-center justify-between gap-1.5 px-3 py-2.5 text-left font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1A365D]"
              >
                <span>Task Status</span>
                {renderSortIcon('taskStatus')}
              </button>
            </th>
            <th
              aria-sort={getAriaSort('dueDate')}
              className={`w-[175px] border-b border-r border-[#8FA6C1] p-0 text-xs font-bold whitespace-nowrap transition-colors ${
                sortConfig?.field === 'dueDate'
                  ? 'bg-[#D7E6F7] text-[#1A365D]'
                  : 'hover:bg-[#DCEAF8]'
              }`}
            >
              <button
                type="button"
                onClick={() => handleToggleSort('dueDate')}
                title="Click to sort by Due Date"
                className="group/sort flex w-full cursor-pointer items-center justify-between gap-1.5 px-3 py-2.5 text-left font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1A365D]"
              >
                <span>Due Date</span>
                {renderSortIcon('dueDate')}
              </button>
            </th>
            <th
              aria-sort={getAriaSort('taskPrice')}
              className={`w-[125px] border-b border-r border-[#8FA6C1] p-0 text-right text-xs font-bold whitespace-nowrap transition-colors ${
                sortConfig?.field === 'taskPrice'
                  ? 'bg-[#D7E6F7] text-[#1A365D]'
                  : 'hover:bg-[#DCEAF8]'
              }`}
            >
              <button
                type="button"
                onClick={() => handleToggleSort('taskPrice')}
                title="Click to sort by Task Price"
                className="group/sort flex w-full cursor-pointer items-center justify-end gap-1.5 px-3 py-2.5 text-right font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1A365D]"
              >
                {renderSortIcon('taskPrice')}
                <span>Task Price</span>
              </button>
            </th>
            <th className="w-[145px] border-b border-r border-[#8FA6C1] px-3 py-2.5 text-right text-xs font-bold whitespace-nowrap">
              Paid/Receive Amount
            </th>
            <th className="w-[180px] border-b border-r border-[#8FA6C1] px-3 py-2.5 text-xs font-bold whitespace-nowrap">
              Note for Paid/Receive
            </th>
            <th className="w-[190px] border-b border-r border-[#8FA6C1] px-3 py-2.5 text-xs font-bold whitespace-nowrap">
              Drive Link
            </th>
            <th className="w-[215px] border-b border-[#8FA6C1] px-3 py-2.5 text-xs font-bold whitespace-nowrap">
              Action to Do
            </th>
          </tr>
        </thead>

        <tbody>
          {sortedRows.length === 0 ? (
            <tr>
              <td
                colSpan={14}
                className="px-6 py-12 text-center text-sm text-slate-600"
              >
                No rows match the current filter.{' '}
                <button
                  type="button"
                  onClick={onAddRow}
                  className="font-semibold text-[#1A365D] hover:underline"
                >
                  Add a new row
                </button>
              </td>
            </tr>
          ) : (
            sortedRows.map(({ task, slNo }) => {
              const isSelected = selectedIds.has(task.id);
              return (
                <tr
                  key={task.id}
                  className={`group transition-colors ${
                    isSelected
                      ? 'bg-[#EFF6FF]/90 hover:bg-[#E6F0FA]/80'
                      : 'bg-white even:bg-slate-50/40 hover:bg-[#F2F7FE]'
                  }`}
                >
                  {/* 0. Row Selection Checkbox */}
                  <td className="border-b border-r border-[#8FA6C1]/70 px-2 py-0 text-center">
                    <div className="flex h-[38px] items-center justify-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelectRow(task.id)}
                        aria-label={`Select row ${slNo}`}
                        className="h-3.5 w-3.5 cursor-pointer rounded border-slate-400 accent-[#1A365D]"
                      />
                    </div>
                  </td>

                  {/* 1. SL NO */}
                  <td className="border-b border-r border-[#8FA6C1]/70 px-1.5 py-0 text-center font-mono text-xs font-medium text-slate-600 tabular-nums">
                    <div className="flex h-[38px] items-center justify-center gap-1">
                      <span>{String(slNo).padStart(2, '0')}</span>
                      <button
                        type="button"
                        onClick={() => onOpenDetailDrawer(task, slNo)}
                        title="Open row details and Drive folder contents"
                        aria-label={`Open details for row ${slNo}`}
                        className="rounded p-0.5 text-slate-400 opacity-0 transition-opacity hover:bg-slate-200/70 hover:text-[#1A365D] group-hover:opacity-100 focus:opacity-100"
                      >
                        <Maximize2 className="h-3 w-3" />
                      </button>
                    </div>
                  </td>

                {/* 2. EL Invoice ID */}
                <td className="border-b border-r border-[#8FA6C1]/70 p-0">
                  <input
                    type="text"
                    value={task.elInvoiceId}
                    onChange={(e) =>
                      onUpdateField(task.id, 'elInvoiceId', e.target.value)
                    }
                    aria-label={`EL Invoice ID row ${slNo}`}
                    className="h-[38px] w-full bg-transparent px-2.5 font-mono text-xs text-slate-900 focus:bg-[#EFF6FF] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#1A365D]"
                  />
                </td>

                {/* 3. Client Name */}
                <td className="border-b border-r border-[#8FA6C1]/70 p-0">
                  <input
                    type="text"
                    value={task.clientName}
                    onChange={(e) =>
                      onUpdateField(task.id, 'clientName', e.target.value)
                    }
                    aria-label={`Client Name row ${slNo}`}
                    className="h-[38px] w-full bg-transparent px-2.5 text-[13.5px] text-slate-900 focus:bg-[#EFF6FF] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#1A365D]"
                  />
                </td>

                {/* 4. Company Name */}
                <td className="border-b border-r border-[#8FA6C1]/70 p-0">
                  <input
                    type="text"
                    value={task.companyName}
                    onChange={(e) =>
                      onUpdateField(task.id, 'companyName', e.target.value)
                    }
                    aria-label={`Company Name row ${slNo}`}
                    className="h-[38px] w-full bg-transparent px-2.5 text-[13.5px] text-slate-900 focus:bg-[#EFF6FF] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#1A365D]"
                  />
                </td>

                {/* 5. Task Name */}
                <td className="border-b border-r border-[#8FA6C1]/70 p-0">
                  <input
                    type="text"
                    value={task.taskName}
                    onChange={(e) =>
                      onUpdateField(task.id, 'taskName', e.target.value)
                    }
                    aria-label={`Task Name row ${slNo}`}
                    className="h-[38px] w-full bg-transparent px-2.5 text-[13.5px] font-medium text-slate-900 focus:bg-[#EFF6FF] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#1A365D]"
                  />
                </td>

                {/* 6. Task By */}
                <td className="border-b border-r border-[#8FA6C1]/70 p-0">
                  <input
                    type="text"
                    value={task.taskBy}
                    onChange={(e) =>
                      onUpdateField(task.id, 'taskBy', e.target.value)
                    }
                    aria-label={`Task By row ${slNo}`}
                    className="h-[38px] w-full bg-transparent px-2.5 text-[13.5px] text-slate-800 focus:bg-[#EFF6FF] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#1A365D]"
                  />
                </td>

                {/* 7. Task Status */}
                <td className="border-b border-r border-[#8FA6C1]/70 p-0">
                  <select
                    value={task.taskStatus}
                    onChange={(e) =>
                      onUpdateField(
                        task.id,
                        'taskStatus',
                        e.target.value as TaskStatus
                      )
                    }
                    aria-label={`Task Status row ${slNo}`}
                    className={`h-[38px] w-full cursor-pointer bg-transparent px-2 text-xs focus:bg-[#EFF6FF] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#1A365D] ${getStatusTextClass(
                      task.taskStatus
                    )}`}
                  >
                    {TASK_STATUS_OPTIONS.map((opt) => (
                      <option
                        key={opt || 'blank'}
                        value={opt}
                        className="font-normal text-slate-900"
                      >
                        {opt || '—'}
                      </option>
                    ))}
                  </select>
                </td>

                {/* 8. Due Date */}
                {(() => {
                  const dueState = getDueDateState(task.dueDate, task.taskStatus);
                  const isOverdue = dueState === 'overdue';
                  const isDueToday = dueState === 'due-today';
                  const daysLate = isOverdue ? getDaysOverdue(task.dueDate) : 0;
                  return (
                    <td
                      className={`border-b border-r border-[#8FA6C1]/70 p-0 ${
                        isOverdue ? 'bg-red-50/70' : ''
                      }`}
                    >
                      <div className="flex h-[38px] items-center gap-1 pr-2">
                        <input
                          type="date"
                          value={task.dueDate || ''}
                          onChange={(e) =>
                            onUpdateField(task.id, 'dueDate', e.target.value)
                          }
                          aria-label={`Due Date row ${slNo}`}
                          className={`h-full min-w-0 flex-1 bg-transparent pl-2 pr-1 font-mono text-xs tabular-nums focus:bg-[#EFF6FF] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#1A365D] ${
                            isOverdue
                              ? 'font-semibold text-red-700'
                              : isDueToday
                                ? 'font-semibold text-amber-700'
                                : task.dueDate
                                  ? 'text-slate-800'
                                  : 'text-slate-400'
                          }`}
                        />
                        {isOverdue && (
                          <span
                            title={`Overdue by ${daysLate} ${
                              daysLate === 1 ? 'day' : 'days'
                            }`}
                            className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-red-700 whitespace-nowrap"
                          >
                            <AlertTriangle
                              className="h-3.5 w-3.5 shrink-0"
                              aria-hidden="true"
                            />
                            <span>Overdue</span>
                          </span>
                        )}
                        {isDueToday && (
                          <span className="shrink-0 text-[11px] font-semibold text-amber-700 whitespace-nowrap">
                            Today
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })()}

                {/* 9. Task Price */}
                <td className="border-b border-r border-[#8FA6C1]/70 p-0">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={task.taskPrice}
                    onChange={(e) =>
                      onUpdateField(task.id, 'taskPrice', e.target.value)
                    }
                    aria-label={`Task Price row ${slNo}`}
                    className="h-[38px] w-full bg-transparent px-2.5 text-right font-mono text-xs text-slate-900 tabular-nums focus:bg-[#EFF6FF] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#1A365D]"
                  />
                </td>

                {/* 9. Paid/Receive Amount */}
                <td className="border-b border-r border-[#8FA6C1]/70 p-0">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={task.paidReceiveAmount}
                    onChange={(e) =>
                      onUpdateField(task.id, 'paidReceiveAmount', e.target.value)
                    }
                    aria-label={`Paid or Receive Amount row ${slNo}`}
                    className="h-[38px] w-full bg-transparent px-2.5 text-right font-mono text-xs text-emerald-800 tabular-nums focus:bg-[#EFF6FF] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#1A365D]"
                  />
                </td>

                {/* 10. Note for Paid/Receive */}
                <td className="border-b border-r border-[#8FA6C1]/70 p-0">
                  <input
                    type="text"
                    value={task.noteForPaidReceive}
                    onChange={(e) =>
                      onUpdateField(task.id, 'noteForPaidReceive', e.target.value)
                    }
                    aria-label={`Note for Paid or Receive row ${slNo}`}
                    className="h-[38px] w-full bg-transparent px-2.5 text-xs text-slate-700 focus:bg-[#EFF6FF] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#1A365D]"
                  />
                </td>

                {/* 11. Drive Link */}
                <td className="border-b border-r border-[#8FA6C1]/70 px-2 py-0">
                  <div className="flex h-[38px] items-center justify-between gap-1.5">
                    {task.driveLink ? (
                      <>
                        <a
                          href={task.driveLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={task.driveFileName || task.driveLink}
                          className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-[#1A365D] hover:underline"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="truncate">
                            {task.driveFileName || 'Open Drive Link'}
                          </span>
                        </a>
                        <button
                          type="button"
                          onClick={() => onOpenDrivePicker(task, slNo)}
                          title="Change or manage Drive link"
                          aria-label={`Change Drive link for row ${slNo}`}
                          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200/70 hover:text-[#1A365D]"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpenDrivePicker(task, slNo)}
                        className="inline-flex w-full items-center gap-1.5 text-xs text-slate-400 transition-colors hover:text-[#1A365D] group-hover:text-slate-600"
                      >
                        <FolderPlus className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">Link or create in Drive</span>
                      </button>
                    )}
                  </div>
                </td>

                {/* 12. Action to Do — Username Tag Drop-Down */}
                <td className="border-b border-[#8FA6C1]/70 p-0">
                  <div className="flex h-[38px] items-center">
                    {isAdmin ? (
                      <select
                        value={task.assignedUser || ''}
                        onChange={(e) =>
                          onUpdateField(task.id, 'assignedUser', e.target.value)
                        }
                        aria-label={`Action to Do assigned user row ${slNo}`}
                        className={`h-full min-w-0 flex-1 cursor-pointer bg-transparent px-2.5 text-xs focus:bg-[#EFF6FF] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#1A365D] ${
                          task.assignedUser
                            ? 'font-mono font-medium text-[#1A365D]'
                            : 'text-slate-400'
                        }`}
                      >
                        <option value="" className="font-sans text-slate-500">
                          {activeUsers.length > 0
                            ? 'Select user...'
                            : 'Add users in Settings'}
                        </option>
                        {activeUsers.map((u) => (
                          <option
                            key={u.id}
                            value={u.username}
                            className="font-mono text-slate-900"
                          >
                            {u.username}
                            {u.fullName && u.fullName !== u.username
                              ? ` (${u.fullName})`
                              : ''}
                          </option>
                        ))}
                        {task.assignedUser &&
                          !activeUsers.some(
                            (u) =>
                              u.username.toLowerCase() ===
                              task.assignedUser.toLowerCase()
                          ) && (
                            <option
                              value={task.assignedUser}
                              className="font-mono text-slate-700"
                            >
                              {task.assignedUser}
                            </option>
                          )}
                      </select>
                    ) : (
                      <span className="flex-1 truncate px-2.5 font-mono text-xs font-medium text-[#1A365D]">
                        {task.assignedUser || '—'}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onDeleteRow(task, slNo)}
                      title={`Delete row ${slNo}`}
                      aria-label={`Delete row ${slNo}`}
                      className="mr-1.5 rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-700 group-hover:opacity-100 focus:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
                </tr>
              );
            })
          )}
        </tbody>

        {/* Totals Footer Row */}
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-[#8FA6C1] bg-gradient-to-r from-slate-50 via-[#F3F8FD] to-slate-50 font-medium text-slate-900">
              <td
                colSpan={9}
                className="border-r border-[#8FA6C1] px-3 py-2.5 text-xs text-slate-600"
              >
                Showing <span className="font-mono font-semibold text-slate-900">{rows.length}</span>{' '}
                {rows.length === 1 ? 'row' : 'rows'} · Outstanding Balance:{' '}
                <span className="font-mono font-semibold text-amber-700 tabular-nums">
                  {formatAmount(totalVisibleDue, currencySymbol)}
                </span>
              </td>
              <td className="border-r border-[#8FA6C1] px-2.5 py-2.5 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                {formatAmount(totalVisiblePrice, currencySymbol)}
              </td>
              <td className="border-r border-[#8FA6C1] px-2.5 py-2.5 text-right font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                {formatAmount(totalVisiblePaid, currencySymbol)}
              </td>
              <td colSpan={3} className="px-3 py-2.5 text-right text-xs text-slate-500">
                {sortConfig ? (
                  <span className="inline-flex items-center gap-2">
                    <span>
                      Sorted by{' '}
                      <strong className="font-semibold text-[#1A365D]">
                        {SORT_FIELD_LABELS[sortConfig.field]}
                      </strong>{' '}
                      ({sortConfig.direction === 'asc' ? 'Ascending' : 'Descending'})
                    </span>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => setSortConfig(null)}
                      className="cursor-pointer font-semibold text-[#1A365D] hover:underline"
                    >
                      Reset order
                    </button>
                  </span>
                ) : (
                  'Click Status, Due Date, or Price header to sort · Hover row number to expand'
                )}
              </td>
            </tr>
          </tfoot>
        )}
        </table>
      </div>
    </div>
  );
};
