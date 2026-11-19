import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CalendarPlus,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
  Repeat,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  DRIVE_FOLDER_MIME,
  TASK_STATUS_OPTIONS,
  formatAmount,
  getDaysOverdue,
  getDueDateState,
  parseCurrencyValue,
  type ConfirmDialogRequest,
  type DriveFileItem,
  type TaskRow,
  type TaskStatus,
} from '../types/task';
import {
  DriveAuthError,
  formatFileSize,
  getFriendlyMimeLabel,
  listDriveFiles,
  uploadFileToDrive,
} from '../services/googleDrive';
import { TaskCommentsThread } from './TaskCommentsThread';
import type { AppUser } from '../types/auth';

type RecurrenceCadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

const MONTH_FULL_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTH_SHORT_NAMES = [
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

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseIsoDateLocal(isoDate: string): Date {
  const parts = isoDate.trim().split('-').map((p) => Number.parseInt(p, 10));
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function computeNextDueDate(
  baseIsoDate: string | undefined,
  cadence: RecurrenceCadence
): string {
  const base = parseIsoDateLocal(baseIsoDate || '');
  const year = base.getFullYear();
  const month = base.getMonth();
  const day = base.getDate();

  if (cadence === 'weekly') {
    const next = new Date(year, month, day + 7);
    return formatLocalIsoDate(next);
  }

  const monthsToAdd =
    cadence === 'monthly' ? 1 : cadence === 'quarterly' ? 3 : 12;
  const targetMonthIndex = month + monthsToAdd;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(
    targetYear,
    normalizedMonth + 1,
    0
  ).getDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  return formatLocalIsoDate(new Date(targetYear, normalizedMonth, clampedDay));
}

function incrementTrailingNumber(input: string): string | null {
  const match = input.match(/^(.*?)(\d+)([^0-9]*)$/);
  if (!match) return null;
  const [, prefix, digits, suffix] = match;
  const nextVal = Number.parseInt(digits, 10) + 1;
  if (!Number.isFinite(nextVal)) return null;
  const padded = String(nextVal).padStart(digits.length, '0');
  return `${prefix}${padded}${suffix}`;
}

function suggestNextInvoiceId(
  invoiceId: string,
  existingInvoiceIds: string[]
): string {
  const trimmed = invoiceId.trim();
  if (!trimmed) return '';

  const taken = new Set(
    existingInvoiceIds.map((id) => id.trim().toLowerCase()).filter(Boolean)
  );

  let candidate = incrementTrailingNumber(trimmed) ?? `${trimmed}-2`;
  let guard = 0;
  while (taken.has(candidate.toLowerCase()) && guard < 100) {
    candidate = incrementTrailingNumber(candidate) ?? `${candidate}-2`;
    guard += 1;
  }
  return candidate;
}

function suggestNextTaskName(
  taskName: string,
  nextDueDate: string,
  invoiceWasIncremented: boolean
): string {
  const trimmed = taskName.trim();
  if (!trimmed) return '';

  const nextDate = parseIsoDateLocal(nextDueDate);
  const nextMonthFull = MONTH_FULL_NAMES[nextDate.getMonth()];
  const nextMonthShort = MONTH_SHORT_NAMES[nextDate.getMonth()];
  const nextYear = String(nextDate.getFullYear());

  // 1. If the task name mentions a month name, update it to the target due date's month (and year if present)
  const fullMonthRegex = new RegExp(
    `\\b(${MONTH_FULL_NAMES.join('|')})\\b`,
    'i'
  );
  if (fullMonthRegex.test(trimmed)) {
    let updated = trimmed.replace(fullMonthRegex, nextMonthFull);
    if (/\b20\d{2}\b/.test(updated)) {
      updated = updated.replace(/\b20\d{2}\b/, nextYear);
    }
    if (updated !== trimmed) return updated;
  }

  const shortMonthRegex = new RegExp(
    `\\b(${MONTH_SHORT_NAMES.join('|')})\\b`,
    'i'
  );
  if (shortMonthRegex.test(trimmed)) {
    let updated = trimmed.replace(shortMonthRegex, nextMonthShort);
    if (/\b20\d{2}\b/.test(updated)) {
      updated = updated.replace(/\b20\d{2}\b/, nextYear);
    }
    if (updated !== trimmed) return updated;
  }

  // 2. If the task name has an explicit trailing counter like "#2", "(2)", or "- 2", increment it
  const trailingCounterMatch = trimmed.match(
    /^(.*?(?:#|\(|-\s*|Part\s+|Cycle\s+|Phase\s+))(\d+)(\)?)$/i
  );
  if (trailingCounterMatch) {
    const [, prefix, digits, suffix] = trailingCounterMatch;
    const nextNum = Number.parseInt(digits, 10) + 1;
    if (Number.isFinite(nextNum)) {
      return `${prefix}${String(nextNum).padStart(digits.length, '0')}${suffix}`;
    }
  }

  // 3. If no invoice ID was incremented, append a clean cycle suffix so the clone stands out
  if (!invoiceWasIncremented) {
    return `${trimmed} (${nextMonthShort} ${nextYear})`;
  }

  return trimmed;
}

interface TaskDetailDrawerProps {
  task: TaskRow | null;
  slNo: number;
  currencySymbol: string;
  isSignedIn: boolean;
  users: AppUser[];
  currentUser: AppUser;
  isAdmin: boolean;
  existingInvoiceIds: string[];
  onUpdateField: <K extends keyof TaskRow>(
    taskId: string,
    field: K,
    value: TaskRow[K]
  ) => void;
  onAddComment: (
    taskId: string,
    payload: { body: string; parentId: string | null; mentions: string[] }
  ) => void;
  onDeleteComment: (taskId: string, commentId: string) => void;
  onCloneRecurring: (
    sourceTask: TaskRow,
    sourceSlNo: number,
    options: {
      elInvoiceId: string;
      taskName: string;
      dueDate: string;
      resetPayment: boolean;
      keepDriveLink: boolean;
    }
  ) => void;
  onOpenDrivePicker: (task: TaskRow, slNo: number) => void;
  onArchiveTask: (task: TaskRow) => void;
  onRestoreTask: (task: TaskRow) => void;
  onRequestConfirm: (req: ConfirmDialogRequest) => void;
  onSessionExpired: () => void;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
  onDeleteRow: (task: TaskRow, slNo: number) => void;
  onClose: () => void;
}

export const TaskDetailDrawer: React.FC<TaskDetailDrawerProps> = ({
  task,
  slNo,
  currencySymbol,
  isSignedIn,
  users,
  currentUser,
  isAdmin,
  existingInvoiceIds,
  onUpdateField,
  onAddComment,
  onDeleteComment,
  onCloneRecurring,
  onOpenDrivePicker,
  onArchiveTask,
  onRestoreTask,
  onRequestConfirm,
  onSessionExpired,
  onNotify,
  onDeleteRow,
  onClose,
}) => {
  const activeUsers = users.filter((u) => u.isActive);
  const [activeTab, setActiveTab] = useState<'details' | 'comments'>('details');
  const [folderContents, setFolderContents] = useState<DriveFileItem[]>([]);
  const [loadingFolder, setLoadingFolder] = useState(false);
  const uploadRef = useRef<HTMLInputElement | null>(null);

  // Recurring clone panel state
  const [showRecurringForm, setShowRecurringForm] = useState(false);
  const [cadence, setCadence] = useState<RecurrenceCadence>('monthly');
  const [recurringDueDate, setRecurringDueDate] = useState('');
  const [recurringInvoiceId, setRecurringInvoiceId] = useState('');
  const [recurringTaskName, setRecurringTaskName] = useState('');
  const [resetPayment, setResetPayment] = useState(true);
  const [keepDriveLink, setKeepDriveLink] = useState(false);
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);

  const isLinkedFolder =
    Boolean(task?.driveFileId) && task?.driveMimeType === DRIVE_FOLDER_MIME;

  const loadLinkedFolderContents = async () => {
    if (!task?.driveFileId || !isLinkedFolder || !isSignedIn) {
      setFolderContents([]);
      return;
    }
    setLoadingFolder(true);
    try {
      const items = await listDriveFiles({
        folderId: task.driveFileId,
        pageSize: 25,
      });
      setFolderContents(items);
    } catch (err) {
      if (err instanceof DriveAuthError) {
        onSessionExpired();
      }
    } finally {
      setLoadingFolder(false);
    }
  };

  useEffect(() => {
    loadLinkedFolderContents();
  }, [task?.id, task?.driveFileId, isLinkedFolder, isSignedIn]);

  // Close recurring panel whenever switching to a different task
  useEffect(() => {
    setShowRecurringForm(false);
    setNameManuallyEdited(false);
  }, [task?.id]);

  if (!task) return null;

  const openRecurringForm = () => {
    const defaultCadence: RecurrenceCadence = 'monthly';
    const nextDate = computeNextDueDate(task.dueDate, defaultCadence);
    const nextInvoice = suggestNextInvoiceId(
      task.elInvoiceId,
      existingInvoiceIds
    );
    const nextName = suggestNextTaskName(
      task.taskName,
      nextDate,
      Boolean(nextInvoice && nextInvoice !== task.elInvoiceId.trim())
    );
    setCadence(defaultCadence);
    setRecurringDueDate(nextDate);
    setRecurringInvoiceId(nextInvoice);
    setRecurringTaskName(nextName);
    setResetPayment(true);
    setKeepDriveLink(isLinkedFolder);
    setNameManuallyEdited(false);
    setShowRecurringForm(true);
  };

  const handleSelectCadence = (nextCadence: RecurrenceCadence) => {
    setCadence(nextCadence);
    const nextDate = computeNextDueDate(task.dueDate, nextCadence);
    setRecurringDueDate(nextDate);
    if (!nameManuallyEdited) {
      setRecurringTaskName(
        suggestNextTaskName(
          task.taskName,
          nextDate,
          Boolean(
            recurringInvoiceId.trim() &&
              recurringInvoiceId.trim() !== task.elInvoiceId.trim()
          )
        )
      );
    }
  };

  const handleSubmitRecurring = (e: React.FormEvent) => {
    e.preventDefault();
    onCloneRecurring(task, slNo, {
      elInvoiceId: recurringInvoiceId,
      taskName: recurringTaskName,
      dueDate: recurringDueDate,
      resetPayment,
      keepDriveLink,
    });
    setShowRecurringForm(false);
  };

  const priceNum = parseCurrencyValue(task.taskPrice);
  const paidNum = parseCurrencyValue(task.paidReceiveAmount);
  const dueNum = Math.max(0, priceNum - paidNum);

  const handleUploadIntoFolder = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !task.driveFileId) return;

    onRequestConfirm({
      title: 'Upload document into task folder?',
      description: `Upload "${file.name}" (${formatFileSize(String(file.size))}) into Google Drive folder "${task.driveFileName || 'Task Folder'}"?`,
      confirmLabel: 'Upload File',
      tone: 'primary',
      onConfirm: async () => {
        try {
          await uploadFileToDrive(file, task.driveFileId);
          onNotify(`Uploaded "${file.name}" into Drive folder.`);
          await loadLinkedFolderContents();
        } catch (err) {
          if (err instanceof DriveAuthError) {
            onSessionExpired();
          } else {
            onNotify(
              err instanceof Error ? err.message : 'Failed to upload file.',
              'error'
            );
          }
        }
      },
    });
  };

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end bg-slate-900/35"
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-drawer-title"
    >
      <div className="flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <p className="font-mono text-xs text-slate-500">
              {task.isArchived
                ? 'ARCHIVED'
                : `SL NO ${String(slNo).padStart(2, '0')}`}
              {task.elInvoiceId ? ` · ${task.elInvoiceId}` : ''}
            </p>
            <h3
              id="task-drawer-title"
              className="mt-0.5 text-lg font-semibold text-[#1A365D]"
            >
              {task.taskName.trim() || 'Task Details'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close task details"
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Archive Status Banner (when archived or completed) */}
        {task.isArchived ? (
          <div className="flex items-center justify-between gap-3 border-b border-[#8FA6C1] bg-[#E6F0FA] px-6 py-2.5 text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-[#1A365D]">
              <Archive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              This task is archived and hidden from the active ledger.
            </span>
            <button
              type="button"
              onClick={() => onRestoreTask(task)}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded bg-[#1A365D] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#132948]"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Restore
            </button>
          </div>
        ) : task.taskStatus === 'Completed' ? (
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-6 py-2 text-xs text-slate-600">
            <span>Completed tasks auto-archive after 30 days.</span>
            <button
              type="button"
              onClick={() => onArchiveTask(task)}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1 font-medium text-[#1A365D] hover:underline"
            >
              <Archive className="h-3 w-3" aria-hidden="true" />
              Archive now
            </button>
          </div>
        ) : null}

        {/* Drawer Tab Switcher */}
        <div className="flex items-center gap-6 border-b border-slate-200 bg-slate-50/70 px-6 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('details')}
            className={`border-b-2 py-2.5 transition-colors whitespace-nowrap ${
              activeTab === 'details'
                ? 'border-[#1A365D] text-[#1A365D]'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Details & Drive
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('comments')}
            className={`border-b-2 py-2.5 transition-colors whitespace-nowrap ${
              activeTab === 'comments'
                ? 'border-[#1A365D] text-[#1A365D]'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Comments & Updates (
            <span className="font-mono tabular-nums">
              {(task.comments ?? []).length}
            </span>
            )
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {activeTab === 'comments' ? (
            <TaskCommentsThread
              taskId={task.id}
              comments={task.comments ?? []}
              users={users}
              currentUser={currentUser}
              isAdmin={isAdmin}
              onAddComment={onAddComment}
              onDeleteComment={onDeleteComment}
            />
          ) : (
            <>
          {/* Payment Summary Bar */}
          <div className="grid grid-cols-3 divide-x divide-slate-200 border border-slate-200 rounded-md bg-slate-50/70">
            <div className="px-3.5 py-2.5">
              <p className="text-xs text-slate-500">Task Price</p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {formatAmount(priceNum, currencySymbol)}
              </p>
            </div>
            <div className="px-3.5 py-2.5">
              <p className="text-xs text-slate-500">Paid / Received</p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-emerald-700 tabular-nums">
                {formatAmount(paidNum, currencySymbol)}
              </p>
            </div>
            <div className="px-3.5 py-2.5">
              <p className="text-xs text-slate-500">Balance Due</p>
              <p
                className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${
                  dueNum > 0 ? 'text-amber-700' : 'text-slate-600'
                }`}
              >
                {formatAmount(dueNum, currencySymbol)}
              </p>
            </div>
          </div>

          {/* Fields Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                EL Invoice ID
              </label>
              <input
                type="text"
                value={task.elInvoiceId}
                onChange={(e) => onUpdateField(task.id, 'elInvoiceId', e.target.value)}
                placeholder="EL-2026-001"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Task Status
              </label>
              <select
                value={task.taskStatus}
                onChange={(e) =>
                  onUpdateField(task.id, 'taskStatus', e.target.value as TaskStatus)
                }
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none"
              >
                {TASK_STATUS_OPTIONS.map((opt) => (
                  <option key={opt || 'empty'} value={opt}>
                    {opt || 'Select status...'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Client Name
              </label>
              <input
                type="text"
                value={task.clientName}
                onChange={(e) => onUpdateField(task.id, 'clientName', e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Company Name
              </label>
              <input
                type="text"
                value={task.companyName}
                onChange={(e) => onUpdateField(task.id, 'companyName', e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700">
                Task Name
              </label>
              <input
                type="text"
                value={task.taskName}
                onChange={(e) => onUpdateField(task.id, 'taskName', e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Task By
              </label>
              <input
                type="text"
                value={task.taskBy}
                onChange={(e) => onUpdateField(task.id, 'taskBy', e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="block text-xs font-medium text-slate-700">
                  Due Date
                </label>
                {getDueDateState(task.dueDate, task.taskStatus) === 'overdue' && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700">
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                    Overdue ({getDaysOverdue(task.dueDate)}d)
                  </span>
                )}
              </div>
              <input
                type="date"
                value={task.dueDate || ''}
                onChange={(e) => onUpdateField(task.id, 'dueDate', e.target.value)}
                className={`mt-1 w-full rounded-md border px-3 py-2 font-mono text-sm tabular-nums focus:border-[#1A365D] focus:outline-none ${
                  getDueDateState(task.dueDate, task.taskStatus) === 'overdue'
                    ? 'border-red-300 bg-red-50/50 text-red-800'
                    : 'border-slate-300 text-slate-900'
                }`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Task Price ({currencySymbol})
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={task.taskPrice}
                onChange={(e) => onUpdateField(task.id, 'taskPrice', e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-[#1A365D] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Paid / Receive Amount ({currencySymbol})
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={task.paidReceiveAmount}
                onChange={(e) =>
                  onUpdateField(task.id, 'paidReceiveAmount', e.target.value)
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-[#1A365D] focus:outline-none"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700">
                Note for Paid / Receive
              </label>
              <textarea
                rows={2}
                value={task.noteForPaidReceive}
                onChange={(e) =>
                  onUpdateField(task.id, 'noteForPaidReceive', e.target.value)
                }
                placeholder="Payment method, receipt date, installment details..."
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700">
                Action to Do — Tagged User
              </label>
              {isAdmin ? (
                <select
                  value={task.assignedUser || ''}
                  onChange={(e) =>
                    onUpdateField(task.id, 'assignedUser', e.target.value)
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none"
                >
                  <option value="">Unassigned</option>
                  {activeUsers.map((u) => (
                    <option key={u.id} value={u.username}>
                      {u.username}
                      {u.fullName && u.fullName !== u.username
                        ? ` (${u.fullName})`
                        : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-700">
                  {task.assignedUser || 'Unassigned'}
                </p>
              )}
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700">
                Action Notes (optional)
              </label>
              <textarea
                rows={2}
                value={task.actionToDo}
                onChange={(e) => onUpdateField(task.id, 'actionToDo', e.target.value)}
                placeholder="Next concrete step or follow-up required..."
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none"
              />
            </div>
          </div>

          {/* Google Drive Section */}
          <div className="border-t border-slate-200 pt-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-900">
                Google Drive Attachment
              </h4>
              <button
                type="button"
                onClick={() => onOpenDrivePicker(task, slNo)}
                className="text-xs font-medium text-[#1A365D] hover:underline whitespace-nowrap"
              >
                {task.driveLink ? 'Change Drive Link' : 'Attach or Create Folder'}
              </button>
            </div>

            {task.driveLink ? (
              <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {isLinkedFolder ? (
                      <FolderOpen className="h-4 w-4 shrink-0 text-[#1A365D]" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-[#1A365D]" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {task.driveFileName || 'Google Drive Link'}
                      </p>
                      <p className="truncate text-xs text-slate-500">{task.driveLink}</p>
                    </div>
                  </div>
                  <a
                    href={task.driveLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 whitespace-nowrap"
                  >
                    Open
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                {isLinkedFolder && isSignedIn && (
                  <div className="border-t border-slate-200 pt-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-600">
                        Files inside this folder
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={loadLinkedFolderContents}
                          disabled={loadingFolder}
                          className="text-xs text-slate-500 hover:text-slate-900"
                          aria-label="Refresh folder contents"
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${loadingFolder ? 'animate-spin' : ''}`}
                          />
                        </button>
                        <input
                          ref={uploadRef}
                          type="file"
                          onChange={handleUploadIntoFolder}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => uploadRef.current?.click()}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#1A365D] hover:underline whitespace-nowrap"
                        >
                          <Upload className="h-3 w-3" />
                          Upload Here
                        </button>
                      </div>
                    </div>

                    {loadingFolder ? (
                      <p className="text-xs text-slate-500">Loading folder contents...</p>
                    ) : folderContents.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        This folder is currently empty.
                      </p>
                    ) : (
                      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
                        {folderContents.map((file) => (
                          <li
                            key={file.id}
                            className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              {file.mimeType === DRIVE_FOLDER_MIME ? (
                                <Folder className="h-3.5 w-3.5 shrink-0 text-[#1A365D]" />
                              ) : (
                                <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                              )}
                              <span className="truncate font-medium text-slate-800">
                                {file.name}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-2 text-slate-500">
                              <span>{getFriendlyMimeLabel(file.mimeType)}</span>
                              {file.webViewLink && (
                                <a
                                  href={file.webViewLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#1A365D] hover:underline"
                                >
                                  Open
                                </a>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                No Google Drive folder or file linked to this task yet.
              </p>
            )}
          </div>
            </>
          )}
        </div>

        {/* Recurring Task Clone Panel */}
        {showRecurringForm && (
          <form
            onSubmit={handleSubmitRecurring}
            className="border-t border-[#8FA6C1] bg-[#F4F8FD] px-6 py-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <CalendarPlus
                  className="h-4 w-4 text-[#1A365D]"
                  aria-hidden="true"
                />
                <h4 className="text-xs font-bold uppercase tracking-wide text-[#1A365D]">
                  Create Recurring Task
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setShowRecurringForm(false)}
                aria-label="Cancel creating recurring task"
                className="rounded p-1 text-slate-500 hover:bg-slate-200/70 hover:text-slate-900"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Quick Cadence Presets */}
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'weekly', label: '+1 Week' },
                  { id: 'monthly', label: '+1 Month' },
                  { id: 'quarterly', label: '+3 Months' },
                  { id: 'yearly', label: '+1 Year' },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectCadence(preset.id)}
                  className={`cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    cadence === preset.id
                      ? 'bg-[#1A365D] text-white'
                      : 'border border-[#8FA6C1]/80 bg-white text-slate-700 hover:bg-[#E6F0FA]'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="recurring-due-date"
                  className="block text-[11px] font-medium text-slate-700"
                >
                  Next Due Date
                </label>
                <input
                  id="recurring-due-date"
                  type="date"
                  required
                  value={recurringDueDate}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRecurringDueDate(val);
                    if (!nameManuallyEdited && val) {
                      setRecurringTaskName(
                        suggestNextTaskName(
                          task.taskName,
                          val,
                          Boolean(
                            recurringInvoiceId.trim() &&
                              recurringInvoiceId.trim() !==
                                task.elInvoiceId.trim()
                          )
                        )
                      );
                    }
                  }}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-[#1A365D] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="recurring-invoice-id"
                  className="block text-[11px] font-medium text-slate-700"
                >
                  New EL Invoice ID
                </label>
                <input
                  id="recurring-invoice-id"
                  type="text"
                  value={recurringInvoiceId}
                  onChange={(e) => setRecurringInvoiceId(e.target.value)}
                  placeholder="Optional invoice ID"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-[#1A365D] focus:outline-none"
                />
              </div>

              <div className="col-span-2">
                <label
                  htmlFor="recurring-task-name"
                  className="block text-[11px] font-medium text-slate-700"
                >
                  New Task Name
                </label>
                <input
                  id="recurring-task-name"
                  type="text"
                  value={recurringTaskName}
                  onChange={(e) => {
                    setNameManuallyEdited(true);
                    setRecurringTaskName(e.target.value);
                  }}
                  placeholder="Task title for next cycle"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-[#1A365D] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-700">
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={resetPayment}
                  onChange={(e) => setResetPayment(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-400 accent-[#1A365D]"
                />
                <span>Reset paid amount & notes</span>
              </label>

              {task.driveLink && (
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={keepDriveLink}
                    onChange={(e) => setKeepDriveLink(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-400 accent-[#1A365D]"
                  />
                  <span>Keep Drive link</span>
                </label>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowRecurringForm(false)}
                className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[#1A365D] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#132948]"
              >
                <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
                Clone Recurring Task
              </button>
            </div>
          </form>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-6 py-3.5">
          <button
            type="button"
            onClick={() => onDeleteRow(task, slNo)}
            className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-red-700 hover:text-red-800 whitespace-nowrap"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Row
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                showRecurringForm
                  ? setShowRecurringForm(false)
                  : openRecurringForm()
              }
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                showRecurringForm
                  ? 'border-[#1A365D] bg-[#E6F0FA] text-[#1A365D]'
                  : 'border-[#1A365D]/30 bg-[#E6F0FA]/70 text-[#1A365D] hover:bg-[#E6F0FA]'
              }`}
            >
              <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
              Create Recurring
            </button>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-md bg-[#1A365D] px-4 py-2 text-sm font-medium text-white hover:bg-[#132948] whitespace-nowrap"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
