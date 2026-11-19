export type TaskStatus =
  | ''
  | 'Not Started'
  | 'In Progress'
  | 'Under Review'
  | 'On Hold'
  | 'Completed';

export interface TaskComment {
  id: string;
  parentId: string | null;
  authorUsername: string;
  authorName: string;
  body: string;
  mentions: string[];
  createdAt: string;
  kind?: 'comment' | 'activity';
}

export interface TaskRow {
  id: string;
  elInvoiceId: string;
  clientName: string;
  companyName: string;
  taskName: string;
  taskBy: string;
  taskStatus: TaskStatus;
  dueDate: string; // YYYY-MM-DD
  taskPrice: string; // Kept as string for smooth inline editing; parsed cleanly for totals
  paidReceiveAmount: string;
  noteForPaidReceive: string;
  driveLink: string;
  driveFileId?: string;
  driveFileName?: string;
  driveMimeType?: string;
  assignedUser: string;
  actionToDo: string;
  comments?: TaskComment[];
  completedAt?: string;
  isArchived?: boolean;
  archivedAt?: string;
  archiveExempt?: boolean;
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  modifiedTime?: string;
  size?: string;
  iconLink?: string;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
  parents?: string[];
  appProperties?: Record<string, string>;
}

export interface ConfirmDialogRequest {
  title: string;
  description: string;
  details?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => Promise<void> | void;
}

export const TASK_STATUS_OPTIONS: TaskStatus[] = [
  '',
  'Not Started',
  'In Progress',
  'Under Review',
  'On Hold',
  'Completed',
];

export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

export function parseCurrencyValue(value: string): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatAmount(amount: number, currencySymbol = '৳'): string {
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${currencySymbol}${formatted}`;
}

export function isRowPopulated(row: TaskRow): boolean {
  return Boolean(
    row.elInvoiceId.trim() ||
      row.clientName.trim() ||
      row.companyName.trim() ||
      row.taskName.trim() ||
      row.taskBy.trim() ||
      row.taskStatus ||
      (row.dueDate || '').trim() ||
      row.taskPrice.trim() ||
      row.paidReceiveAmount.trim() ||
      row.noteForPaidReceive.trim() ||
      row.driveLink.trim() ||
      (row.assignedUser || '').trim() ||
      row.actionToDo.trim()
  );
}

export function createEmptyTaskRow(assignedUser = ''): TaskRow {
  return {
    id: crypto.randomUUID(),
    elInvoiceId: '',
    clientName: '',
    companyName: '',
    taskName: '',
    taskBy: '',
    taskStatus: '',
    dueDate: '',
    taskPrice: '',
    paidReceiveAmount: '',
    noteForPaidReceive: '',
    driveLink: '',
    driveFileId: undefined,
    driveFileName: undefined,
    driveMimeType: undefined,
    assignedUser,
    actionToDo: '',
    comments: [],
    completedAt: undefined,
    isArchived: false,
    archivedAt: undefined,
    archiveExempt: false,
  };
}

export type DueDateState = 'overdue' | 'due-today' | 'upcoming' | 'none';

function getTodayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDueDateState(
  dueDate: string | undefined,
  status: TaskStatus
): DueDateState {
  const trimmed = (dueDate || '').trim();
  if (!trimmed || status === 'Completed') return 'none';
  const today = getTodayIsoDate();
  if (trimmed < today) return 'overdue';
  if (trimmed === today) return 'due-today';
  return 'upcoming';
}

export function getDaysOverdue(dueDate: string | undefined): number {
  const trimmed = (dueDate || '').trim();
  if (!trimmed) return 0;
  const parts = trimmed.split('-').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return 0;
  const dueUtc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((todayUtc - dueUtc) / 86_400_000);
  return Math.max(0, diffDays);
}

export const ARCHIVE_AFTER_DAYS = 30;
const MS_PER_DAY = 86_400_000;

export function getTaskCompletedReferenceMs(task: TaskRow): number | null {
  if (task.taskStatus !== 'Completed') return null;

  if (task.completedAt) {
    const parsed = Date.parse(task.completedAt);
    if (Number.isFinite(parsed)) return parsed;
  }

  // Fallback: inspect activity log for the latest transition to Completed
  if (Array.isArray(task.comments) && task.comments.length > 0) {
    for (let i = task.comments.length - 1; i >= 0; i -= 1) {
      const c = task.comments[i];
      if (
        c.kind === 'activity' &&
        /\bto Completed\b/i.test(c.body) &&
        c.createdAt
      ) {
        const parsed = Date.parse(c.createdAt);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }

  // Fallback for legacy/imported Completed tasks: use dueDate if present
  const trimmedDue = (task.dueDate || '').trim();
  if (trimmedDue) {
    const parts = trimmedDue.split('-').map((p) => Number.parseInt(p, 10));
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      return Date.UTC(parts[0], parts[1] - 1, parts[2]);
    }
  }

  return null;
}

export function shouldAutoArchiveTask(
  task: TaskRow,
  nowMs: number = Date.now()
): boolean {
  if (task.isArchived || task.archiveExempt) return false;
  if (task.taskStatus !== 'Completed') return false;
  if (!isRowPopulated(task)) return false;

  const refMs = getTaskCompletedReferenceMs(task);
  if (refMs === null) return false;

  return nowMs - refMs >= ARCHIVE_AFTER_DAYS * MS_PER_DAY;
}

export function getDaysSinceCompleted(
  task: TaskRow,
  nowMs: number = Date.now()
): number | null {
  const refMs = getTaskCompletedReferenceMs(task);
  if (refMs === null) return null;
  return Math.max(0, Math.floor((nowMs - refMs) / MS_PER_DAY));
}
