import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Loader2,
  LogOut,
  Pencil,
  Power,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import {
  hashPassword,
  type AppUser,
  type UserRole,
} from '../types/auth';
import type { ConfirmDialogRequest, TaskRow } from '../types/task';
import {
  clearBridgeLogs,
  fetchBridgeLogs,
  type BridgeApiLogEntry,
  type BridgeConfig,
  type BridgeDiagnosticReport,
  type BridgeStatusResponse,
  type BridgeSyncState,
} from '../services/driveBridge';
import type { AuditLogEntry } from '../types/audit';
import { DriveBridgeSettingsSection } from './DriveBridgeSettingsSection';
import { BridgeLogsSection } from './BridgeLogsSection';
import { AuditLogViewerSection } from './AuditLogViewerSection';

type SettingsTab = 'overview' | 'bridge-logs' | 'audit-log';

function formatMasterSyncTimestamp(iso: string | null): {
  exact: string;
  relative: string;
} {
  if (!iso) {
    return { exact: 'Never synced yet', relative: '' };
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { exact: 'Never synced yet', relative: '' };
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  const exact = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

  const diffSec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  let relative = 'Just now';
  if (diffSec >= 60 && diffSec < 3600) {
    relative = `${Math.floor(diffSec / 60)}m ago`;
  } else if (diffSec >= 3600 && diffSec < 86400) {
    relative = `${Math.floor(diffSec / 3600)}h ago`;
  } else if (diffSec >= 86400) {
    relative = `${Math.floor(diffSec / 86400)}d ago`;
  }

  return { exact, relative };
}

interface SettingsViewProps {
  users: AppUser[];
  currentUser: AppUser;
  tasks: TaskRow[];
  auditLogs: AuditLogEntry[];
  bridgeStatus: BridgeStatusResponse | null;
  bridgeDiagnosticReport: BridgeDiagnosticReport | null;
  checkingBridge: boolean;
  bridgeConfig: BridgeConfig;
  bridgeSyncState: BridgeSyncState;
  bridgeLastSyncedAt: string | null;
  bridgeLastError: string | null;
  onUpdateBridgeConfig: (patch: Partial<BridgeConfig>) => void;
  onTestBridgeConnection: () => Promise<void>;
  onSyncMasterNow: () => Promise<boolean | void>;
  onClearAuditLogs: () => void;
  onAddUser: (user: AppUser) => void;
  onUpdateUser: (userId: string, patch: Partial<AppUser>) => void;
  onDeleteUser: (userId: string) => void;
  onSwitchUserLogout: () => void;
  onRequestConfirm: (req: ConfirmDialogRequest) => void;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  users,
  currentUser,
  tasks,
  auditLogs,
  bridgeStatus,
  bridgeDiagnosticReport,
  checkingBridge,
  bridgeConfig,
  bridgeSyncState,
  bridgeLastSyncedAt,
  bridgeLastError,
  onUpdateBridgeConfig,
  onTestBridgeConnection,
  onSyncMasterNow,
  onClearAuditLogs,
  onAddUser,
  onUpdateUser,
  onDeleteUser,
  onSwitchUserLogout,
  onRequestConfirm,
  onNotify,
}) => {
  // Active Settings sub-tab
  const [activeTab, setActiveTab] = useState<SettingsTab>('overview');

  // Server-side Google Apps Script Bridge API logs
  const [bridgeLogs, setBridgeLogs] = useState<BridgeApiLogEntry[]>([]);
  const [loadingBridgeLogs, setLoadingBridgeLogs] = useState(false);

  const loadBridgeLogs = useCallback(async () => {
    setLoadingBridgeLogs(true);
    try {
      const entries = await fetchBridgeLogs();
      setBridgeLogs(entries);
    } finally {
      setLoadingBridgeLogs(false);
    }
  }, []);

  useEffect(() => {
    loadBridgeLogs();
  }, [loadBridgeLogs, bridgeDiagnosticReport?.checkedAt, bridgeLastSyncedAt]);

  useEffect(() => {
    if (activeTab === 'bridge-logs') {
      loadBridgeLogs();
    }
  }, [activeTab, loadBridgeLogs]);

  const handleCheckConnectionAndRefreshLogs = useCallback(async () => {
    await onTestBridgeConnection();
    await loadBridgeLogs();
  }, [onTestBridgeConnection, loadBridgeLogs]);

  const handleSyncMasterAndRefreshLogs = useCallback(async () => {
    await onSyncMasterNow();
    await loadBridgeLogs();
  }, [onSyncMasterNow, loadBridgeLogs]);

  const handleClearBridgeLogs = useCallback(async () => {
    const ok = await clearBridgeLogs();
    if (ok) {
      setBridgeLogs([]);
      onNotify('Cleared Google Apps Script bridge API logs.');
    } else {
      onNotify('Failed to clear bridge API logs on the server.', 'error');
    }
  }, [onNotify]);

  const failedBridgeLogCount = useMemo(
    () => bridgeLogs.filter((entry) => !entry.ok).length,
    [bridgeLogs]
  );

  // Create user form state
  const [newUsername, setNewUsername] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('user');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Reset password modal state
  const [resetTarget, setResetTarget] = useState<AppUser | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);

  // Edit user modal state
  const [editTarget, setEditTarget] = useState<AppUser | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editFullName, setEditFullName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('user');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editNewPassword, setEditNewPassword] = useState('');
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Registered user search filter
  const [userSearchQuery, setUserSearchQuery] = useState('');

  // Count how many rows each username is tagged on
  const taggedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of tasks) {
      const key = (row.assignedUser || '').trim().toLowerCase();
      if (key) {
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return counts;
  }, [tasks]);

  const activeAdminCount = useMemo(
    () => users.filter((u) => u.role === 'admin' && u.isActive).length,
    [users]
  );

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const cleanedUsername = newUsername.trim();
    if (!cleanedUsername) {
      setCreateError('Please enter a User ID.');
      return;
    }
    if (/\s/.test(cleanedUsername)) {
      setCreateError('User ID cannot contain spaces.');
      return;
    }
    if (newPassword.length < 4) {
      setCreateError('Password must be at least 4 characters long.');
      return;
    }

    const exists = users.some(
      (u) => u.username.toLowerCase() === cleanedUsername.toLowerCase()
    );
    if (exists) {
      setCreateError(`User ID "${cleanedUsername}" already exists.`);
      return;
    }

    setIsCreating(true);
    try {
      const passwordHash = await hashPassword(newPassword);
      const created: AppUser = {
        id: crypto.randomUUID(),
        username: cleanedUsername,
        fullName: newFullName.trim() || cleanedUsername,
        passwordHash,
        role: newRole,
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      onAddUser(created);
      setNewUsername('');
      setNewFullName('');
      setNewPassword('');
      setNewRole('user');
      onNotify(
        `Created user "${created.username}". It is now available in the Action to Do drop-down.`
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    if (resetPasswordValue.length < 4) {
      onNotify('Password must be at least 4 characters long.', 'error');
      return;
    }
    const passwordHash = await hashPassword(resetPasswordValue);
    onUpdateUser(resetTarget.id, { passwordHash });
    onNotify(`Updated password for "${resetTarget.username}".`);
    setResetTarget(null);
    setResetPasswordValue('');
    setShowResetPassword(false);
  };

  const handleOpenEditUser = (target: AppUser) => {
    setEditTarget(target);
    setEditUsername(target.username);
    setEditFullName(target.fullName || target.username);
    setEditRole(target.role);
    setEditIsActive(target.isActive);
    setEditNewPassword('');
    setShowEditPassword(false);
    setEditError(null);
  };

  const handleEditUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setEditError(null);

    const cleanedUsername = editUsername.trim();
    if (!cleanedUsername) {
      setEditError('User ID cannot be empty.');
      return;
    }
    if (/\s/.test(cleanedUsername)) {
      setEditError('User ID cannot contain spaces.');
      return;
    }

    const duplicate = users.some(
      (u) =>
        u.id !== editTarget.id &&
        u.username.trim().toLowerCase() === cleanedUsername.toLowerCase()
    );
    if (duplicate) {
      setEditError(`User ID "${cleanedUsername}" is already taken.`);
      return;
    }

    const isSelf = editTarget.id === currentUser.id;
    if (isSelf && !editIsActive) {
      setEditError('You cannot disable the account you are currently signed into.');
      return;
    }

    const wasActiveAdmin = editTarget.role === 'admin' && editTarget.isActive;
    const willBeActiveAdmin = editRole === 'admin' && editIsActive;
    if (wasActiveAdmin && !willBeActiveAdmin && activeAdminCount <= 1) {
      setEditError('At least one active Admin account must remain.');
      return;
    }

    if (editNewPassword && editNewPassword.length < 4) {
      setEditError('New password must be at least 4 characters long.');
      return;
    }

    setIsSavingEdit(true);
    try {
      const patch: Partial<AppUser> = {
        username: cleanedUsername,
        fullName: editFullName.trim() || cleanedUsername,
        role: editRole,
        isActive: editIsActive,
      };
      if (editNewPassword) {
        patch.passwordHash = await hashPassword(editNewPassword);
      }
      onUpdateUser(editTarget.id, patch);
      onNotify(`Saved changes to user account "${cleanedUsername}".`);
      setEditTarget(null);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const q = userSearchQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        (u.fullName || '').toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
    );
  }, [users, userSearchQuery]);

  const handleToggleUserStatus = (target: AppUser) => {
    if (target.role === 'admin' && target.isActive && activeAdminCount <= 1) {
      onNotify('At least one active Admin account is required.', 'error');
      return;
    }
    if (target.id === currentUser.id) {
      onNotify('You cannot disable the account you are currently signed into.', 'error');
      return;
    }
    onUpdateUser(target.id, { isActive: !target.isActive });
    onNotify(
      target.isActive
        ? `Disabled access for "${target.username}".`
        : `Re-enabled access for "${target.username}".`
    );
  };

  const handleRequestDeleteUser = (target: AppUser) => {
    if (target.role === 'admin' && target.isActive && activeAdminCount <= 1) {
      onNotify('At least one active Admin account must remain.', 'error');
      return;
    }
    if (target.id === currentUser.id) {
      onNotify('You cannot delete the account you are currently signed into.', 'error');
      return;
    }

    const rowCount = taggedCounts.get(target.username.toLowerCase()) || 0;
    onRequestConfirm({
      title: `Delete User "${target.username}"?`,
      description:
        rowCount > 0
          ? `This user will no longer be able to sign in. ${rowCount} existing task ${
              rowCount === 1 ? 'row is' : 'rows are'
            } currently tagged to "${target.username}" and will remain in the ledger for Admins.`
          : `Remove "${target.username}" from the Settings directory? This user will no longer be able to sign in.`,
      confirmLabel: 'Delete User',
      tone: 'danger',
      onConfirm: () => {
        onDeleteUser(target.id);
        onNotify(`Deleted user "${target.username}".`);
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Access Control Header */}
      <section className="rounded-lg border border-slate-200 bg-white px-6 py-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#1A365D]">
              Settings & User Access
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              Create User IDs and passwords to control who can sign in. Every username
              created here appears in the Action to Do drop-down menu, and signed-in
              users only see rows tagged to their User ID.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onSwitchUserLogout}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap"
            >
              <LogOut className="h-3.5 w-3.5 text-[#1A365D]" />
              Sign Out / Switch User
            </button>
          </div>
        </div>

        {/* Prominent Master Sheet Sync Status Indicator */}
        {(() => {
          const isSyncing = bridgeSyncState === 'syncing' || checkingBridge;
          const hasError =
            bridgeSyncState === 'error' ||
            Boolean(bridgeLastError) ||
            Boolean(bridgeStatus?.configured && !bridgeStatus?.connected);
          const isHealthy =
            !isSyncing &&
            !hasError &&
            (bridgeSyncState === 'synced' || Boolean(bridgeStatus?.connected));
          const syncTs = formatMasterSyncTimestamp(
            bridgeLastSyncedAt || bridgeConfig.lastSyncedAt
          );

          const healthLabel = isSyncing
            ? 'Syncing'
            : hasError
              ? 'Error'
              : isHealthy
                ? 'Success'
                : 'Awaiting Setup';

          const healthTextClass = isSyncing
            ? 'text-[#1A365D]'
            : hasError
              ? 'text-red-700'
              : isHealthy
                ? 'text-emerald-700'
                : 'text-amber-700';

          const barToneClass = isSyncing
            ? 'border-[#1A365D]/20 bg-[#F4F8FC]'
            : hasError
              ? 'border-red-200 bg-red-50/50'
              : isHealthy
                ? 'border-emerald-200/80 bg-emerald-50/40'
                : 'border-slate-200 bg-[#F9FBFD]';

          const detailNote = isSyncing
            ? checkingBridge
              ? 'Verifying Google Apps Script connection and BRIDGE_SECRET...'
              : `Writing active tasks to "${bridgeConfig.masterSheetTitle}"...`
            : hasError
              ? bridgeLastError ||
                bridgeStatus?.error ||
                'Master Sheet sync encountered an error.'
              : isHealthy
                ? bridgeConfig.autoSyncEnabled
                  ? `Auto-sync enabled (${bridgeConfig.debounceSeconds}s delay) · "${bridgeConfig.masterSheetTitle}"`
                  : `Auto-sync paused · Manual sync active for "${bridgeConfig.masterSheetTitle}"`
                : 'Deploy the Apps Script bridge below to enable automatic Master Sheet syncing.';

          return (
            <div
              role="status"
              aria-live="polite"
              className={`mt-5 flex flex-col gap-3 rounded-md border px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between ${barToneClass}`}
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="mt-0.5 shrink-0">
                  {isSyncing ? (
                    <Loader2
                      className="h-5 w-5 animate-spin text-[#1A365D]"
                      aria-hidden="true"
                    />
                  ) : hasError ? (
                    <AlertCircle
                      className="h-5 w-5 text-red-700"
                      aria-hidden="true"
                    />
                  ) : isHealthy ? (
                    <CheckCircle2
                      className="h-5 w-5 text-emerald-700"
                      aria-hidden="true"
                    />
                  ) : (
                    <Clock
                      className="h-5 w-5 text-amber-700"
                      aria-hidden="true"
                    />
                  )}
                </div>

                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                    <span className="font-semibold text-slate-900">
                      Sync Status:
                    </span>
                    <span className={`font-semibold ${healthTextClass}`}>
                      {healthLabel}
                    </span>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-slate-600">
                      Last successful Master Sheet sync:{' '}
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        {syncTs.exact}
                      </span>
                      {syncTs.relative && (
                        <span className="ml-1.5 text-slate-500 tabular-nums">
                          ({syncTs.relative})
                        </span>
                      )}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed truncate">
                    {detailNote}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0 pl-8 lg:pl-0">
                {bridgeConfig.masterSheetUrl && (
                  <a
                    href={bridgeConfig.masterSheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-[#1A365D] transition-colors hover:bg-slate-50 whitespace-nowrap"
                  >
                    Open Master Sheet
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}

                {hasError && activeTab !== 'bridge-logs' && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('bridge-logs')}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 whitespace-nowrap"
                  >
                    <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                    View Bridge Logs
                  </button>
                )}

                {bridgeStatus?.connected ? (
                  <button
                    type="button"
                    onClick={handleSyncMasterAndRefreshLogs}
                    disabled={isSyncing}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[#1A365D] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#132948] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${
                        bridgeSyncState === 'syncing' ? 'animate-spin' : ''
                      }`}
                      aria-hidden="true"
                    />
                    {bridgeSyncState === 'syncing' ? 'Syncing...' : 'Sync Now'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleCheckConnectionAndRefreshLogs}
                    disabled={isSyncing}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${
                        checkingBridge ? 'animate-spin' : ''
                      }`}
                      aria-hidden="true"
                    />
                    Check Connection
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        {/* Settings Sub-Navigation Tabs */}
        <div
          role="tablist"
          aria-label="Settings sections"
          className="mt-4 flex flex-wrap items-center gap-1 border-t border-slate-200 pt-4"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'overview'}
            onClick={() => setActiveTab('overview')}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'overview'
                ? 'bg-[#E6F0FA] text-[#1A365D] font-semibold'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Shield className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Users &amp; Drive Bridge
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'bridge-logs'}
            onClick={() => setActiveTab('bridge-logs')}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'bridge-logs'
                ? 'bg-[#E6F0FA] text-[#1A365D] font-semibold'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Activity className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Bridge Logs
            {bridgeLogs.length > 0 && (
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  failedBridgeLogCount > 0 ? 'text-red-700 font-semibold' : 'text-slate-500'
                }`}
              >
                ({bridgeLogs.length}
                {failedBridgeLogCount > 0 ? ` · ${failedBridgeLogCount} err` : ''})
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'audit-log'}
            onClick={() => setActiveTab('audit-log')}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'audit-log'
                ? 'bg-[#E6F0FA] text-[#1A365D] font-semibold'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <History className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Audit Log
            {auditLogs.length > 0 && (
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                ({auditLogs.length})
              </span>
            )}
          </button>
        </div>
      </section>

      {activeTab === 'overview' && (
        <>
          {/* Main 2-Column Layout: Create User + User Directory */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Create User ID & Password Form */}
        <section className="rounded-lg border border-slate-200 bg-white lg:col-span-4">
          <div className="border-b border-slate-200 px-6 py-4">
            <div className="flex items-center gap-2 text-[#1A365D]">
              <UserPlus className="h-4 w-4 shrink-0" aria-hidden="true" />
              <h2 className="text-base font-semibold">Create User ID & Password</h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-600">
              New usernames are immediately added to the table’s Action drop-down menu.
            </p>
          </div>

          <form onSubmit={handleCreateUser} className="space-y-4 px-6 py-5">
            {createError && (
              <div
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800"
              >
                {createError}
              </div>
            )}

            <div>
              <label
                htmlFor="settings-new-username"
                className="block text-xs font-semibold text-slate-700"
              >
                User ID (Username)
              </label>
              <input
                id="settings-new-username"
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="e.g. rahim, farhana, associate01"
                className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-[#1A365D] focus:outline-none focus:ring-1 focus:ring-[#1A365D]"
                required
              />
            </div>

            <div>
              <label
                htmlFor="settings-new-fullname"
                className="block text-xs font-semibold text-slate-700"
              >
                Full Name (optional)
              </label>
              <input
                id="settings-new-fullname"
                type="text"
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                placeholder="e.g. Rahim Uddin"
                className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#1A365D] focus:outline-none focus:ring-1 focus:ring-[#1A365D]"
              />
            </div>

            <div>
              <label
                htmlFor="settings-new-password"
                className="block text-xs font-semibold text-slate-700"
              >
                Password
              </label>
              <div className="relative mt-1.5">
                <input
                  id="settings-new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 4 characters"
                  className="w-full rounded-md border border-slate-300 py-2 pl-3 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#1A365D] focus:outline-none focus:ring-1 focus:ring-[#1A365D]"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((prev) => !prev)}
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  {showNewPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="settings-new-role"
                className="block text-xs font-semibold text-slate-700"
              >
                Access Level
              </label>
              <select
                id="settings-new-role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none focus:ring-1 focus:ring-[#1A365D]"
              >
                <option value="user">Standard User — Sees only tagged rows</option>
                <option value="admin">Admin — Sees all rows & Settings</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={isCreating}
              className="w-full rounded-md bg-[#1A365D] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#132948] disabled:opacity-60"
            >
              {isCreating ? 'Creating...' : 'Create User Account'}
            </button>
          </form>
        </section>

        {/* Registered Users Directory */}
        <section className="rounded-xl border border-slate-200/95 bg-white shadow-2xs lg:col-span-8 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[#1A365D]">
                <Shield className="h-4 w-4 shrink-0" aria-hidden="true" />
                <h2 className="text-base font-bold">Registered User Accounts</h2>
                <span className="rounded-full bg-[#1A365D]/10 px-2.5 py-0.5 font-mono text-xs font-semibold text-[#1A365D] tabular-nums">
                  {users.length}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Manage login credentials, access roles, and active status for all workspace users.
              </p>
            </div>

            <div className="relative w-full sm:w-56">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="text"
                value={userSearchQuery}
                onChange={(e) => setUserSearchQuery(e.target.value)}
                placeholder="Search user ID or name..."
                className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-7 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#1A365D] focus:outline-none focus:ring-2 focus:ring-[#1A365D]/15"
              />
              {userSearchQuery && (
                <button
                  type="button"
                  onClick={() => setUserSearchQuery('')}
                  aria-label="Clear user search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-gradient-to-b from-[#EDF4FC] to-[#E1ECF8] text-left text-xs font-bold text-[#0F2547]">
                  <th className="px-6 py-3">User ID</th>
                  <th className="px-4 py-3">Full Name</th>
                  <th className="px-4 py-3">Access Role</th>
                  <th className="px-4 py-3 text-right">Tagged Rows</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-8 text-center text-xs text-slate-500"
                    >
                      No registered user accounts match &ldquo;{userSearchQuery}&rdquo;.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const rowCount = taggedCounts.get(u.username.toLowerCase()) || 0;
                    const isSelf = u.id === currentUser.id;
                    const initials = (u.fullName || u.username || 'U')
                      .trim()
                      .slice(0, 2)
                      .toUpperCase();
                    return (
                      <tr
                        key={u.id}
                        className="transition-colors hover:bg-[#F5F9FD]"
                      >
                        <td className="px-6 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2.5">
                            <span
                              className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-[11px] font-bold ${
                                u.role === 'admin'
                                  ? 'bg-[#1A365D] text-white'
                                  : 'bg-slate-200 text-slate-700'
                              }`}
                            >
                              {initials}
                            </span>
                            <div>
                              <span className="font-mono text-xs font-bold text-slate-900">
                                {u.username}
                              </span>
                              {isSelf && (
                                <span className="ml-2 inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-[#1A365D]">
                                  Current Session
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-xs font-medium text-slate-700 whitespace-nowrap">
                          {u.fullName || u.username}
                        </td>
                        <td className="px-4 py-3.5 text-xs whitespace-nowrap">
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                              u.role === 'admin'
                                ? 'bg-[#1A365D]/10 text-[#1A365D]'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {u.role === 'admin' ? 'Admin' : 'Standard User'}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-xs font-semibold text-slate-700 tabular-nums">
                          {rowCount}
                        </td>
                        <td className="px-4 py-3.5 text-xs whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                              u.isActive
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-red-50 text-red-700'
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                u.isActive ? 'bg-emerald-500' : 'bg-red-500'
                              }`}
                            />
                            {u.isActive ? 'Active' : 'Disabled'}
                          </span>
                        </td>
                        <td className="px-6 py-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5 text-xs">
                            <button
                              type="button"
                              onClick={() => handleOpenEditUser(u)}
                              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 transition-colors hover:border-[#1A365D]/40 hover:bg-slate-50 hover:text-[#1A365D]"
                            >
                              <Pencil className="h-3 w-3" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setResetTarget(u);
                                setResetPasswordValue('');
                                setShowResetPassword(false);
                              }}
                              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 font-semibold text-[#1A365D] transition-colors hover:border-[#1A365D]/40 hover:bg-blue-50/50"
                            >
                              <KeyRound className="h-3 w-3" />
                              Password
                            </button>
                            {!isSelf && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleToggleUserStatus(u)}
                                  title={u.isActive ? 'Disable login access' : 'Enable login access'}
                                  className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 font-semibold transition-colors ${
                                    u.isActive
                                      ? 'border-slate-200 bg-white text-slate-600 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-200'
                                      : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                  }`}
                                >
                                  <Power className="h-3 w-3" />
                                  {u.isActive ? 'Disable' : 'Enable'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRequestDeleteUser(u)}
                                  title={`Delete user ${u.username}`}
                                  aria-label={`Delete user ${u.username}`}
                                  className="inline-flex cursor-pointer items-center justify-center rounded-md border border-red-200/80 bg-red-50/50 p-1.5 text-red-700 transition-colors hover:bg-red-100"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

          {/* Automatic Drive Folder Bridge Configuration */}
          <DriveBridgeSettingsSection
            bridgeStatus={bridgeStatus}
            diagnosticReport={bridgeDiagnosticReport}
            checkingBridge={checkingBridge}
            bridgeConfig={bridgeConfig}
            syncState={bridgeSyncState}
            lastSyncedAt={bridgeLastSyncedAt}
            lastError={bridgeLastError}
            onUpdateBridgeConfig={onUpdateBridgeConfig}
            onTestBridgeConnection={handleCheckConnectionAndRefreshLogs}
            onSyncMasterNow={handleSyncMasterAndRefreshLogs}
            onRefreshBridgeLogs={loadBridgeLogs}
            onNotify={onNotify}
          />
        </>
      )}

      {/* Dedicated Bridge Logs Tab */}
      {activeTab === 'bridge-logs' && (
        <BridgeLogsSection
          logs={bridgeLogs}
          loading={loadingBridgeLogs}
          checkingConnection={checkingBridge}
          onRefreshLogs={loadBridgeLogs}
          onCheckConnection={handleCheckConnectionAndRefreshLogs}
          onClearLogs={handleClearBridgeLogs}
          onRequestConfirm={onRequestConfirm}
          onNotify={onNotify}
        />
      )}

      {/* Dedicated Global Audit Log Tab (Admin-only) */}
      {activeTab === 'audit-log' && (
        <AuditLogViewerSection
          logs={auditLogs}
          onClearLogs={onClearAuditLogs}
          onRequestConfirm={onRequestConfirm}
          onNotify={onNotify}
        />
      )}

      {/* Edit User Account Modal */}
      {editTarget && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-user-title"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-6 py-4">
              <div>
                <h3
                  id="edit-user-title"
                  className="text-base font-bold text-[#1A365D]"
                >
                  Edit User Account
                </h3>
                <p className="mt-0.5 text-xs text-slate-600">
                  Update credentials, display name, or role for{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    {editTarget.username}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                aria-label="Close edit user dialog"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleEditUserSubmit}>
              <div className="space-y-4 px-6 py-5">
                {editError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800"
                  >
                    {editError}
                  </div>
                )}

                <div>
                  <label
                    htmlFor="edit-user-username"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    User ID (Username)
                  </label>
                  <input
                    id="edit-user-username"
                    type="text"
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none focus:ring-2 focus:ring-[#1A365D]/15"
                    required
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Renaming User ID automatically updates any task rows tagged to this user.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="edit-user-fullname"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Full Name
                  </label>
                  <input
                    id="edit-user-fullname"
                    type="text"
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none focus:ring-2 focus:ring-[#1A365D]/15"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="edit-user-role"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Access Role
                    </label>
                    <select
                      id="edit-user-role"
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value as UserRole)}
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#1A365D] focus:outline-none focus:ring-2 focus:ring-[#1A365D]/15"
                    >
                      <option value="user">Standard User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="edit-user-status"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Account Status
                    </label>
                    <select
                      id="edit-user-status"
                      value={editIsActive ? 'active' : 'disabled'}
                      disabled={editTarget.id === currentUser.id}
                      onChange={(e) => setEditIsActive(e.target.value === 'active')}
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#1A365D] focus:outline-none focus:ring-2 focus:ring-[#1A365D]/15 disabled:bg-slate-100 disabled:text-slate-500"
                    >
                      <option value="active">Active</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="edit-user-password"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    New Password (optional — leave blank to keep current)
                  </label>
                  <div className="relative mt-1.5">
                    <input
                      id="edit-user-password"
                      type={showEditPassword ? 'text' : 'password'}
                      value={editNewPassword}
                      onChange={(e) => setEditNewPassword(e.target.value)}
                      placeholder="Enter new password to change..."
                      className="w-full rounded-lg border border-slate-300 py-2 pl-3 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#1A365D] focus:outline-none focus:ring-2 focus:ring-[#1A365D]/15"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEditPassword((prev) => !prev)}
                      aria-label={showEditPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    >
                      {showEditPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2.5 border-t border-slate-200 bg-slate-50/70 px-6 py-3.5">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="cursor-pointer rounded-lg bg-[#1A365D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132948] disabled:opacity-60"
                >
                  {isSavingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-password-title"
        >
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-6 py-4">
              <h3
                id="reset-password-title"
                className="text-base font-semibold text-[#1A365D]"
              >
                Reset Password
              </h3>
              <p className="mt-0.5 text-xs text-slate-600">
                Set a new password for User ID{' '}
                <span className="font-mono font-semibold text-slate-900">
                  {resetTarget.username}
                </span>
                .
              </p>
            </div>
            <form onSubmit={handleResetPasswordSubmit}>
              <div className="px-6 py-5">
                <label
                  htmlFor="reset-password-input"
                  className="block text-xs font-semibold text-slate-700"
                >
                  New Password
                </label>
                <div className="relative mt-1.5">
                  <input
                    id="reset-password-input"
                    type={showResetPassword ? 'text' : 'password'}
                    value={resetPasswordValue}
                    onChange={(e) => setResetPasswordValue(e.target.value)}
                    placeholder="Minimum 4 characters"
                    className="w-full rounded-md border border-slate-300 py-2 pl-3 pr-9 text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none focus:ring-1 focus:ring-[#1A365D]"
                    autoFocus
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPassword((prev) => !prev)}
                    aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  >
                    {showResetPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="flex justify-end gap-2.5 border-t border-slate-200 bg-slate-50/70 px-6 py-3.5 rounded-b-lg">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-[#1A365D] px-4 py-2 text-xs font-medium text-white hover:bg-[#132948]"
                >
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
