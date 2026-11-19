/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Archive,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  CloudUpload,
  Columns3,
  Download,
  FileSpreadsheet,
  FolderOpen,
  LogOut,
  Plus,
  Search,
  Settings,
  Table2,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import {
  ARCHIVE_AFTER_DAYS,
  createEmptyTaskRow,
  formatAmount,
  getDueDateState,
  isRowPopulated,
  parseCurrencyValue,
  shouldAutoArchiveTask,
  type ConfirmDialogRequest,
  type DriveFileItem,
  type TaskComment,
  type TaskRow,
  type TaskStatus,
} from './types/task';
import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  createDefaultAdminUser,
  hashPassword,
  type AppUser,
} from './types/auth';
import {
  clearAccessToken,
  googleSignIn,
  initAuth,
  logout,
} from './services/googleAuth';
import { DriveAuthError, saveLedgerToDrive } from './services/googleDrive';
import {
  DEFAULT_TARGET_DRIVE_FOLDER_ID,
  DEFAULT_TARGET_DRIVE_FOLDER_URL,
  createTaskSpreadsheet,
} from './services/googleSheets';
import {
  createSnapshotViaBridge,
  fetchBridgeStatus,
  loadBridgeConfig,
  runBridgeDiagnostics,
  saveBridgeConfig,
  syncMasterSheetViaBridge,
  type BridgeConfig,
  type BridgeDiagnosticReport,
  type BridgeStatusResponse,
  type BridgeSyncState,
} from './services/driveBridge';
import {
  MAX_AUDIT_LOG_ENTRIES,
  createAuditEntry,
  loadAuditLogs,
  saveAuditLogs,
  type AuditCategory,
  type AuditLogEntry,
  type AuditSeverity,
} from './types/audit';
import { buildTaskLedgerCsv, downloadCsvFile } from './utils/csvExport';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { ConfirmModal } from './components/ConfirmModal';
import { DriveLinkModal } from './components/DriveLinkModal';
import { TaskDetailDrawer } from './components/TaskDetailDrawer';
import { TaskLedgerTable } from './components/TaskLedgerTable';
import { TaskKanbanBoard } from './components/TaskKanbanBoard';
import { ArchiveTasksView } from './components/ArchiveTasksView';
import { DriveExplorerView } from './components/DriveExplorerView';
import { GoogleSheetsView } from './components/GoogleSheetsView';
import { BillingSummaryView } from './components/BillingSummaryView';
import { SettingsView } from './components/SettingsView';
import { LoginScreen } from './components/LoginScreen';

type ActiveView = 'ledger' | 'drive' | 'sheets' | 'billing' | 'settings';
type LedgerDisplayMode = 'table' | 'board';

const STORAGE_KEY_TASKS = 'el_task_plan_rows_v1';
const STORAGE_KEY_CURRENCY = 'el_task_plan_currency_v1';
const STORAGE_KEY_SYNC_META = 'el_task_plan_drive_sync_meta_v1';
const STORAGE_KEY_SHEET_META = 'el_task_plan_sheet_meta_v1';
const STORAGE_KEY_USERS = 'el_task_plan_users_v1';
const SESSION_KEY_ACTIVE_USER = 'el_task_plan_session_uid_v1';

const INITIAL_EMPTY_ROW_COUNT = 10;

const TASK_FIELD_LABELS: Partial<Record<keyof TaskRow, string>> = {
  elInvoiceId: 'EL Invoice ID',
  clientName: 'Client Name',
  companyName: 'Company Name',
  taskName: 'Task Name',
  taskBy: 'Task By',
  taskStatus: 'Task Status',
  dueDate: 'Due Date',
  taskPrice: 'Task Price',
  paidReceiveAmount: 'Paid/Receive Amount',
  noteForPaidReceive: 'Payment Note',
  driveLink: 'Drive Link',
  assignedUser: 'Assigned User',
  actionToDo: 'Action to Do',
};

function getTaskAuditLabel(task: Partial<TaskRow> | undefined): string {
  if (!task) return 'Task Row';
  const invoice = (task.elInvoiceId || '').trim();
  const name = (task.taskName || '').trim();
  const client = (task.clientName || '').trim();
  if (invoice && name) return `${invoice} — ${name}`;
  return invoice || name || client || 'Untitled Task';
}

function loadInitialTasks(): TaskRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TASKS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return (parsed as TaskRow[]).map((row) => ({
          ...row,
          assignedUser: typeof row.assignedUser === 'string' ? row.assignedUser : '',
          dueDate: typeof row.dueDate === 'string' ? row.dueDate : '',
          comments: Array.isArray(row.comments) ? row.comments : [],
          completedAt: typeof row.completedAt === 'string' ? row.completedAt : undefined,
          isArchived: Boolean(row.isArchived),
          archivedAt: typeof row.archivedAt === 'string' ? row.archivedAt : undefined,
          archiveExempt: Boolean(row.archiveExempt),
        }));
      }
    }
  } catch {
    // fall through to 10 clean empty rows
  }
  return Array.from({ length: INITIAL_EMPTY_ROW_COUNT }, () => createEmptyTaskRow());
}

function loadStoredUsers(): AppUser[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_USERS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as AppUser[];
      }
    }
  } catch {
    // ignore
  }
  return [];
}

function loadInitialCurrency(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_CURRENCY) || '৳';
  } catch {
    return '৳';
  }
}

function loadSyncMeta(): { fileId: string | null; fileName: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SYNC_META);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        fileId: typeof parsed.fileId === 'string' ? parsed.fileId : null,
        fileName: typeof parsed.fileName === 'string' ? parsed.fileName : null,
      };
    }
  } catch {
    // ignore
  }
  return { fileId: null, fileName: null };
}

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('ledger');
  const [tasks, setTasks] = useState<TaskRow[]>(loadInitialTasks);
  const [currencySymbol, setCurrencySymbol] = useState<string>(loadInitialCurrency);

  // Google Auth state (token stays strictly in memory inside googleAuth.ts)
  const [user, setUser] = useState<User | null>(null);
  const [needsAuth, setNeedsAuth] = useState<boolean>(true);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  // Synced Google Drive backup file metadata (file ID and name only, never auth tokens)
  const initialSync = useMemo(loadSyncMeta, []);
  const [syncedDriveFileId, setSyncedDriveFileId] = useState<string | null>(
    initialSync.fileId
  );
  const [syncedDriveFileName, setSyncedDriveFileName] = useState<string | null>(
    initialSync.fileName
  );

  // Linked Google Sheet metadata (spreadsheet ID and tab name only, never auth tokens)
  const [linkedSheetMeta, setLinkedSheetMeta] = useState<{
    spreadsheetId: string | null;
    title: string | null;
    tabTitle: string | null;
  }>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SHEET_META);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          spreadsheetId:
            typeof parsed.spreadsheetId === 'string' ? parsed.spreadsheetId : null,
          title: typeof parsed.title === 'string' ? parsed.title : null,
          tabTitle: typeof parsed.tabTitle === 'string' ? parsed.tabTitle : null,
        };
      }
    } catch {
      // ignore
    }
    return { spreadsheetId: null, title: null, tabTitle: null };
  });
  const [lastTableSheetExport, setLastTableSheetExport] = useState<{
    title: string;
    url: string;
  } | null>(null);
  const [isExportingTableSheet, setIsExportingTableSheet] = useState(false);

  // Automatic Drive Folder Bridge (Google Apps Script proxy — no Google Sign-In required)
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatusResponse | null>(
    null
  );
  const [bridgeDiagnosticReport, setBridgeDiagnosticReport] =
    useState<BridgeDiagnosticReport | null>(null);
  const [checkingBridge, setCheckingBridge] = useState(false);
  const [bridgeConfig, setBridgeConfig] = useState<BridgeConfig>(loadBridgeConfig);
  const [bridgeSyncState, setBridgeSyncState] = useState<BridgeSyncState>('idle');
  const [bridgeLastSyncedAt, setBridgeLastSyncedAt] = useState<string | null>(
    () => loadBridgeConfig().lastSyncedAt
  );
  const [bridgeLastError, setBridgeLastError] = useState<string | null>(null);
  const [lastSyncedSignature, setLastSyncedSignature] = useState<string | null>(
    null
  );
  const lastSyncedSignatureRef = useRef<string | null>(null);
  const pendingAutoSyncTimerRef = useRef<number | null>(null);
  const masterSyncInFlightRef = useRef<boolean>(false);

  // App User Directory & Mandatory Login Session state
  const [users, setUsers] = useState<AppUser[]>(loadStoredUsers);
  const [usersReady, setUsersReady] = useState<boolean>(false);
  const [activeUserId, setActiveUserId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY_ACTIVE_USER);
    } catch {
      return null;
    }
  });

  // Filters & display mode
  const [ledgerMode, setLedgerMode] = useState<LedgerDisplayMode>('table');
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [archiveSweepTick, setArchiveSweepTick] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'ALL' | 'OVERDUE'>('ALL');
  const [userFilter, setUserFilter] = useState<string>('ALL');

  // Modals & drawers
  const [confirmRequest, setConfirmRequest] = useState<ConfirmDialogRequest | null>(
    null
  );
  const [drivePickerTarget, setDrivePickerTarget] = useState<{
    taskId: string;
    slNo: number;
  } | null>(null);
  const [detailDrawerTarget, setDetailDrawerTarget] = useState<{
    taskId: string;
    slNo: number;
  } | null>(null);

  // Global Admin Audit Log
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(loadAuditLogs);
  const currentAppUserRef = useRef<AppUser | null>(null);
  const tasksRef = useRef<TaskRow[]>(tasks);
  tasksRef.current = tasks;

  // Debounce buffer so rapid inline text edits coalesce into one clean audit entry per field
  const pendingFieldEditsRef = useRef<
    Map<
      string,
      {
        timerId: number;
        taskLabel: string;
        fieldLabel: string;
        fromValue: string;
        toValue: string;
        actorUsername: string;
        actorName: string;
        actorRole: 'admin' | 'user' | 'system';
      }
    >
  >(new Map());

  // Toast notice
  const [notice, setNotice] = useState<{
    message: string;
    tone: 'info' | 'error';
  } | null>(null);

  const notify = useCallback((message: string, tone: 'info' | 'error' = 'info') => {
    setNotice({ message, tone });
  }, []);

  const recordAudit = useCallback(
    (entry: {
      category: AuditCategory;
      action: string;
      details: string;
      target?: string;
      severity?: AuditSeverity;
      actor?: {
        username: string;
        name: string;
        role?: 'admin' | 'user' | 'system';
      };
      metadata?: Record<string, string | number | boolean>;
    }) => {
      const activeActor = currentAppUserRef.current;
      const actorUsername =
        entry.actor?.username ?? activeActor?.username ?? 'system';
      const actorName =
        entry.actor?.name ??
        activeActor?.fullName ??
        activeActor?.username ??
        'System';
      const actorRole =
        entry.actor?.role ?? activeActor?.role ?? 'system';

      const created = createAuditEntry({
        category: entry.category,
        action: entry.action,
        actorUsername,
        actorName,
        actorRole,
        target: entry.target,
        details: entry.details,
        severity: entry.severity ?? 'info',
        metadata: entry.metadata,
      });

      setAuditLogs((prev) => [created, ...prev].slice(0, MAX_AUDIT_LOG_ENTRIES));
    },
    []
  );

  // Persist audit log entries locally
  useEffect(() => {
    saveAuditLogs(auditLogs);
  }, [auditLogs]);

  // Clear pending field-edit timers on unmount
  useEffect(() => {
    const pending = pendingFieldEditsRef.current;
    return () => {
      pending.forEach((item) => window.clearTimeout(item.timerId));
      pending.clear();
    };
  }, []);

  const handleClearAuditLogs = useCallback(() => {
    const activeActor = currentAppUserRef.current;
    const resetEntry = createAuditEntry({
      category: 'user',
      action: 'Audit Log Cleared',
      actorUsername: activeActor?.username || 'admin',
      actorName: activeActor?.fullName || activeActor?.username || 'Admin',
      actorRole: activeActor?.role || 'admin',
      details: 'Cleared prior audit history from Settings.',
      severity: 'warning',
    });
    setAuditLogs([resetEntry]);
    notify('Cleared audit log history.');
  }, [notify]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Persist task ledger & currency locally
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(tasks));
    } catch {
      // ignore storage quota errors
    }
  }, [tasks]);

  // Background ticker for automatic 30-day archiving (runs every 60s & when tab becomes visible)
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setArchiveSweepTick((n) => n + 1);
    }, 60_000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setArchiveSweepTick((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Background auto-archive sweep: move Completed tasks older than 30 days into Archive
  useEffect(() => {
    const nowMs = Date.now();
    const eligibleTasks = tasks.filter((row) => shouldAutoArchiveTask(row, nowMs));
    const eligibleIds = eligibleTasks.map((row) => row.id);

    if (eligibleIds.length === 0) return;

    const idSet = new Set(eligibleIds);
    const archivedAtIso = new Date(nowMs).toISOString();
    const autoActivity: TaskComment = {
      id: crypto.randomUUID(),
      parentId: null,
      authorUsername: 'system',
      authorName: 'Auto-Archive',
      body: `automatically archived (completed over ${ARCHIVE_AFTER_DAYS} days ago)`,
      mentions: [],
      createdAt: archivedAtIso,
      kind: 'activity',
    };

    setTasks((prev) =>
      prev.map((row) =>
        idSet.has(row.id)
          ? {
              ...row,
              isArchived: true,
              archivedAt: archivedAtIso,
              comments: [...(row.comments ?? []), { ...autoActivity, id: crypto.randomUUID() }],
            }
          : row
      )
    );

    const previewLabels = eligibleTasks
      .slice(0, 3)
      .map((t) => getTaskAuditLabel(t))
      .join(', ');
    recordAudit({
      category: 'archive',
      action: 'Auto-Archive Sweep',
      actor: { username: 'system', name: 'Auto-Archive Scheduler', role: 'system' },
      target: `${eligibleIds.length} ${eligibleIds.length === 1 ? 'task' : 'tasks'}`,
      details: `Automatically archived ${eligibleIds.length} completed ${
        eligibleIds.length === 1 ? 'task' : 'tasks'
      } older than ${ARCHIVE_AFTER_DAYS} days (${previewLabels}${
        eligibleIds.length > 3 ? ` +${eligibleIds.length - 3} more` : ''
      }).`,
      severity: 'info',
      metadata: {
        'Archived Count': eligibleIds.length,
        'Threshold Days': ARCHIVE_AFTER_DAYS,
      },
    });

    notify(
      `Auto-archived ${eligibleIds.length} completed ${
        eligibleIds.length === 1 ? 'task' : 'tasks'
      } older than ${ARCHIVE_AFTER_DAYS} days.`
    );
  }, [tasks, archiveSweepTick, notify, recordAudit]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CURRENCY, currencySymbol);
    } catch {
      // ignore
    }
  }, [currencySymbol]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY_SYNC_META,
        JSON.stringify({
          fileId: syncedDriveFileId,
          fileName: syncedDriveFileName,
        })
      );
    } catch {
      // ignore
    }
  }, [syncedDriveFileId, syncedDriveFileName]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SHEET_META, JSON.stringify(linkedSheetMeta));
    } catch {
      // ignore
    }
  }, [linkedSheetMeta]);

  useEffect(() => {
    saveBridgeConfig(bridgeConfig);
  }, [bridgeConfig]);

  const handleUpdateBridgeConfig = useCallback(
    (patch: Partial<BridgeConfig>) => {
      setBridgeConfig((prev) => {
        const next = { ...prev, ...patch };
        if (
          typeof patch.autoSyncEnabled === 'boolean' &&
          patch.autoSyncEnabled !== prev.autoSyncEnabled
        ) {
          recordAudit({
            category: 'bridge',
            action: patch.autoSyncEnabled
              ? 'Auto-Sync Enabled'
              : 'Auto-Sync Paused',
            target: next.masterSheetTitle,
            details: patch.autoSyncEnabled
              ? 'Enabled automatic Master Google Sheet syncing on task edits.'
              : 'Paused automatic Master Google Sheet syncing (manual snapshots remain active).',
            severity: patch.autoSyncEnabled ? 'success' : 'warning',
          });
        }
        if (
          typeof patch.debounceSeconds === 'number' &&
          patch.debounceSeconds !== prev.debounceSeconds
        ) {
          recordAudit({
            category: 'bridge',
            action: 'Bridge Delay Updated',
            target: next.masterSheetTitle,
            details: `Changed automatic bridge sync delay from ${prev.debounceSeconds}s to ${patch.debounceSeconds}s.`,
            severity: 'info',
            metadata: {
              'Previous Delay': `${prev.debounceSeconds}s`,
              'New Delay': `${patch.debounceSeconds}s`,
            },
          });
        }
        return next;
      });
    },
    [recordAudit]
  );

  const refreshBridgeStatus = useCallback(
    async (showFeedback = false) => {
      setCheckingBridge(true);
      try {
        const status = await fetchBridgeStatus(true);
        setBridgeStatus(status);
        if (showFeedback) {
          recordAudit({
            category: 'bridge',
            action: 'Bridge Connection Tested',
            target: status.folderName || status.folderId,
            details: status.connected
              ? `Verified connection to Google Drive folder "${status.folderName || status.folderId}" via Apps Script bridge.`
              : status.error ||
                status.message ||
                'Apps Script bridge is not configured on the server yet.',
            severity: status.connected
              ? 'success'
              : status.configured
                ? 'error'
                : 'warning',
            metadata: {
              'Folder ID': status.folderId,
              Configured: status.configured,
              Connected: status.connected,
            },
          });
          if (status.connected) {
            notify(
              `Connected to Drive folder${
                status.folderName ? ` "${status.folderName}"` : ''
              } via Apps Script bridge.`
            );
          } else {
            notify(
              status.error ||
                status.message ||
                'Apps Script bridge is not configured on the server yet.',
              status.configured ? 'error' : 'info'
            );
          }
        }
      } finally {
        setCheckingBridge(false);
      }
    },
    [notify, recordAudit]
  );

  const handleCheckBridgeConnection = useCallback(async () => {
    setCheckingBridge(true);
    try {
      const report = await runBridgeDiagnostics();
      setBridgeDiagnosticReport(report);
      const isConfigured = report.code !== 'missing_server_env';
      setBridgeStatus({
        configured: isConfigured,
        connected: report.ok,
        folderId: report.folderId,
        folderUrl: report.folderUrl,
        folderName: report.folderName,
        error: report.ok ? undefined : report.summary,
        message: report.ok ? undefined : report.summary,
        checkedAt: report.checkedAt,
      });

      const secretStep = report.steps.find((s) => s.id === 'bridge_secret');
      recordAudit({
        category: 'bridge',
        action: 'Bridge Connection Checked',
        target: report.folderName || report.folderId,
        details: report.summary,
        severity: report.ok
          ? 'success'
          : report.code === 'missing_server_env'
            ? 'warning'
            : 'error',
        metadata: {
          'Diagnostic Code': report.code,
          'BRIDGE_SECRET Check': secretStep?.status || 'skipped',
          'Response Time': `${report.durationMs}ms`,
          'Folder ID': report.folderId,
        },
      });

      notify(report.summary, report.ok ? 'info' : 'error');
    } finally {
      setCheckingBridge(false);
    }
  }, [notify, recordAudit]);

  // Check server-side Apps Script bridge status once on load
  useEffect(() => {
    refreshBridgeStatus(false);
  }, [refreshBridgeStatus]);

  // Build deterministic signature of active tasks for debounced Master Sheet auto-sync
  const activeTasksForMasterSync = useMemo(() => {
    const active = tasks.filter((row) => !row.isArchived);
    const populated = active.filter(isRowPopulated);
    return populated.length > 0 ? populated : active;
  }, [tasks]);

  const masterSyncSignature = useMemo(
    () =>
      JSON.stringify({
        title: bridgeConfig.masterSheetTitle,
        rows: activeTasksForMasterSync.map((r) => [
          r.elInvoiceId,
          r.clientName,
          r.companyName,
          r.taskName,
          r.taskBy,
          r.taskStatus,
          r.dueDate,
          r.taskPrice,
          r.paidReceiveAmount,
          r.noteForPaidReceive,
          r.driveLink,
          r.assignedUser,
          r.actionToDo,
        ]),
      }),
    [activeTasksForMasterSync, bridgeConfig.masterSheetTitle]
  );

  const hasPendingMasterChanges = Boolean(
    bridgeStatus?.connected &&
      lastSyncedSignature !== null &&
      lastSyncedSignature !== masterSyncSignature
  );

  const performMasterSheetSync = useCallback(
    async (manualTrigger = false): Promise<boolean> => {
      if (masterSyncInFlightRef.current) {
        return false;
      }

      if (pendingAutoSyncTimerRef.current !== null) {
        window.clearTimeout(pendingAutoSyncTimerRef.current);
        pendingAutoSyncTimerRef.current = null;
      }

      if (!manualTrigger && !bridgeStatus?.connected) {
        return false;
      }

      if (manualTrigger && !bridgeStatus?.configured) {
        const notConfiguredMsg =
          'Automatic Drive Folder Bridge is not configured on the server yet. Open Settings to finish setup.';
        setBridgeSyncState('error');
        setBridgeLastError(notConfiguredMsg);
        notify(notConfiguredMsg, 'error');
        return false;
      }

      masterSyncInFlightRef.current = true;
      setBridgeSyncState('syncing');
      setBridgeLastError(null);
      try {
        const result = await syncMasterSheetViaBridge({
          tasks: activeTasksForMasterSync,
          masterSheetTitle: bridgeConfig.masterSheetTitle,
          masterSheetId: bridgeConfig.masterSheetId,
        });
        lastSyncedSignatureRef.current = masterSyncSignature;
        setLastSyncedSignature(masterSyncSignature);
        setBridgeSyncState('synced');
        setBridgeLastSyncedAt(result.syncedAt);
        setBridgeStatus((prev) =>
          prev
            ? {
                ...prev,
                configured: true,
                connected: true,
                error: undefined,
                checkedAt: result.syncedAt,
              }
            : prev
        );
        setBridgeConfig((prev) => ({
          ...prev,
          masterSheetId: result.spreadsheetId || prev.masterSheetId,
          masterSheetUrl: result.spreadsheetUrl || prev.masterSheetUrl,
          lastSyncedAt: result.syncedAt || prev.lastSyncedAt,
        }));
        recordAudit({
          category: 'bridge',
          action: manualTrigger
            ? 'Manual Master Sheet Sync'
            : 'Auto Master Sheet Sync',
          actor: manualTrigger
            ? undefined
            : { username: 'system', name: 'Auto-Sync Bridge', role: 'system' },
          target: result.title,
          details: `${
            manualTrigger ? 'Manually synced' : 'Automatically synced'
          } ${result.rowCount} active ${
            result.rowCount === 1 ? 'row' : 'rows'
          } to Master Google Sheet "${result.title}".`,
          severity: 'success',
          metadata: {
            Trigger: manualTrigger ? 'Manual' : 'Automatic (Debounced)',
            'Row Count': result.rowCount,
            'Spreadsheet ID': result.spreadsheetId || 'N/A',
            'Folder ID': bridgeStatus?.folderId || DEFAULT_TARGET_DRIVE_FOLDER_ID,
          },
        });
        if (manualTrigger) {
          notify(`Synced "${result.title}" (${result.rowCount} rows) to Master Sheet.`);
        }
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Master Sheet sync failed.';
        setBridgeSyncState('error');
        setBridgeLastError(message);
        recordAudit({
          category: 'bridge',
          action: manualTrigger
            ? 'Manual Master Sheet Sync Failed'
            : 'Auto Master Sheet Sync Failed',
          actor: manualTrigger
            ? undefined
            : { username: 'system', name: 'Auto-Sync Bridge', role: 'system' },
          target: bridgeConfig.masterSheetTitle,
          details: message,
          severity: 'error',
          metadata: {
            Trigger: manualTrigger ? 'Manual' : 'Automatic (Debounced)',
            'Attempted Rows': activeTasksForMasterSync.length,
          },
        });
        if (manualTrigger) {
          notify(message, 'error');
        }
        return false;
      } finally {
        masterSyncInFlightRef.current = false;
      }
    },
    [
      bridgeStatus?.configured,
      bridgeStatus?.connected,
      bridgeStatus?.folderId,
      activeTasksForMasterSync,
      bridgeConfig.masterSheetTitle,
      bridgeConfig.masterSheetId,
      masterSyncSignature,
      notify,
      recordAudit,
    ]
  );

  // Bootstrap user directory (syncing localStorage with persistent server store /api/users)
  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      let serverUsers: AppUser[] = [];
      try {
        const res = await fetch('/api/users');
        if (res.ok) {
          const data = (await res.json()) as { users?: AppUser[] };
          if (Array.isArray(data.users)) {
            serverUsers = data.users;
          }
        }
      } catch {
        // ignore offline
      }

      if (cancelled) return;

      const localUsers = loadStoredUsers();
      const mergedMap = new Map<string, AppUser>();
      for (const u of serverUsers) {
        if (u && typeof u.username === 'string') {
          mergedMap.set(u.username.toLowerCase(), u);
        }
      }
      for (const u of localUsers) {
        if (u && typeof u.username === 'string' && !mergedMap.has(u.username.toLowerCase())) {
          mergedMap.set(u.username.toLowerCase(), u);
        }
      }

      let finalUsers = Array.from(mergedMap.values());
      if (finalUsers.length === 0) {
        const defaultAdmin = await createDefaultAdminUser();
        if (cancelled) return;
        finalUsers = [defaultAdmin];
      }

      setUsers(finalUsers);
      setUsersReady(true);
    };
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist user accounts to localStorage and server /api/users
  useEffect(() => {
    if (!usersReady || users.length === 0) return;
    try {
      localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
    } catch {
      // ignore
    }
    fetch('/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ users }),
    }).catch(() => {});
  }, [users, usersReady]);

  // Resolve currently authenticated app user (sign-in is strictly required)
  const currentAppUser = useMemo<AppUser | null>(() => {
    if (!usersReady || !activeUserId) return null;
    return users.find((u) => u.id === activeUserId && u.isActive) || null;
  }, [users, usersReady, activeUserId]);

  currentAppUserRef.current = currentAppUser;

  const isAdmin = currentAppUser?.role === 'admin';

  // Debounced automatic Master Sheet sync whenever tasks change and bridge is connected
  useEffect(() => {
    if (!currentAppUser) return;
    if (!bridgeStatus?.connected || !bridgeConfig.autoSyncEnabled) return;
    if (lastSyncedSignatureRef.current === masterSyncSignature) return;

    const delayMs = Math.max(1, bridgeConfig.debounceSeconds) * 1000;
    const timerId = window.setTimeout(() => {
      pendingAutoSyncTimerRef.current = null;
      performMasterSheetSync(false);
    }, delayMs);
    pendingAutoSyncTimerRef.current = timerId;

    return () => {
      window.clearTimeout(timerId);
      if (pendingAutoSyncTimerRef.current === timerId) {
        pendingAutoSyncTimerRef.current = null;
      }
    };
  }, [
    currentAppUser,
    bridgeStatus?.connected,
    bridgeConfig.autoSyncEnabled,
    bridgeConfig.debounceSeconds,
    masterSyncSignature,
    performMasterSheetSync,
  ]);

  // Ensure non-admins only access the Task Ledger view
  useEffect(() => {
    if (currentAppUser && !isAdmin && activeView !== 'ledger') {
      setActiveView('ledger');
    }
  }, [currentAppUser, isAdmin, activeView]);

  const handleAppUserAuthenticated = (authenticated: AppUser) => {
    setActiveUserId(authenticated.id);
    setUserFilter('ALL');
    setActiveView('ledger');
    try {
      sessionStorage.setItem(SESSION_KEY_ACTIVE_USER, authenticated.id);
    } catch {
      // ignore
    }
    recordAudit({
      category: 'user',
      action: 'User Signed In',
      actor: {
        username: authenticated.username,
        name: authenticated.fullName || authenticated.username,
        role: authenticated.role,
      },
      target: authenticated.username,
      details: `Signed into workspace as ${authenticated.username} (${
        authenticated.role === 'admin' ? 'Admin' : 'Standard User'
      }).`,
      severity: 'success',
    });
    notify(`Signed in as ${authenticated.username}.`);
  };

  const handleSwitchAppUser = () => {
    if (currentAppUser) {
      recordAudit({
        category: 'user',
        action: 'User Signed Out',
        actor: {
          username: currentAppUser.username,
          name: currentAppUser.fullName || currentAppUser.username,
          role: currentAppUser.role,
        },
        target: currentAppUser.username,
        details: `Signed out of workspace session.`,
        severity: 'info',
      });
    }
    setActiveUserId(null);
    setDetailDrawerTarget(null);
    setDrivePickerTarget(null);
    try {
      sessionStorage.removeItem(SESSION_KEY_ACTIVE_USER);
    } catch {
      // ignore
    }
  };

  const handleAddAppUser = (newUser: AppUser) => {
    setUsers((prev) => [...prev, newUser]);
    recordAudit({
      category: 'user',
      action: 'User Account Created',
      target: newUser.username,
      details: `Created ${
        newUser.role === 'admin' ? 'Admin' : 'Standard User'
      } account "${newUser.username}" (${newUser.fullName}).`,
      severity: 'success',
      metadata: {
        Role: newUser.role === 'admin' ? 'Admin' : 'Standard User',
        'Full Name': newUser.fullName,
      },
    });
  };

  const handleUpdateAppUser = (userId: string, patch: Partial<AppUser>) => {
    const existing = users.find((u) => u.id === userId);
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, ...patch } : u))
    );
    if (!existing) return;

    // Cascade username rename across any tagged tasks
    if (
      patch.username &&
      patch.username.trim().toLowerCase() !== existing.username.trim().toLowerCase()
    ) {
      const oldLower = existing.username.trim().toLowerCase();
      const newClean = patch.username.trim();
      setTasks((prev) =>
        prev.map((row) =>
          (row.assignedUser || '').trim().toLowerCase() === oldLower
            ? { ...row, assignedUser: newClean, actionToDo: newClean }
            : row
        )
      );
    }

    if (patch.passwordHash && !patch.username && !patch.fullName && !patch.role) {
      recordAudit({
        category: 'user',
        action: 'User Password Reset',
        target: existing.username,
        details: `Reset login password for account "${existing.username}".`,
        severity: 'warning',
      });
    } else if (
      typeof patch.isActive === 'boolean' &&
      !patch.username &&
      !patch.fullName &&
      !patch.role
    ) {
      recordAudit({
        category: 'user',
        action: patch.isActive
          ? 'User Account Enabled'
          : 'User Account Disabled',
        target: existing.username,
        details: patch.isActive
          ? `Re-enabled login access for "${existing.username}".`
          : `Disabled login access for "${existing.username}".`,
        severity: patch.isActive ? 'success' : 'warning',
      });
    } else {
      recordAudit({
        category: 'user',
        action: 'User Account Updated',
        target: patch.username || existing.username,
        details: `Updated user account "${existing.username}"${
          patch.username && patch.username !== existing.username
            ? ` → "${patch.username}"`
            : ''
        } (${(patch.role || existing.role) === 'admin' ? 'Admin' : 'Standard User'}).`,
        severity: 'info',
      });
    }
  };

  const handleDeleteAppUser = (userId: string) => {
    const existing = users.find((u) => u.id === userId);
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    if (existing) {
      recordAudit({
        category: 'user',
        action: 'User Account Deleted',
        target: existing.username,
        details: `Deleted account "${existing.username}" (${existing.fullName}) from Settings.`,
        severity: 'warning',
      });
    }
  };

  // Initialize Firebase Auth listener
  useEffect(() => {
    const unsubscribe = initAuth(
      (authenticatedUser) => {
        setUser(authenticatedUser);
        setNeedsAuth(false);
      },
      () => {
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

  const isSignedIn = !needsAuth && user !== null;

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setNeedsAuth(false);
        recordAudit({
          category: 'user',
          action: 'Google Workspace Connected',
          target: result.user.email || result.user.displayName || 'Google Account',
          details: `Authenticated Google Workspace session for ${
            result.user.email || result.user.displayName
          }.`,
          severity: 'success',
        });
        notify(
          `Connected Google Workspace as ${result.user.email || result.user.displayName}.`
        );
      } else {
        notify('Google sign-in was cancelled. Click Sign in with Google whenever you are ready.');
      }
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Google sign-in failed. Please try again.',
        'error'
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setNeedsAuth(true);
    recordAudit({
      category: 'user',
      action: 'Google Workspace Disconnected',
      details: 'Signed out of Google Drive / Sheets Workspace session.',
      severity: 'info',
    });
    notify('Signed out of Google Drive.');
  };

  const handleSessionExpired = useCallback(() => {
    clearAccessToken();
    setNeedsAuth(true);
    notify('Your Google Drive session expired. Please sign in again.', 'error');
  }, [notify]);

  const createActivityEntry = useCallback(
    (body: string, mentions: string[] = []): TaskComment => ({
      id: crypto.randomUUID(),
      parentId: null,
      authorUsername: currentAppUser?.username || 'system',
      authorName: currentAppUser?.fullName || currentAppUser?.username || 'System',
      body,
      mentions,
      createdAt: new Date().toISOString(),
      kind: 'activity',
    }),
    [currentAppUser]
  );

  const handleUpdateField = useCallback(
    <K extends keyof TaskRow>(taskId: string, field: K, value: TaskRow[K]) => {
      const currentRow = tasksRef.current.find((r) => r.id === taskId);
      if (currentRow && currentRow[field] !== value) {
        const prevStr = String(currentRow[field] ?? '').trim();
        const nextStr = String(value ?? '').trim();
        const taskLabel = getTaskAuditLabel({ ...currentRow, [field]: value });
        const fieldLabel = TASK_FIELD_LABELS[field] || String(field);

        if (field === 'taskStatus') {
          recordAudit({
            category: 'task',
            action: 'Task Status Updated',
            target: taskLabel,
            details: `Changed Task Status from "${prevStr || 'Unassigned'}" to "${
              nextStr || 'Unassigned'
            }".`,
            severity: nextStr === 'Completed' ? 'success' : 'info',
            metadata: {
              Field: 'Task Status',
              Previous: prevStr || 'Unassigned',
              New: nextStr || 'Unassigned',
            },
          });
        } else if (field === 'dueDate') {
          recordAudit({
            category: 'task',
            action: 'Due Date Updated',
            target: taskLabel,
            details: nextStr
              ? `Updated Due Date from "${prevStr || 'None'}" to "${nextStr}".`
              : `Cleared Due Date (was "${prevStr}").`,
            severity: 'info',
          });
        } else if (field === 'assignedUser') {
          recordAudit({
            category: 'task',
            action: 'Assignee Updated',
            target: taskLabel,
            details: nextStr
              ? `Tagged @${nextStr} in Action to Do${
                  prevStr ? ` (was @${prevStr})` : ''
                }.`
              : `Removed assigned user @${prevStr}.`,
            severity: 'info',
          });
        } else {
          // Debounce inline text / amount fields so typing creates one clean entry
          const editKey = `${taskId}:${String(field)}`;
          const existingPending = pendingFieldEditsRef.current.get(editKey);
          const initialFrom = existingPending ? existingPending.fromValue : prevStr;
          if (existingPending) {
            window.clearTimeout(existingPending.timerId);
          }

          const activeActor = currentAppUserRef.current;
          const actorUsername = activeActor?.username ?? 'system';
          const actorName =
            activeActor?.fullName ?? activeActor?.username ?? 'System';
          const actorRole = activeActor?.role ?? 'system';

          const timerId = window.setTimeout(() => {
            const finalized = pendingFieldEditsRef.current.get(editKey);
            pendingFieldEditsRef.current.delete(editKey);
            if (!finalized || finalized.fromValue === finalized.toValue) return;
            recordAudit({
              category: 'task',
              action: `Task ${finalized.fieldLabel} Edited`,
              actor: {
                username: finalized.actorUsername,
                name: finalized.actorName,
                role: finalized.actorRole,
              },
              target: finalized.taskLabel,
              details: `Updated ${finalized.fieldLabel} from "${
                finalized.fromValue || 'empty'
              }" to "${finalized.toValue || 'empty'}".`,
              severity: 'info',
              metadata: {
                Field: finalized.fieldLabel,
                Previous: finalized.fromValue || '(empty)',
                New: finalized.toValue || '(empty)',
              },
            });
          }, 1400);

          pendingFieldEditsRef.current.set(editKey, {
            timerId,
            taskLabel,
            fieldLabel,
            fromValue: initialFrom,
            toValue: nextStr,
            actorUsername,
            actorName,
            actorRole,
          });
        }
      }

      setTasks((prev) =>
        prev.map((row) => {
          if (row.id !== taskId) return row;
          const prevVal = row[field];
          if (prevVal === value) return row;

          let activity: TaskComment | null = null;
          if (field === 'taskStatus') {
            const nextStatus = String(value || 'Unassigned');
            const prevStatus = String(prevVal || 'Unassigned');
            activity = createActivityEntry(
              `changed status from ${prevStatus} to ${nextStatus}`
            );
          } else if (field === 'dueDate') {
            const nextDate = String(value || '');
            activity = createActivityEntry(
              nextDate ? `set due date to ${nextDate}` : 'cleared the due date'
            );
          } else if (field === 'assignedUser') {
            const nextUser = String(value || '');
            activity = createActivityEntry(
              nextUser
                ? `tagged @${nextUser} in Action to Do`
                : 'removed the assigned user tag',
              nextUser ? [nextUser] : []
            );
          }

          const statusPatch: Partial<TaskRow> =
            field === 'taskStatus'
              ? value === 'Completed'
                ? {
                    completedAt: new Date().toISOString(),
                    archiveExempt: false,
                  }
                : {
                    completedAt: undefined,
                    archiveExempt: false,
                  }
              : {};

          return {
            ...row,
            [field]: value,
            ...statusPatch,
            comments: activity ? [...(row.comments ?? []), activity] : row.comments ?? [],
          };
        })
      );
    },
    [createActivityEntry, recordAudit]
  );

  const handleBulkUpdateStatus = useCallback(
    (taskIds: string[], nextStatus: TaskStatus) => {
      if (taskIds.length === 0) return;
      const idSet = new Set(taskIds);
      const nextLabel = nextStatus || 'Unassigned';
      const nowIso = new Date().toISOString();

      setTasks((prev) =>
        prev.map((row) => {
          if (!idSet.has(row.id)) return row;
          if (row.taskStatus === nextStatus) return row;
          const prevLabel = row.taskStatus || 'Unassigned';
          const activity = createActivityEntry(
            `changed status from ${prevLabel} to ${nextLabel} (bulk update)`
          );
          return {
            ...row,
            taskStatus: nextStatus,
            completedAt: nextStatus === 'Completed' ? nowIso : undefined,
            archiveExempt: false,
            comments: [...(row.comments ?? []), activity],
          };
        })
      );

      const count = taskIds.length;
      recordAudit({
        category: 'task',
        action: 'Bulk Status Update',
        target: `${count} ${count === 1 ? 'task' : 'tasks'}`,
        details: `Updated Task Status of ${count} selected ${
          count === 1 ? 'task' : 'tasks'
        } to "${nextLabel}".`,
        severity: nextStatus === 'Completed' ? 'success' : 'info',
        metadata: {
          'Updated Count': count,
          'Target Status': nextLabel,
        },
      });
      notify(
        `Updated status of ${count} ${count === 1 ? 'task' : 'tasks'} to ${nextLabel}.`
      );
    },
    [createActivityEntry, notify, recordAudit]
  );

  const handleAttachDriveItem = useCallback(
    (
      taskId: string,
      payload: {
        driveLink: string;
        driveFileId?: string;
        driveFileName?: string;
        driveMimeType?: string;
      }
    ) => {
      const targetRow = tasksRef.current.find((r) => r.id === taskId);
      setTasks((prev) =>
        prev.map((row) => {
          if (row.id !== taskId) return row;
          const activity = createActivityEntry(
            payload.driveLink
              ? `attached Google Drive link "${payload.driveFileName || payload.driveLink}"`
              : 'removed the Google Drive link'
          );
          return {
            ...row,
            driveLink: payload.driveLink,
            driveFileId: payload.driveFileId,
            driveFileName: payload.driveFileName,
            driveMimeType: payload.driveMimeType,
            comments: [...(row.comments ?? []), activity],
          };
        })
      );
      recordAudit({
        category: 'task',
        action: payload.driveLink
          ? 'Drive Link Attached'
          : 'Drive Link Removed',
        target: getTaskAuditLabel(targetRow),
        details: payload.driveLink
          ? `Attached Google Drive item "${payload.driveFileName || payload.driveLink}".`
          : 'Removed linked Google Drive URL from task.',
        severity: 'info',
      });
    },
    [createActivityEntry, recordAudit]
  );

  const handleAddComment = useCallback(
    (
      taskId: string,
      payload: { body: string; parentId: string | null; mentions: string[] }
    ) => {
      if (!currentAppUser) return;
      const targetRow = tasksRef.current.find((r) => r.id === taskId);
      const newComment: TaskComment = {
        id: crypto.randomUUID(),
        parentId: payload.parentId,
        authorUsername: currentAppUser.username,
        authorName: currentAppUser.fullName || currentAppUser.username,
        body: payload.body,
        mentions: payload.mentions,
        createdAt: new Date().toISOString(),
        kind: 'comment',
      };
      setTasks((prev) =>
        prev.map((row) =>
          row.id === taskId
            ? { ...row, comments: [...(row.comments ?? []), newComment] }
            : row
        )
      );
      const preview =
        payload.body.length > 90
          ? `${payload.body.slice(0, 90)}...`
          : payload.body;
      recordAudit({
        category: 'task',
        action: payload.parentId ? 'Comment Reply Posted' : 'Task Comment Posted',
        target: getTaskAuditLabel(targetRow),
        details: `Posted comment: "${preview}"${
          payload.mentions.length > 0
            ? ` (tagged ${payload.mentions.map((m) => `@${m}`).join(', ')})`
            : ''
        }`,
        severity: 'info',
      });
      if (payload.mentions.length > 0) {
        notify(`Comment posted and tagged ${payload.mentions.map((m) => `@${m}`).join(', ')}.`);
      }
    },
    [currentAppUser, notify, recordAudit]
  );

  const handleDeleteComment = useCallback(
    (taskId: string, commentId: string) => {
      const targetRow = tasksRef.current.find((r) => r.id === taskId);
      setTasks((prev) =>
        prev.map((row) =>
          row.id === taskId
            ? {
                ...row,
                comments: (row.comments ?? []).filter(
                  (c) => c.id !== commentId && c.parentId !== commentId
                ),
              }
            : row
        )
      );
      recordAudit({
        category: 'task',
        action: 'Task Comment Deleted',
        target: getTaskAuditLabel(targetRow),
        details: 'Removed a comment from the task activity thread.',
        severity: 'warning',
      });
      notify('Removed comment.');
    },
    [notify, recordAudit]
  );

  const handleAddRow = () => {
    const defaultAssigned =
      currentAppUser && currentAppUser.role !== 'admin'
        ? currentAppUser.username
        : userFilter !== 'ALL' && userFilter !== 'UNASSIGNED'
          ? userFilter
          : '';
    setTasks((prev) => [...prev, createEmptyTaskRow(defaultAssigned)]);
    recordAudit({
      category: 'task',
      action: 'Task Row Added',
      target: defaultAssigned ? `@${defaultAssigned}` : 'Task Ledger',
      details: defaultAssigned
        ? `Added a new task row pre-assigned to @${defaultAssigned}.`
        : 'Added a new blank row to the Task Ledger.',
      severity: 'info',
    });
  };

  const handleAddTaskInStatus = (status: TaskStatus) => {
    const defaultAssigned =
      currentAppUser && currentAppUser.role !== 'admin'
        ? currentAppUser.username
        : userFilter !== 'ALL' && userFilter !== 'UNASSIGNED'
          ? userFilter
          : '';
    const newRow: TaskRow = {
      ...createEmptyTaskRow(defaultAssigned),
      taskStatus: status,
      completedAt: status === 'Completed' ? new Date().toISOString() : undefined,
    };
    const nextSlNo = activeAuthorizedTasks.length + 1;
    setTasks((prev) => [...prev, newRow]);
    setDetailDrawerTarget({ taskId: newRow.id, slNo: nextSlNo });
    recordAudit({
      category: 'task',
      action: 'Task Created on Board',
      target: status || 'Not Started',
      details: `Created new task card in "${status || 'Not Started'}" column${
        defaultAssigned ? ` assigned to @${defaultAssigned}` : ''
      }.`,
      severity: 'info',
    });
  };

  const handleMoveTaskStatus = useCallback(
    (taskId: string, nextStatus: TaskStatus) => {
      const target = tasks.find((t) => t.id === taskId);
      const prevStatus = target?.taskStatus || 'Not Started';
      const nowIso = new Date().toISOString();
      const activity = createActivityEntry(
        `moved task from ${prevStatus} to ${nextStatus || 'Not Started'}`
      );
      setTasks((prev) =>
        prev.map((row) =>
          row.id === taskId
            ? {
                ...row,
                taskStatus: nextStatus,
                completedAt: nextStatus === 'Completed' ? nowIso : undefined,
                archiveExempt: false,
                comments: [...(row.comments ?? []), activity],
              }
            : row
        )
      );
      const label = target?.taskName.trim() || target?.elInvoiceId.trim() || 'Task';
      recordAudit({
        category: 'task',
        action: 'Task Moved (Board)',
        target: getTaskAuditLabel(target),
        details: `Moved "${label}" from "${prevStatus}" to "${
          nextStatus || 'Not Started'
        }".`,
        severity: nextStatus === 'Completed' ? 'success' : 'info',
      });
      notify(`Moved "${label}" to ${nextStatus || 'Not Started'}.`);
    },
    [tasks, notify, createActivityEntry, recordAudit]
  );

  const handleCloneRecurringTask = (
    sourceTask: TaskRow,
    sourceSlNo: number,
    options: {
      elInvoiceId: string;
      taskName: string;
      dueDate: string;
      resetPayment: boolean;
      keepDriveLink: boolean;
    }
  ) => {
    const sourceLabel =
      sourceTask.elInvoiceId.trim() ||
      sourceTask.taskName.trim() ||
      `SL NO ${String(sourceSlNo).padStart(2, '0')}`;
    const clonedLabel =
      options.elInvoiceId.trim() || options.taskName.trim() || 'Recurring Task';

    const clonedActivity = createActivityEntry(
      `created as recurring task from ${sourceLabel}${
        options.dueDate ? ` (due ${options.dueDate})` : ''
      }`
    );
    const sourceActivity = createActivityEntry(
      `created recurring clone "${clonedLabel}"${
        options.dueDate ? ` due ${options.dueDate}` : ''
      }`
    );

    const clonedTask: TaskRow = {
      ...sourceTask,
      id: crypto.randomUUID(),
      elInvoiceId: options.elInvoiceId.trim(),
      taskName: options.taskName.trim(),
      taskStatus: 'Not Started',
      dueDate: options.dueDate,
      paidReceiveAmount: options.resetPayment ? '' : sourceTask.paidReceiveAmount,
      noteForPaidReceive: options.resetPayment ? '' : sourceTask.noteForPaidReceive,
      driveLink: options.keepDriveLink ? sourceTask.driveLink : '',
      driveFileId: options.keepDriveLink ? sourceTask.driveFileId : undefined,
      driveFileName: options.keepDriveLink ? sourceTask.driveFileName : undefined,
      driveMimeType: options.keepDriveLink ? sourceTask.driveMimeType : undefined,
      comments: [clonedActivity],
      completedAt: undefined,
      isArchived: false,
      archivedAt: undefined,
      archiveExempt: false,
    };

    const nextSlNo = activeAuthorizedTasks.length + 1;
    setTasks((prev) => [
      ...prev.map((row) =>
        row.id === sourceTask.id
          ? { ...row, comments: [...(row.comments ?? []), sourceActivity] }
          : row
      ),
      clonedTask,
    ]);
    setShowArchived(false);
    setDetailDrawerTarget({ taskId: clonedTask.id, slNo: nextSlNo });
    recordAudit({
      category: 'task',
      action: 'Recurring Task Cloned',
      target: clonedLabel,
      details: `Cloned recurring task "${clonedLabel}" from "${sourceLabel}"${
        options.dueDate ? ` with due date ${options.dueDate}` : ''
      }.`,
      severity: 'success',
      metadata: {
        Source: sourceLabel,
        'New Due Date': options.dueDate || 'None',
        'Reset Payment': options.resetPayment,
      },
    });
    notify(
      `Created recurring task "${clonedLabel}"${
        options.dueDate ? ` due ${options.dueDate}` : ''
      }.`
    );
  };

  const handleArchiveTask = useCallback(
    (task: TaskRow) => {
      const archivedAtIso = new Date().toISOString();
      const activity = createActivityEntry('moved task to archive');
      setTasks((prev) =>
        prev.map((row) =>
          row.id === task.id
            ? {
                ...row,
                isArchived: true,
                archivedAt: archivedAtIso,
                archiveExempt: false,
                comments: [...(row.comments ?? []), activity],
              }
            : row
        )
      );
      const label = task.taskName.trim() || task.elInvoiceId.trim() || 'Task';
      recordAudit({
        category: 'archive',
        action: 'Task Archived',
        target: getTaskAuditLabel(task),
        details: `Manually moved "${label}" to Archive.`,
        severity: 'info',
      });
      notify(`Archived "${label}".`);
    },
    [createActivityEntry, notify, recordAudit]
  );

  const handleRestoreArchivedTask = useCallback(
    (task: TaskRow) => {
      const activity = createActivityEntry('restored task from archive to active ledger');
      setTasks((prev) =>
        prev.map((row) =>
          row.id === task.id
            ? {
                ...row,
                isArchived: false,
                archivedAt: undefined,
                archiveExempt: true,
                comments: [...(row.comments ?? []), activity],
              }
            : row
        )
      );
      const label = task.taskName.trim() || task.elInvoiceId.trim() || 'Task';
      recordAudit({
        category: 'archive',
        action: 'Task Restored from Archive',
        target: getTaskAuditLabel(task),
        details: `Restored "${label}" from Archive back to the active ledger.`,
        severity: 'success',
      });
      notify(`Restored "${label}" to active ledger.`);
    },
    [createActivityEntry, notify, recordAudit]
  );

  const handleRestoreAllArchived = () => {
    const idsToRestore = archivedVisibleRows.map((item) => item.task.id);
    if (idsToRestore.length === 0) return;
    const idSet = new Set(idsToRestore);
    const activity = createActivityEntry('restored task from archive to active ledger');

    setTasks((prev) =>
      prev.map((row) =>
        idSet.has(row.id)
          ? {
              ...row,
              isArchived: false,
              archivedAt: undefined,
              archiveExempt: true,
              comments: [...(row.comments ?? []), { ...activity, id: crypto.randomUUID() }],
            }
          : row
      )
    );
    setShowArchived(false);
    recordAudit({
      category: 'archive',
      action: 'Bulk Archive Restore',
      target: `${idsToRestore.length} ${idsToRestore.length === 1 ? 'task' : 'tasks'}`,
      details: `Restored ${idsToRestore.length} archived ${
        idsToRestore.length === 1 ? 'task' : 'tasks'
      } back to the active ledger.`,
      severity: 'success',
      metadata: { 'Restored Count': idsToRestore.length },
    });
    notify(
      `Restored ${idsToRestore.length} archived ${
        idsToRestore.length === 1 ? 'task' : 'tasks'
      } to active ledger.`
    );
  };

  const handleDeleteRow = (task: TaskRow, slNo: number) => {
    const removeRow = () => {
      setTasks((prev) => {
        const next = prev.filter((r) => r.id !== task.id);
        return next.length > 0 ? next : [createEmptyTaskRow()];
      });
      if (detailDrawerTarget?.taskId === task.id) {
        setDetailDrawerTarget(null);
      }
      if (isRowPopulated(task)) {
        recordAudit({
          category: 'task',
          action: 'Task Row Deleted',
          target: getTaskAuditLabel(task),
          details: `Deleted row ${String(slNo).padStart(2, '0')} (${getTaskAuditLabel(
            task
          )}).`,
          severity: 'warning',
        });
      }
      notify(`Removed row ${String(slNo).padStart(2, '0')}.`);
    };

    if (!isRowPopulated(task)) {
      removeRow();
      return;
    }

    setConfirmRequest({
      title: `Delete Row ${String(slNo).padStart(2, '0')}?`,
      description:
        'This will remove this task entry from your local Task Plan table. Any linked files in Google Drive will remain untouched.',
      details: [
        task.elInvoiceId ? `EL Invoice ID: ${task.elInvoiceId}` : '',
        task.clientName ? `Client: ${task.clientName}` : '',
        task.taskName ? `Task: ${task.taskName}` : '',
      ].filter(Boolean),
      confirmLabel: 'Delete Row',
      tone: 'danger',
      onConfirm: removeRow,
    });
  };

  const handleQuickSaveToDrive = () => {
    if (!isSignedIn) {
      handleLogin();
      return;
    }

    const populatedCount = tasks.filter(isRowPopulated).length;
    const isUpdating = Boolean(syncedDriveFileId);
    const targetName = syncedDriveFileName || 'Task_Plan_and_Status_Ledger.json';

    setConfirmRequest({
      title: isUpdating
        ? 'Update Task Plan backup in Google Drive?'
        : 'Save Task Plan backup to Google Drive?',
      description: isUpdating
        ? `Overwrite "${targetName}" in Google Drive with your current ${tasks.length} rows (${populatedCount} populated)?`
        : `Create "${targetName}" in Google Drive containing your current ${tasks.length} rows (${populatedCount} populated)?`,
      confirmLabel: isUpdating ? 'Overwrite Backup' : 'Save to Drive',
      tone: 'primary',
      onConfirm: async () => {
        try {
          const saved = await saveLedgerToDrive({
            tasks,
            currencySymbol,
            users,
            fileName: targetName,
            existingFileId: syncedDriveFileId || undefined,
          });
          setSyncedDriveFileId(saved.id);
          setSyncedDriveFileName(saved.name);
          recordAudit({
            category: 'export',
            action: 'Drive Backup Saved',
            target: saved.name,
            details: `${isUpdating ? 'Updated' : 'Created'} Google Drive JSON backup "${
              saved.name
            }" (${populatedCount} populated rows).`,
            severity: 'success',
            metadata: {
              'Drive File ID': saved.id,
              'Total Rows': tasks.length,
              'Populated Rows': populatedCount,
            },
          });
          notify(`Saved "${saved.name}" to Google Drive.`);
        } catch (err) {
          if (err instanceof DriveAuthError) {
            handleSessionExpired();
          } else {
            const msg =
              err instanceof Error ? err.message : 'Failed to save backup to Drive.';
            recordAudit({
              category: 'export',
              action: 'Drive Backup Failed',
              target: targetName,
              details: msg,
              severity: 'error',
            });
            notify(msg, 'error');
          }
        }
      },
    });
  };

  // Rows authorized for the currently signed-in user:
  // Admins see all rows; Standard Users ONLY see rows tagged with their username in the Action column.
  const authorizedTasks = useMemo(() => {
    if (!currentAppUser) return [];
    if (currentAppUser.role === 'admin') return tasks;
    const targetUsername = currentAppUser.username.trim().toLowerCase();
    return tasks.filter(
      (row) => (row.assignedUser || '').trim().toLowerCase() === targetUsername
    );
  }, [tasks, currentAppUser]);

  const activeAuthorizedTasks = useMemo(
    () => authorizedTasks.filter((row) => !row.isArchived),
    [authorizedTasks]
  );

  const archivedAuthorizedTasks = useMemo(
    () => authorizedTasks.filter((row) => Boolean(row.isArchived)),
    [authorizedTasks]
  );

  const handleDownloadCsv = () => {
    const sourceRows = showArchived
      ? archivedAuthorizedTasks
      : activeAuthorizedTasks;
    const csv = buildTaskLedgerCsv(sourceRows);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = showArchived
      ? `Task_Plan_Archived_${dateStamp}.csv`
      : `Task_Plan_and_Status_${dateStamp}.csv`;
    downloadCsvFile(csv, filename);
    recordAudit({
      category: 'export',
      action: 'CSV Exported',
      target: filename,
      details: `Downloaded ${
        showArchived ? 'archived' : 'active'
      } task ledger CSV (${sourceRows.length} rows).`,
      severity: 'success',
      metadata: {
        Scope: showArchived ? 'Archived Tasks' : 'Active Tasks',
        'Row Count': sourceRows.length,
      },
    });
    notify(
      showArchived ? 'Downloaded Archived Tasks CSV.' : 'Downloaded Task Plan CSV.'
    );
  };

  const handleLedgerSynced = (file: DriveFileItem) => {
    setSyncedDriveFileId(file.id);
    setSyncedDriveFileName(file.name);
  };

  const handleRestoreTasksFromDrive = (
    restoredTasks: TaskRow[],
    restoredCurrency?: string,
    sourceFile?: DriveFileItem,
    restoredUsers?: AppUser[]
  ) => {
    setTasks(
      restoredTasks.length > 0
        ? restoredTasks.map((row) => ({
            ...row,
            assignedUser: typeof row.assignedUser === 'string' ? row.assignedUser : '',
            dueDate: typeof row.dueDate === 'string' ? row.dueDate : '',
            comments: Array.isArray(row.comments) ? row.comments : [],
            completedAt: typeof row.completedAt === 'string' ? row.completedAt : undefined,
            isArchived: Boolean(row.isArchived),
            archivedAt: typeof row.archivedAt === 'string' ? row.archivedAt : undefined,
            archiveExempt: Boolean(row.archiveExempt),
          }))
        : Array.from({ length: INITIAL_EMPTY_ROW_COUNT }, () => createEmptyTaskRow())
    );
    if (restoredCurrency) {
      setCurrencySymbol(restoredCurrency);
    }
    if (Array.isArray(restoredUsers) && restoredUsers.length > 0) {
      setUsers(restoredUsers);
    }
    if (sourceFile) {
      setSyncedDriveFileId(sourceFile.id);
      setSyncedDriveFileName(sourceFile.name);
    }
    recordAudit({
      category: 'export',
      action: 'Tasks Restored from Drive',
      target: sourceFile?.name || 'Google Drive Backup',
      details: `Restored ${restoredTasks.length} task rows from Google Drive backup${
        sourceFile?.name ? ` "${sourceFile.name}"` : ''
      }.`,
      severity: 'warning',
      metadata: { 'Restored Rows': restoredTasks.length },
    });
    setActiveView('ledger');
  };

  const handleLinkSheet = useCallback(
    (spreadsheetId: string, title: string, tabTitle: string) => {
      setLinkedSheetMeta({ spreadsheetId, title, tabTitle });
    },
    []
  );

  const handleSaveTableToGoogleSheet = async (
    targetTasks: TaskRow[],
    sheetTitle: string,
    isSelectionOnly: boolean
  ) => {
    const cleanTitle =
      sheetTitle.trim() ||
      `Task Plan and Status - ${new Date().toISOString().slice(0, 10)}`;
    const targetFolderUrl =
      bridgeStatus?.folderUrl || DEFAULT_TARGET_DRIVE_FOLDER_URL;
    const useServerBridge = Boolean(bridgeStatus?.connected);

    // Only request Google Sign-In if the sign-in-free Apps Script bridge isn't connected yet
    if (!useServerBridge && !isSignedIn) {
      if (isLoggingIn) return;
      setIsLoggingIn(true);
      try {
        const authResult = await googleSignIn();
        if (!authResult) {
          notify('Google sign-in was cancelled.');
          return;
        }
        setUser(authResult.user);
        setNeedsAuth(false);
      } catch (err) {
        notify(
          err instanceof Error
            ? err.message
            : 'Google sign-in failed. Please try again.',
          'error'
        );
        return;
      } finally {
        setIsLoggingIn(false);
      }
    }

    const rowLabel = isSelectionOnly
      ? `${targetTasks.length} selected ${targetTasks.length === 1 ? 'row' : 'rows'}`
      : `${targetTasks.length} table ${targetTasks.length === 1 ? 'row' : 'rows'}`;

    setConfirmRequest({
      title: 'Create Google Sheet Snapshot in Drive Folder?',
      description: `Create a new Google Sheet named "${cleanTitle}" from ${rowLabel} and save it directly into your target Google Drive folder?`,
      details: [
        `Sheet title: ${cleanTitle}`,
        `Included rows: ${rowLabel}`,
        `Target folder: ${targetFolderUrl}`,
        useServerBridge
          ? 'Connection: Automatic Drive Folder Bridge (no Google Sign-In required)'
          : 'Connection: Signed-in Google Workspace account',
      ],
      confirmLabel: 'Create & Save Sheet',
      tone: 'primary',
      onConfirm: async () => {
        setIsExportingTableSheet(true);
        try {
          if (useServerBridge) {
            const created = await createSnapshotViaBridge({
              tasks: targetTasks,
              title: cleanTitle,
            });
            handleLinkSheet(created.spreadsheetId, created.title, 'Task Plan');
            setLastTableSheetExport({
              title: created.title,
              url: created.spreadsheetUrl,
            });
            recordAudit({
              category: 'bridge',
              action: 'Bridge Snapshot Created',
              target: created.title,
              details: `Saved Google Sheet snapshot "${created.title}" (${rowLabel}) into target Drive folder via Apps Script bridge.`,
              severity: 'success',
              metadata: {
                'Row Count': targetTasks.length,
                Selection: isSelectionOnly ? 'Selected rows' : 'Visible table',
                'Spreadsheet ID': created.spreadsheetId,
              },
            });
            notify(
              `Saved Google Sheet "${created.title}" into your Google Drive folder.`
            );
          } else {
            const created = await createTaskSpreadsheet(
              cleanTitle,
              targetTasks,
              DEFAULT_TARGET_DRIVE_FOLDER_ID
            );
            const firstTab = created.sheets[0]?.title || 'Task Plan';
            handleLinkSheet(created.spreadsheetId, created.title, firstTab);
            setLastTableSheetExport({
              title: created.title,
              url: created.spreadsheetUrl,
            });
            recordAudit({
              category: 'export',
              action: 'Google Sheet Snapshot Created',
              target: created.title,
              details: `Saved Google Sheet "${created.title}" (${rowLabel}) into target Drive folder via signed-in Google account.`,
              severity: 'success',
              metadata: {
                'Row Count': targetTasks.length,
                Selection: isSelectionOnly ? 'Selected rows' : 'Visible table',
                'Spreadsheet ID': created.spreadsheetId,
              },
            });
            notify(
              `Saved Google Sheet "${created.title}" into your Google Drive folder.`
            );
          }
        } catch (err) {
          if (err instanceof DriveAuthError) {
            handleSessionExpired();
          } else {
            const msg =
              err instanceof Error
                ? err.message
                : 'Failed to create Google Sheet in the target Drive folder.';
            recordAudit({
              category: useServerBridge ? 'bridge' : 'export',
              action: 'Google Sheet Snapshot Failed',
              target: cleanTitle,
              details: msg,
              severity: 'error',
            });
            notify(msg, 'error');
          }
        } finally {
          setIsExportingTableSheet(false);
        }
      },
    });
  };

  const handleImportTasksFromSheet = useCallback(
    (imported: TaskRow[], mode: 'replace' | 'append') => {
      const normalized = imported.map((row) => ({
        ...row,
        assignedUser: typeof row.assignedUser === 'string' ? row.assignedUser : '',
        dueDate: typeof row.dueDate === 'string' ? row.dueDate : '',
        comments: Array.isArray(row.comments) ? row.comments : [],
        completedAt: typeof row.completedAt === 'string' ? row.completedAt : undefined,
        isArchived: Boolean(row.isArchived),
        archivedAt: typeof row.archivedAt === 'string' ? row.archivedAt : undefined,
        archiveExempt: Boolean(row.archiveExempt),
      }));
      setTasks((prev) =>
        mode === 'replace'
          ? normalized.length > 0
            ? normalized
            : Array.from({ length: INITIAL_EMPTY_ROW_COUNT }, () =>
                createEmptyTaskRow()
              )
          : [...prev.filter(isRowPopulated), ...normalized]
      );
      recordAudit({
        category: 'export',
        action: 'Tasks Imported from Sheet',
        target: `${normalized.length} ${normalized.length === 1 ? 'row' : 'rows'}`,
        details: `${
          mode === 'replace' ? 'Replaced ledger with' : 'Appended'
        } ${normalized.length} rows imported from Google Sheets.`,
        severity: mode === 'replace' ? 'warning' : 'success',
        metadata: { Mode: mode, 'Imported Rows': normalized.length },
      });
      setActiveView('ledger');
    },
    [recordAudit]
  );

  // Filtered active rows with sequential SL NO within the user's authorized active view
  const visibleRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return activeAuthorizedTasks
      .map((task, idx) => ({ task, slNo: idx + 1 }))
      .filter(({ task, slNo }) => {
        if (statusFilter === 'OVERDUE') {
          if (getDueDateState(task.dueDate, task.taskStatus) !== 'overdue') {
            return false;
          }
        } else if (statusFilter !== 'ALL' && task.taskStatus !== statusFilter) {
          return false;
        }
        if (isAdmin && userFilter !== 'ALL') {
          const assigned = (task.assignedUser || '').trim().toLowerCase();
          if (userFilter === 'UNASSIGNED') {
            if (assigned) return false;
          } else if (assigned !== userFilter.toLowerCase()) {
            return false;
          }
        }
        if (!query) return true;
        const haystack = [
          String(slNo),
          task.elInvoiceId,
          task.clientName,
          task.companyName,
          task.taskName,
          task.taskBy,
          task.taskStatus,
          task.dueDate || '',
          task.noteForPaidReceive,
          task.driveFileName || '',
          task.assignedUser || '',
          task.actionToDo,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      });
  }, [activeAuthorizedTasks, searchQuery, statusFilter, isAdmin, userFilter]);

  // Filtered archived rows (sorted most recently archived first)
  const archivedVisibleRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return [...archivedAuthorizedTasks]
      .sort((a, b) => {
        const aTime = a.archivedAt ? Date.parse(a.archivedAt) : 0;
        const bTime = b.archivedAt ? Date.parse(b.archivedAt) : 0;
        return bTime - aTime;
      })
      .map((task, idx) => ({ task, slNo: idx + 1 }))
      .filter(({ task }) => {
        if (isAdmin && userFilter !== 'ALL') {
          const assigned = (task.assignedUser || '').trim().toLowerCase();
          if (userFilter === 'UNASSIGNED') {
            if (assigned) return false;
          } else if (assigned !== userFilter.toLowerCase()) {
            return false;
          }
        }
        if (!query) return true;
        const haystack = [
          task.elInvoiceId,
          task.clientName,
          task.companyName,
          task.taskName,
          task.taskBy,
          task.dueDate || '',
          task.noteForPaidReceive,
          task.driveFileName || '',
          task.assignedUser || '',
          task.actionToDo,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      });
  }, [archivedAuthorizedTasks, searchQuery, isAdmin, userFilter]);

  // Global summary KPIs (strictly scoped to activeAuthorizedTasks)
  const summaryStats = useMemo(() => {
    const populated = activeAuthorizedTasks.filter(isRowPopulated);
    let totalPrice = 0;
    let totalPaid = 0;
    let completed = 0;
    let linked = 0;
    let overdue = 0;

    for (const row of populated) {
      totalPrice += parseCurrencyValue(row.taskPrice);
      totalPaid += parseCurrencyValue(row.paidReceiveAmount);
      if (row.taskStatus === 'Completed') completed += 1;
      if (row.driveLink.trim()) linked += 1;
      if (getDueDateState(row.dueDate, row.taskStatus) === 'overdue') overdue += 1;
    }

    return {
      populatedCount: populated.length,
      completedCount: completed,
      totalPrice,
      totalPaid,
      balanceDue: Math.max(0, totalPrice - totalPaid),
      linkedCount: linked,
      overdueCount: overdue,
    };
  }, [activeAuthorizedTasks]);

  const activeDrivePickerTask = drivePickerTarget
    ? authorizedTasks.find((t) => t.id === drivePickerTarget.taskId) || null
    : null;

  const activeDrawerTask = detailDrawerTarget
    ? authorizedTasks.find((t) => t.id === detailDrawerTarget.taskId) || null
    : null;

  const statusFilterOptions: Array<{
    label: string;
    value: TaskStatus | 'ALL' | 'OVERDUE';
  }> = [
    { label: 'All', value: 'ALL' },
    { label: 'Not Started', value: 'Not Started' },
    { label: 'In Progress', value: 'In Progress' },
    { label: 'Under Review', value: 'Under Review' },
    { label: 'Completed', value: 'Completed' },
    { label: 'On Hold', value: 'On Hold' },
    { label: 'Overdue', value: 'OVERDUE' },
  ];

  // Wait briefly for user bootstrap before rendering
  if (!usersReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F4F7F6] text-xs text-slate-500">
        Loading workspace...
      </div>
    );
  }

  // Show User ID & Password Login Screen whenever not authenticated
  if (!currentAppUser) {
    return (
      <LoginScreen
        users={users}
        onAuthenticated={handleAppUserAuthenticated}
      />
    );
  }

  return (
    <div className="min-h-screen bg-transparent text-slate-900 flex flex-col">
      {/* Top Navigation Bar — Executive 3-Zone Header */}
      <header className="sticky top-0 z-20 border-b border-slate-200/90 bg-white/95 backdrop-blur-md shadow-2xs">
        <div className="mx-auto flex max-w-[1640px] flex-wrap items-center justify-between gap-4 px-6 py-3">
          {/* Zone 1: Brand Emblem & Title */}
          <button
            type="button"
            onClick={() => setActiveView('ledger')}
            className="group flex items-center gap-3 text-left shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#1A365D] rounded-lg"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#0F2547] to-[#23487A] text-white shadow-xs transition-transform group-hover:scale-[1.03]">
              <ClipboardCheck className="h-4.5 w-4.5 text-blue-200" aria-hidden="true" />
            </div>
            <div>
              <span className="block font-display text-base font-bold tracking-tight text-[#1A365D] leading-tight">
                Task Plan and Status
              </span>
              <span className="block text-[11px] font-medium text-slate-500">
                Client Engagement &amp; Billing Ledger
              </span>
            </div>
          </button>

          {/* Zone 2: Pill Navigation Tabs */}
          <nav
            aria-label="Workspace views"
            className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200/80 bg-slate-100/80 p-1 text-xs font-semibold"
          >
            <button
              type="button"
              onClick={() => setActiveView('ledger')}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition-all whitespace-nowrap shrink-0 ${
                activeView === 'ledger'
                  ? 'bg-[#1A365D] text-white shadow-xs'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
              }`}
            >
              <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
              Task Ledger
            </button>
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveView('drive')}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition-all whitespace-nowrap shrink-0 ${
                    activeView === 'drive'
                      ? 'bg-[#1A365D] text-white shadow-xs'
                      : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
                  }`}
                >
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  Google Drive
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView('sheets')}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition-all whitespace-nowrap shrink-0 ${
                    activeView === 'sheets'
                      ? 'bg-[#1A365D] text-white shadow-xs'
                      : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
                  }`}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                  Google Sheets
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView('billing')}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition-all whitespace-nowrap shrink-0 ${
                    activeView === 'billing'
                      ? 'bg-[#1A365D] text-white shadow-xs'
                      : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
                  }`}
                >
                  <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
                  Billing Summary
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView('settings')}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition-all whitespace-nowrap shrink-0 ${
                    activeView === 'settings'
                      ? 'bg-[#1A365D] text-white shadow-xs'
                      : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
                  }`}
                >
                  <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                  Settings
                </button>
              </>
            )}
          </nav>

          {/* Zone 3: Active Account Badge */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-1.5 text-xs text-slate-600 whitespace-nowrap">
              <span
                className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${
                  isAdmin
                    ? 'bg-[#1A365D]/10 text-[#1A365D]'
                    : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {isAdmin ? 'Admin' : 'User'}
              </span>
              <UserRound className="h-3.5 w-3.5 text-[#1A365D]" aria-hidden="true" />
              <span className="font-mono font-semibold text-slate-900">
                {currentAppUser.username}
              </span>
              <span className="text-slate-300" aria-hidden="true">
                |
              </span>
              <button
                type="button"
                onClick={handleSwitchAppUser}
                className="inline-flex cursor-pointer items-center gap-1 font-semibold text-slate-600 transition-colors hover:text-[#1A365D] whitespace-nowrap"
              >
                <LogOut className="h-3 w-3" aria-hidden="true" />
                Switch User
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto w-full max-w-[1640px] flex-1 px-6 py-5 space-y-5">
        {activeView === 'ledger' && (
          <div className="space-y-4">
            {/* Executive 4-Card KPI Summary Strip */}
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              {/* Card 1: Active Tasks & Status Breakdown */}
              <div className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-white px-5 py-4 shadow-2xs">
                <div className="absolute inset-y-0 left-0 w-1 bg-[#1A365D]" />
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Active Engagements
                    </span>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-display text-2xl font-bold tracking-tight text-[#1A365D] tabular-nums">
                        {summaryStats.populatedCount}
                      </span>
                      <span className="text-xs font-medium text-slate-500">
                        {summaryStats.populatedCount === 1 ? 'task' : 'tasks'}
                      </span>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 tabular-nums">
                    <CheckCircle2 className="h-3 w-3" />
                    {summaryStats.completedCount} done
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-500">
                  <span>{summaryStats.linkedCount} linked to Drive</span>
                  {summaryStats.overdueCount > 0 && (
                    <>
                      <span>·</span>
                      <span className="rounded bg-red-50 px-1.5 py-0.5 font-semibold text-red-700 tabular-nums">
                        {summaryStats.overdueCount} overdue
                      </span>
                    </>
                  )}
                  {archivedAuthorizedTasks.length > 0 && (
                    <>
                      <span>·</span>
                      <button
                        type="button"
                        onClick={() => setShowArchived((prev) => !prev)}
                        className="cursor-pointer font-semibold text-[#1A365D] hover:underline tabular-nums"
                      >
                        {archivedAuthorizedTasks.length} archived
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Card 2: Total Task Price */}
              <div className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-white px-5 py-4 shadow-2xs">
                <div className="absolute inset-y-0 left-0 w-1 bg-blue-600" />
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Total Task Price
                    </span>
                    <div className="mt-1 font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                      {formatAmount(summaryStats.totalPrice, currencySymbol)}
                    </div>
                  </div>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                    <Wallet className="h-4 w-4" />
                  </div>
                </div>
                <p className="mt-2.5 text-[11px] text-slate-500">
                  Contracted billable value across active rows
                </p>
              </div>

              {/* Card 3: Paid / Received */}
              <div className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-white px-5 py-4 shadow-2xs">
                <div className="absolute inset-y-0 left-0 w-1 bg-emerald-600" />
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Paid / Received
                    </span>
                    <div className="mt-1 font-mono text-2xl font-bold tracking-tight text-emerald-700 tabular-nums">
                      {formatAmount(summaryStats.totalPaid, currencySymbol)}
                    </div>
                  </div>
                  <span className="rounded-lg bg-emerald-50 px-2 py-1 font-mono text-[11px] font-semibold text-emerald-700 tabular-nums">
                    {summaryStats.totalPrice > 0
                      ? `${Math.min(
                          100,
                          Math.round((summaryStats.totalPaid / summaryStats.totalPrice) * 100)
                        )}% collected`
                      : '0%'}
                  </span>
                </div>
                <p className="mt-2.5 text-[11px] text-slate-500">
                  Total realized collections received to date
                </p>
              </div>

              {/* Card 4: Balance Due */}
              <div className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-white px-5 py-4 shadow-2xs">
                <div
                  className={`absolute inset-y-0 left-0 w-1 ${
                    summaryStats.balanceDue > 0 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                />
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Outstanding Balance Due
                    </span>
                    <div
                      className={`mt-1 font-mono text-2xl font-bold tracking-tight tabular-nums ${
                        summaryStats.balanceDue > 0 ? 'text-amber-700' : 'text-slate-900'
                      }`}
                    >
                      {formatAmount(summaryStats.balanceDue, currencySymbol)}
                    </div>
                  </div>
                  <span
                    className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${
                      summaryStats.balanceDue > 0
                        ? 'bg-amber-50 text-amber-800'
                        : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {summaryStats.balanceDue > 0 ? 'Receivable' : 'Settled'}
                  </span>
                </div>
                <p className="mt-2.5 text-[11px] text-slate-500">
                  Remaining receivable balance on active engagements
                </p>
              </div>
            </div>

            {/* Main Ledger Card */}
            <div className="rounded-xl border border-slate-200/95 bg-white px-5 py-5 shadow-xs space-y-4">
              {/* Operational Toolbar */}
              <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center flex-wrap">
                  {/* Live Search */}
                  <div className="relative w-full sm:w-64">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search invoice, client, company, task..."
                      className="w-full rounded-lg border border-slate-300 bg-slate-50/50 py-1.5 pl-8.5 pr-8 text-xs text-slate-900 transition-all placeholder:text-slate-400 focus:border-[#1A365D] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1A365D]/15"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        aria-label="Clear search"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Segmented Status Filter */}
                  <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200/80 bg-slate-100/80 p-1">
                    {statusFilterOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setStatusFilter(opt.value)}
                        className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition-all whitespace-nowrap ${
                          statusFilter === opt.value
                            ? opt.value === 'OVERDUE'
                              ? 'bg-red-600 text-white shadow-xs'
                              : 'bg-white text-[#1A365D] shadow-xs'
                            : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* Admin Tagged-User Filter */}
                  {isAdmin && (
                    <select
                      aria-label="Filter by tagged user"
                      value={userFilter}
                      onChange={(e) => setUserFilter(e.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:border-[#1A365D] focus:outline-none"
                    >
                      <option value="ALL">All Users</option>
                      <option value="UNASSIGNED">Unassigned Rows</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.username}>
                          User: {u.username}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Action Controls */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Table / Kanban Board Segmented Toggle */}
                  <div
                    role="group"
                    aria-label="Ledger display mode"
                    className="flex items-center gap-0.5 rounded-lg border border-slate-200/80 bg-slate-100/80 p-1"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setShowArchived(false);
                        setLedgerMode('table');
                      }}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all whitespace-nowrap ${
                        !showArchived && ledgerMode === 'table'
                          ? 'bg-white text-[#1A365D] shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Table
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowArchived(false);
                        setLedgerMode('board');
                      }}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all whitespace-nowrap ${
                        !showArchived && ledgerMode === 'board'
                          ? 'bg-white text-[#1A365D] shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Columns3 className="h-3.5 w-3.5" aria-hidden="true" />
                      Board
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowArchived((prev) => !prev)}
                      aria-pressed={showArchived}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all whitespace-nowrap ${
                        showArchived
                          ? 'bg-white text-[#1A365D] shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                      Archive
                      {archivedAuthorizedTasks.length > 0 && (
                        <span className="font-mono text-[11px] tabular-nums">
                          ({archivedAuthorizedTasks.length})
                        </span>
                      )}
                    </button>
                  </div>

                  <select
                    aria-label="Currency symbol"
                    value={currencySymbol}
                    onChange={(e) => setCurrencySymbol(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs font-semibold text-slate-700 focus:border-[#1A365D] focus:outline-none"
                  >
                    <option value="৳">BDT (৳)</option>
                    <option value="$">USD ($)</option>
                    <option value="£">GBP (£)</option>
                    <option value="€">EUR (€)</option>
                  </select>

                  <button
                    type="button"
                    onClick={handleDownloadCsv}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition-all hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export CSV
                  </button>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={handleQuickSaveToDrive}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#1A365D]/25 bg-[#EBF3FC] px-3 py-1.5 text-xs font-semibold text-[#1A365D] transition-all hover:bg-[#DCEAF8] whitespace-nowrap"
                    >
                      <CloudUpload className="h-3.5 w-3.5" />
                      {isSignedIn ? 'Save to Drive' : 'Connect Drive to Sync'}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      ledgerMode === 'board'
                        ? handleAddTaskInStatus('Not Started')
                        : handleAddRow()
                    }
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#1A365D] to-[#23487A] px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-all hover:from-[#132948] hover:to-[#1A365D] whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {ledgerMode === 'board' ? 'Add Task' : 'Add Row'}
                  </button>
                </div>
              </div>

            {/* Archive View, Table View, or Kanban Board View */}
            {showArchived ? (
              <ArchiveTasksView
                rows={archivedVisibleRows}
                currencySymbol={currencySymbol}
                onRestoreTask={handleRestoreArchivedTask}
                onRestoreAll={handleRestoreAllArchived}
                onOpenDetailDrawer={(task, slNo) =>
                  setDetailDrawerTarget({ taskId: task.id, slNo })
                }
                onDeleteRow={handleDeleteRow}
                onBackToActive={() => setShowArchived(false)}
              />
            ) : ledgerMode === 'table' ? (
              <TaskLedgerTable
                rows={visibleRows}
                currencySymbol={currencySymbol}
                users={users}
                isAdmin={isAdmin}
                isSignedIn={isSignedIn}
                isExportingSheet={isExportingTableSheet}
                lastSavedSheet={lastTableSheetExport}
                bridgeStatus={bridgeStatus}
                bridgeConfig={bridgeConfig}
                bridgeSyncState={bridgeSyncState}
                bridgeLastSyncedAt={bridgeLastSyncedAt}
                bridgeLastError={bridgeLastError}
                hasPendingMasterChanges={hasPendingMasterChanges}
                onSyncMasterNow={() => performMasterSheetSync(true)}
                onOpenBridgeSettings={() => setActiveView('settings')}
                onUpdateField={handleUpdateField}
                onBulkUpdateStatus={handleBulkUpdateStatus}
                onSaveToGoogleSheet={handleSaveTableToGoogleSheet}
                onOpenDrivePicker={(task, slNo) =>
                  setDrivePickerTarget({ taskId: task.id, slNo })
                }
                onOpenDetailDrawer={(task, slNo) =>
                  setDetailDrawerTarget({ taskId: task.id, slNo })
                }
                onDeleteRow={handleDeleteRow}
                onAddRow={handleAddRow}
              />
            ) : (
              <TaskKanbanBoard
                rows={visibleRows}
                currencySymbol={currencySymbol}
                onMoveTaskStatus={handleMoveTaskStatus}
                onOpenDetailDrawer={(task, slNo) =>
                  setDetailDrawerTarget({ taskId: task.id, slNo })
                }
                onOpenDrivePicker={(task, slNo) =>
                  setDrivePickerTarget({ taskId: task.id, slNo })
                }
                onAddTaskInStatus={handleAddTaskInStatus}
              />
            )}
            </div>
          </div>
        )}

        {activeView === 'drive' && isAdmin && (
          <DriveExplorerView
            tasks={authorizedTasks}
            users={users}
            isAdmin={isAdmin}
            currencySymbol={currencySymbol}
            isSignedIn={isSignedIn}
            isSigningIn={isLoggingIn}
            syncedDriveFileId={syncedDriveFileId}
            syncedDriveFileName={syncedDriveFileName}
            onSignIn={handleLogin}
            onSessionExpired={handleSessionExpired}
            onRequestConfirm={setConfirmRequest}
            onLedgerSynced={handleLedgerSynced}
            onRestoreTasksFromDrive={handleRestoreTasksFromDrive}
            onAttachFileToRow={handleAttachDriveItem}
            onNotify={notify}
          />
        )}

        {activeView === 'sheets' && isAdmin && (
          <GoogleSheetsView
            tasks={authorizedTasks}
            isSignedIn={isSignedIn}
            isSigningIn={isLoggingIn}
            linkedSheetId={linkedSheetMeta.spreadsheetId}
            linkedSheetTab={linkedSheetMeta.tabTitle}
            onLinkSheet={handleLinkSheet}
            onImportTasks={handleImportTasksFromSheet}
            onSignIn={handleLogin}
            onSessionExpired={handleSessionExpired}
            onRequestConfirm={setConfirmRequest}
            onNotify={notify}
          />
        )}

        {activeView === 'billing' && isAdmin && (
          <BillingSummaryView
            tasks={authorizedTasks}
            currencySymbol={currencySymbol}
            onFilterByCompany={(company) => {
              setSearchQuery(company);
              setStatusFilter('ALL');
              setActiveView('ledger');
            }}
            onFilterByStatus={(status) => {
              setStatusFilter(status);
              setSearchQuery('');
              setActiveView('ledger');
            }}
          />
        )}

        {activeView === 'settings' && isAdmin && (
          <SettingsView
            users={users}
            currentUser={currentAppUser}
            tasks={tasks}
            auditLogs={auditLogs}
            bridgeStatus={bridgeStatus}
            bridgeDiagnosticReport={bridgeDiagnosticReport}
            checkingBridge={checkingBridge}
            bridgeConfig={bridgeConfig}
            bridgeSyncState={bridgeSyncState}
            bridgeLastSyncedAt={bridgeLastSyncedAt}
            bridgeLastError={bridgeLastError}
            onUpdateBridgeConfig={handleUpdateBridgeConfig}
            onTestBridgeConnection={handleCheckBridgeConnection}
            onSyncMasterNow={() => performMasterSheetSync(true)}
            onClearAuditLogs={handleClearAuditLogs}
            onAddUser={handleAddAppUser}
            onUpdateUser={handleUpdateAppUser}
            onDeleteUser={handleDeleteAppUser}
            onSwitchUserLogout={handleSwitchAppUser}
            onRequestConfirm={setConfirmRequest}
            onNotify={notify}
          />
        )}
      </main>

      {/* Transient Feedback Notice */}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 right-5 z-50 flex max-w-md items-center gap-3 rounded-md border px-4 py-3 text-xs font-medium shadow-lg ${
            notice.tone === 'error'
              ? 'border-red-200 bg-red-50 text-red-900'
              : 'border-slate-200 bg-white text-slate-900'
          }`}
        >
          <span>{notice.message}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss notification"
            className="text-slate-400 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Google Drive Attachment Modal */}
      <DriveLinkModal
        task={activeDrivePickerTask}
        slNo={drivePickerTarget?.slNo ?? 1}
        isSignedIn={isSignedIn}
        isSigningIn={isLoggingIn}
        onSignIn={handleLogin}
        onSessionExpired={handleSessionExpired}
        onRequestConfirm={setConfirmRequest}
        onAttachDriveItem={handleAttachDriveItem}
        onNotify={notify}
        onClose={() => setDrivePickerTarget(null)}
      />

      {/* Row Detail, Comments Thread & Linked Folder Slide-Over Drawer */}
      <TaskDetailDrawer
        task={activeDrawerTask}
        slNo={detailDrawerTarget?.slNo ?? 1}
        currencySymbol={currencySymbol}
        isSignedIn={isSignedIn}
        users={users}
        currentUser={currentAppUser}
        isAdmin={isAdmin}
        existingInvoiceIds={tasks.map((t) => t.elInvoiceId)}
        onUpdateField={handleUpdateField}
        onAddComment={handleAddComment}
        onDeleteComment={handleDeleteComment}
        onCloneRecurring={handleCloneRecurringTask}
        onOpenDrivePicker={(task, slNo) =>
          setDrivePickerTarget({ taskId: task.id, slNo })
        }
        onArchiveTask={handleArchiveTask}
        onRestoreTask={handleRestoreArchivedTask}
        onRequestConfirm={setConfirmRequest}
        onSessionExpired={handleSessionExpired}
        onNotify={notify}
        onDeleteRow={handleDeleteRow}
        onClose={() => setDetailDrawerTarget(null)}
      />

      {/* Explicit Confirmation Modal for Mutating / Destructive Operations */}
      <ConfirmModal
        request={confirmRequest}
        onClose={() => setConfirmRequest(null)}
      />
    </div>
  );
}
