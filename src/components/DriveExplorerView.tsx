import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  CloudUpload,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderPlus,
  Link2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  DRIVE_FOLDER_MIME,
  isRowPopulated,
  type ConfirmDialogRequest,
  type DriveFileItem,
  type TaskRow,
} from '../types/task';
import {
  DriveAuthError,
  LEDGER_APP_PROPERTY_KEY,
  createDriveFolder,
  deleteDriveFile,
  exportCsvToDrive,
  formatFileSize,
  getFriendlyMimeLabel,
  listDriveFiles,
  loadLedgerFromDrive,
  saveLedgerToDrive,
  uploadFileToDrive,
  type DriveFilterType,
} from '../services/googleDrive';
import { buildTaskLedgerCsv } from '../utils/csvExport';
import { GoogleSignInButton } from './GoogleSignInButton';
import type { AppUser } from '../types/auth';

interface DriveExplorerViewProps {
  tasks: TaskRow[];
  users: AppUser[];
  isAdmin: boolean;
  currencySymbol: string;
  isSignedIn: boolean;
  isSigningIn: boolean;
  syncedDriveFileId: string | null;
  syncedDriveFileName: string | null;
  onSignIn: () => void;
  onSessionExpired: () => void;
  onRequestConfirm: (req: ConfirmDialogRequest) => void;
  onLedgerSynced: (file: DriveFileItem) => void;
  onRestoreTasksFromDrive: (
    tasks: TaskRow[],
    currencySymbol?: string,
    sourceFile?: DriveFileItem,
    restoredUsers?: AppUser[]
  ) => void;
  onAttachFileToRow: (
    taskId: string,
    payload: {
      driveLink: string;
      driveFileId: string;
      driveFileName: string;
      driveMimeType: string;
    }
  ) => void;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
}

interface FolderCrumb {
  id: string;
  name: string;
}

export const DriveExplorerView: React.FC<DriveExplorerViewProps> = ({
  tasks,
  users,
  isAdmin,
  currencySymbol,
  isSignedIn,
  isSigningIn,
  syncedDriveFileId,
  syncedDriveFileName,
  onSignIn,
  onSessionExpired,
  onRequestConfirm,
  onLedgerSynced,
  onRestoreTasksFromDrive,
  onAttachFileToRow,
  onNotify,
}) => {
  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<DriveFilterType>('all');
  const [folderTrail, setFolderTrail] = useState<FolderCrumb[]>([]);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [linkingFile, setLinkingFile] = useState<DriveFileItem | null>(null);
  const [selectedTargetRowId, setSelectedTargetRowId] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentFolderId =
    folderTrail.length > 0 ? folderTrail[folderTrail.length - 1].id : undefined;

  const loadFiles = async () => {
    if (!isSignedIn) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const result = await listDriveFiles({
        searchQuery,
        folderId: searchQuery.trim() || filterType !== 'all' ? undefined : currentFolderId,
        filterType,
        pageSize: 50,
      });
      setFiles(result);
    } catch (err) {
      if (err instanceof DriveAuthError) {
        onSessionExpired();
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Unable to fetch Google Drive files.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isSignedIn) return;
    const timer = window.setTimeout(() => {
      loadFiles();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [isSignedIn, searchQuery, filterType, currentFolderId]);

  if (!isSignedIn) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-8 py-16 text-center">
        <Folder className="mx-auto h-10 w-10 text-[#1A365D]/75" aria-hidden="true" />
        <h2 className="mt-4 text-xl font-semibold text-[#1A365D]">
          Connect Google Drive
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-600">
          Sign in with your Google account to browse client folders, upload legal or
          billing documents, attach Drive links directly to any row in your Task Plan,
          and save or restore ledger backups in Google Drive.
        </p>
        <div className="mt-6 flex justify-center">
          <GoogleSignInButton onClick={onSignIn} disabled={isSigningIn} />
        </div>
      </div>
    );
  }

  const handleSaveBackupToDrive = () => {
    const populatedCount = tasks.filter(isRowPopulated).length;
    const isUpdatingExisting = Boolean(syncedDriveFileId);
    const targetName = syncedDriveFileName || 'Task_Plan_and_Status_Ledger.json';

    onRequestConfirm({
      title: isUpdatingExisting
        ? 'Update Task Plan backup in Google Drive?'
        : 'Save Task Plan backup to Google Drive?',
      description: isUpdatingExisting
        ? `This will overwrite "${targetName}" in your Google Drive with your current ${tasks.length} rows (${populatedCount} populated).`
        : `This will create "${targetName}" in your Google Drive containing your current ${tasks.length} rows (${populatedCount} populated).`,
      confirmLabel: isUpdatingExisting ? 'Overwrite Backup' : 'Save to Drive',
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
          onLedgerSynced(saved);
          onNotify(`Saved "${saved.name}" to Google Drive.`);
          await loadFiles();
        } catch (err) {
          if (err instanceof DriveAuthError) {
            onSessionExpired();
          } else {
            onNotify(
              err instanceof Error ? err.message : 'Failed to save ledger to Drive.',
              'error'
            );
          }
        }
      },
    });
  };

  const handleExportCsvToDrive = () => {
    const dateStamp = new Date().toISOString().slice(0, 10);
    const fileName = `Task_Plan_and_Status_${dateStamp}.csv`;

    onRequestConfirm({
      title: 'Export CSV snapshot to Google Drive?',
      description: `A new CSV spreadsheet file named "${fileName}" will be uploaded to your Google Drive with all 12 columns from your Task Plan.`,
      confirmLabel: 'Export to Drive',
      tone: 'primary',
      onConfirm: async () => {
        try {
          const csv = buildTaskLedgerCsv(tasks);
          const created = await exportCsvToDrive(csv, fileName);
          onNotify(`Exported "${created.name}" to Google Drive.`);
          await loadFiles();
        } catch (err) {
          if (err instanceof DriveAuthError) {
            onSessionExpired();
          } else {
            onNotify(
              err instanceof Error ? err.message : 'Failed to export CSV to Drive.',
              'error'
            );
          }
        }
      },
    });
  };

  const handleCreateFolderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;

    const destinationLabel =
      folderTrail.length > 0
        ? folderTrail[folderTrail.length - 1].name
        : 'My Drive root';

    onRequestConfirm({
      title: 'Create new folder in Google Drive?',
      description: `Create folder "${trimmed}" inside ${destinationLabel}?`,
      confirmLabel: 'Create Folder',
      tone: 'primary',
      onConfirm: async () => {
        try {
          await createDriveFolder(trimmed, currentFolderId);
          setNewFolderName('');
          setShowNewFolderInput(false);
          onNotify(`Created folder "${trimmed}" in Google Drive.`);
          await loadFiles();
        } catch (err) {
          if (err instanceof DriveAuthError) {
            onSessionExpired();
          } else {
            onNotify(
              err instanceof Error ? err.message : 'Failed to create Drive folder.',
              'error'
            );
          }
        }
      },
    });
  };

  const handleUploadFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const destinationLabel =
      folderTrail.length > 0
        ? folderTrail[folderTrail.length - 1].name
        : 'My Drive root';

    onRequestConfirm({
      title: 'Upload file to Google Drive?',
      description: `Upload "${file.name}" (${formatFileSize(String(file.size))}) into ${destinationLabel}?`,
      confirmLabel: 'Upload File',
      tone: 'primary',
      onConfirm: async () => {
        try {
          await uploadFileToDrive(file, currentFolderId);
          onNotify(`Uploaded "${file.name}" to Google Drive.`);
          await loadFiles();
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

  const handleDeleteAppFile = (item: DriveFileItem) => {
    onRequestConfirm({
      title: 'Delete file from Google Drive?',
      description: `Permanently delete "${item.name}" from Google Drive? This action cannot be undone.`,
      details: [
        `Type: ${getFriendlyMimeLabel(item.mimeType)}`,
        `ID: ${item.id}`,
      ],
      confirmLabel: 'Delete Permanently',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await deleteDriveFile(item.id);
          onNotify(`Deleted "${item.name}" from Google Drive.`);
          await loadFiles();
        } catch (err) {
          if (err instanceof DriveAuthError) {
            onSessionExpired();
          } else {
            onNotify(
              err instanceof Error
                ? err.message
                : 'Unable to delete this file. Only files created by this app can be deleted.',
              'error'
            );
          }
        }
      },
    });
  };

  const handleRestoreLedger = (item: DriveFileItem) => {
    onRequestConfirm({
      title: 'Restore Task Plan from Google Drive?',
      description: `Load tasks from "${item.name}" and replace your current local Task Plan rows?`,
      confirmLabel: 'Restore Ledger',
      tone: 'primary',
      onConfirm: async () => {
        try {
          const payload = await loadLedgerFromDrive(item.id);
          onRestoreTasksFromDrive(
            payload.tasks,
            payload.currencySymbol,
            item,
            payload.users
          );
          onNotify(`Restored ${payload.tasks.length} rows from "${item.name}".`);
        } catch (err) {
          if (err instanceof DriveAuthError) {
            onSessionExpired();
          } else {
            onNotify(
              err instanceof Error ? err.message : 'Failed to restore ledger from Drive.',
              'error'
            );
          }
        }
      },
    });
  };

  const handleConfirmRowLink = () => {
    if (!linkingFile || !selectedTargetRowId) return;
    const url =
      linkingFile.webViewLink ||
      (linkingFile.mimeType === DRIVE_FOLDER_MIME
        ? `https://drive.google.com/drive/folders/${linkingFile.id}`
        : `https://drive.google.com/file/d/${linkingFile.id}/view`);
    onAttachFileToRow(selectedTargetRowId, {
      driveLink: url,
      driveFileId: linkingFile.id,
      driveFileName: linkingFile.name,
      driveMimeType: linkingFile.mimeType,
    });
    const rowIdx = tasks.findIndex((t) => t.id === selectedTargetRowId);
    onNotify(
      `Linked "${linkingFile.name}" to row ${String(rowIdx + 1).padStart(2, '0')}.`
    );
    setLinkingFile(null);
    setSelectedTargetRowId('');
  };

  const filterTabs: Array<{ id: DriveFilterType; label: string }> = [
    { id: 'all', label: 'All Files' },
    { id: 'folders', label: 'Folders' },
    { id: 'documents', label: 'Docs & Sheets' },
    { id: 'pdfs', label: 'PDFs' },
    { id: 'ledgers', label: 'Ledger Backups' },
  ];

  return (
    <div className="space-y-6">
      {/* Cloud Sync & Actions Bar */}
      <section className="rounded-lg border border-slate-200 bg-white px-6 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#1A365D]">
              Google Drive Workspace & Ledger Sync
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              {syncedDriveFileName
                ? `Active backup file: ${syncedDriveFileName}`
                : 'Save a live JSON backup of your Task Plan or export a CSV spreadsheet directly into Google Drive.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {isAdmin && (
              <button
                type="button"
                onClick={handleSaveBackupToDrive}
                className="inline-flex items-center gap-2 rounded-md bg-[#1A365D] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#132948] whitespace-nowrap"
              >
                <CloudUpload className="h-3.5 w-3.5" />
                {syncedDriveFileId ? 'Update Drive Backup' : 'Save Ledger to Drive'}
              </button>
            )}
            <button
              type="button"
              onClick={handleExportCsvToDrive}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-[#1A365D]" />
              Export CSV to Drive
            </button>
            <button
              type="button"
              onClick={() => setShowNewFolderInput((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap"
            >
              <FolderPlus className="h-3.5 w-3.5 text-[#1A365D]" />
              New Folder
            </button>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleUploadFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap"
            >
              <Upload className="h-3.5 w-3.5 text-[#1A365D]" />
              Upload File
            </button>
          </div>
        </div>

        {showNewFolderInput && (
          <form
            onSubmit={handleCreateFolderSubmit}
            className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-4 sm:flex-row"
          >
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Enter new Google Drive folder name..."
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="rounded-md bg-[#1A365D] px-4 py-2 text-xs font-medium text-white hover:bg-[#132948] whitespace-nowrap"
              >
                Create Folder
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewFolderInput(false);
                  setNewFolderName('');
                }}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Explorer Table */}
      <section className="rounded-lg border border-slate-200 bg-white">
        {/* Search, Filters & Breadcrumbs */}
        <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1">
            {filterTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setFilterType(tab.id);
                  if (tab.id !== 'all') setFolderTrail([]);
                }}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  filterType === tab.id
                    ? 'bg-white text-[#1A365D] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-full md:w-64">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Drive files..."
                className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#1A365D] focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={loadFiles}
              disabled={isLoading}
              aria-label="Refresh Drive files"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Folder Breadcrumb Trail */}
        {folderTrail.length > 0 && !searchQuery.trim() && filterType === 'all' && (
          <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50/70 px-6 py-2 text-xs text-slate-600">
            <button
              type="button"
              onClick={() => setFolderTrail([])}
              className="font-medium text-[#1A365D] hover:underline"
            >
              My Drive
            </button>
            {folderTrail.map((crumb, idx) => (
              <React.Fragment key={crumb.id}>
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                <button
                  type="button"
                  onClick={() => setFolderTrail(folderTrail.slice(0, idx + 1))}
                  className={
                    idx === folderTrail.length - 1
                      ? 'font-semibold text-slate-900'
                      : 'text-[#1A365D] hover:underline'
                  }
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}

        {errorMsg && (
          <div className="border-b border-red-200 bg-red-50 px-6 py-3 text-xs text-red-800">
            {errorMsg}
          </div>
        )}

        {/* Files Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-[#E6F0FA] text-left text-xs font-semibold text-slate-900">
                <th className="px-6 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Last Modified</th>
                <th className="px-4 py-3 text-right">Size</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    <td className="px-6 py-3">
                      <div className="h-4 w-56 rounded bg-slate-200" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-3.5 w-20 rounded bg-slate-200" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-3.5 w-24 rounded bg-slate-200" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="ml-auto h-3.5 w-14 rounded bg-slate-200" />
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="ml-auto h-3.5 w-24 rounded bg-slate-200" />
                    </td>
                  </tr>
                ))
              ) : files.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-12 text-center text-sm text-slate-500"
                  >
                    No Google Drive files match this view.
                  </td>
                </tr>
              ) : (
                files.map((item) => {
                  const isFolder = item.mimeType === DRIVE_FOLDER_MIME;
                  const isLedgerBackup =
                    item.appProperties?.[LEDGER_APP_PROPERTY_KEY] === 'v1';
                  const isAppCreated = item.appProperties?.createdByApp === 'elTaskPlan';

                  return (
                    <tr
                      key={item.id}
                      className="transition-colors hover:bg-[#F5F9FD]"
                    >
                      <td className="px-6 py-2.5">
                        <div className="flex items-center gap-2.5">
                          {isFolder ? (
                            <Folder
                              className="h-4 w-4 shrink-0 text-[#1A365D]"
                              aria-hidden="true"
                            />
                          ) : (
                            <FileText
                              className="h-4 w-4 shrink-0 text-slate-500"
                              aria-hidden="true"
                            />
                          )}
                          {isFolder ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSearchQuery('');
                                setFilterType('all');
                                setFolderTrail((prev) => [
                                  ...prev,
                                  { id: item.id, name: item.name },
                                ]);
                              }}
                              className="text-left font-medium text-[#1A365D] hover:underline"
                            >
                              {item.name}
                            </button>
                          ) : (
                            <span className="font-medium text-slate-900">
                              {item.name}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600 whitespace-nowrap">
                        {isLedgerBackup
                          ? 'Task Plan Backup'
                          : getFriendlyMimeLabel(item.mimeType)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {item.modifiedTime
                          ? new Date(item.modifiedTime).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {formatFileSize(item.size)}
                      </td>
                      <td className="px-6 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-3 text-xs">
                          {isLedgerBackup && isAdmin && (
                            <button
                              type="button"
                              onClick={() => handleRestoreLedger(item)}
                              className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline"
                            >
                              <Download className="h-3.5 w-3.5" />
                              Restore
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setLinkingFile(item);
                              setSelectedTargetRowId(tasks[0]?.id || '');
                            }}
                            className="inline-flex items-center gap-1 font-medium text-[#1A365D] hover:underline"
                          >
                            <Link2 className="h-3.5 w-3.5" />
                            Link to Row
                          </button>
                          {item.webViewLink && (
                            <a
                              href={item.webViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900"
                            >
                              Open
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {isAppCreated && (
                            <button
                              type="button"
                              onClick={() => handleDeleteAppFile(item)}
                              aria-label={`Delete ${item.name} from Google Drive`}
                              className="text-red-700 hover:text-red-800"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
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

      {/* Quick Link-to-Row Dialog */}
      {linkingFile && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-6 py-4">
              <h3 className="text-base font-semibold text-[#1A365D]">
                Link Google Drive Item to Task Row
              </h3>
              <p className="mt-0.5 truncate text-xs text-slate-600">
                {linkingFile.name}
              </p>
            </div>
            <div className="px-6 py-5 space-y-3">
              <label className="block text-xs font-medium text-slate-700">
                Select destination row in Task Plan
              </label>
              <select
                value={selectedTargetRowId}
                onChange={(e) => setSelectedTargetRowId(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none"
              >
                {tasks.map((row, idx) => {
                  const summary = [
                    `Row ${String(idx + 1).padStart(2, '0')}`,
                    row.elInvoiceId.trim(),
                    row.clientName.trim() || row.companyName.trim(),
                    row.taskName.trim() || '(Empty Row)',
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <option key={row.id} value={row.id}>
                      {summary}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="flex justify-end gap-2.5 border-t border-slate-200 bg-slate-50/70 px-6 py-3.5 rounded-b-lg">
              <button
                type="button"
                onClick={() => setLinkingFile(null)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRowLink}
                className="rounded-md bg-[#1A365D] px-4 py-2 text-xs font-medium text-white hover:bg-[#132948]"
              >
                Attach to Row
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
