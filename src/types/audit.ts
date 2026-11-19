export type AuditCategory = 'task' | 'bridge' | 'user' | 'archive' | 'export';

export type AuditSeverity = 'info' | 'success' | 'warning' | 'error';

export interface AuditLogEntry {
  id: string;
  timestamp: string; // ISO-8601
  category: AuditCategory;
  action: string;
  actorUsername: string;
  actorName: string;
  actorRole?: 'admin' | 'user' | 'system';
  target?: string;
  details: string;
  severity: AuditSeverity;
  metadata?: Record<string, string | number | boolean>;
}

export type NewAuditLogInput = Omit<AuditLogEntry, 'id' | 'timestamp'> & {
  timestamp?: string;
};

export const STORAGE_KEY_AUDIT_LOGS = 'el_task_plan_audit_log_v1';
export const MAX_AUDIT_LOG_ENTRIES = 1000;

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  bridge: 'Bridge Sync',
  task: 'Task Update',
  user: 'User Activity',
  archive: 'Archive',
  export: 'Export & Backup',
};

export const AUDIT_SEVERITY_LABELS: Record<AuditSeverity, string> = {
  success: 'Success',
  info: 'Recorded',
  warning: 'Warning',
  error: 'Failed',
};

export function loadAuditLogs(): AuditLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_AUDIT_LOGS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as AuditLogEntry[])
      .filter(
        (entry) =>
          entry &&
          typeof entry.id === 'string' &&
          typeof entry.timestamp === 'string' &&
          typeof entry.action === 'string' &&
          typeof entry.details === 'string'
      )
      .slice(0, MAX_AUDIT_LOG_ENTRIES);
  } catch {
    return [];
  }
}

export function saveAuditLogs(entries: AuditLogEntry[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY_AUDIT_LOGS,
      JSON.stringify(entries.slice(0, MAX_AUDIT_LOG_ENTRIES))
    );
  } catch {
    // ignore storage quota errors
  }
}

export function createAuditEntry(input: NewAuditLogInput): AuditLogEntry {
  return {
    id: crypto.randomUUID(),
    timestamp: input.timestamp || new Date().toISOString(),
    category: input.category,
    action: input.action,
    actorUsername: input.actorUsername,
    actorName: input.actorName,
    actorRole: input.actorRole,
    target: input.target,
    details: input.details,
    severity: input.severity,
    metadata: input.metadata,
  };
}

function escapeCsvCell(value: unknown): string {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildAuditLogCsv(entries: AuditLogEntry[]): string {
  const headers = [
    'Timestamp (ISO)',
    'Category',
    'Outcome',
    'Actor User ID',
    'Actor Name',
    'Action',
    'Target',
    'Details',
  ];
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...entries.map((e) =>
      [
        e.timestamp,
        AUDIT_CATEGORY_LABELS[e.category] || e.category,
        AUDIT_SEVERITY_LABELS[e.severity] || e.severity,
        e.actorUsername,
        e.actorName,
        e.action,
        e.target || '',
        e.details,
      ]
        .map(escapeCsvCell)
        .join(',')
    ),
  ];
  return lines.join('\r\n');
}
