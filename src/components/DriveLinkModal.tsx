import React, { useEffect, useRef, useState } from 'react';
import {
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
  Link2,
  RefreshCw,
  Search,
  Upload,
  X,
} from 'lucide-react';
import {
  DRIVE_FOLDER_MIME,
  type ConfirmDialogRequest,
  type DriveFileItem,
  type TaskRow,
} from '../types/task';
import {
  DriveAuthError,
  createDriveFolder,
  formatFileSize,
  getFriendlyMimeLabel,
  listDriveFiles,
  uploadFileToDrive,
} from '../services/googleDrive';
import { GoogleSignInButton } from './GoogleSignInButton';

interface DriveLinkModalProps {
  task: TaskRow | null;
  slNo: number;
  isSignedIn: boolean;
  isSigningIn: boolean;
  onSignIn: () => void;
  onSessionExpired: () => void;
  onRequestConfirm: (req: ConfirmDialogRequest) => void;
  onAttachDriveItem: (
    taskId: string,
    payload: {
      driveLink: string;
      driveFileId?: string;
      driveFileName?: string;
      driveMimeType?: string;
    }
  ) => void;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
  onClose: () => void;
}

type ModalTab = 'browse' | 'create' | 'manual';

export const DriveLinkModal: React.FC<DriveLinkModalProps> = ({
  task,
  slNo,
  isSignedIn,
  isSigningIn,
  onSignIn,
  onSessionExpired,
  onRequestConfirm,
  onAttachDriveItem,
  onNotify,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<ModalTab>('browse');
  const [searchQuery, setSearchQuery] = useState('');
  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newFolderName, setNewFolderName] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [manualLabel, setManualLabel] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!task) return;
    const defaultParts = [
      task.elInvoiceId.trim(),
      task.companyName.trim() || task.clientName.trim(),
      task.taskName.trim(),
    ].filter(Boolean);
    setNewFolderName(
      defaultParts.length > 0
        ? defaultParts.join(' - ')
        : `Task ${String(slNo).padStart(2, '0')} Documents`
    );
    setManualUrl(task.driveLink || '');
    setManualLabel(task.driveFileName || '');
    setActiveTab(isSignedIn ? 'browse' : 'browse');
  }, [task, slNo, isSignedIn]);

  const fetchFiles = async (queryText = searchQuery) => {
    if (!isSignedIn) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await listDriveFiles({
        searchQuery: queryText,
        pageSize: 30,
      });
      setFiles(result);
    } catch (err) {
      if (err instanceof DriveAuthError) {
        onSessionExpired();
      } else {
        setLoadError(err instanceof Error ? err.message : 'Unable to load Google Drive files.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!task || !isSignedIn || activeTab !== 'browse') return;
    const timer = window.setTimeout(() => {
      fetchFiles(searchQuery);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [task, isSignedIn, activeTab, searchQuery]);

  if (!task) return null;

  const handleSelectFile = (item: DriveFileItem) => {
    const url =
      item.webViewLink ||
      (item.mimeType === DRIVE_FOLDER_MIME
        ? `https://drive.google.com/drive/folders/${item.id}`
        : `https://drive.google.com/file/d/${item.id}/view`);

    onAttachDriveItem(task.id, {
      driveLink: url,
      driveFileId: item.id,
      driveFileName: item.name,
      driveMimeType: item.mimeType,
    });
    onNotify(`Linked "${item.name}" to row ${String(slNo).padStart(2, '0')}.`);
    onClose();
  };

  const handleCreateFolderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;

    onRequestConfirm({
      title: 'Create folder in Google Drive?',
      description: `A new folder named "${trimmed}" will be created in your Google Drive and attached to Row ${String(slNo).padStart(2, '0')}.`,
      confirmLabel: 'Create Folder',
      tone: 'primary',
      onConfirm: async () => {
        try {
          const created = await createDriveFolder(trimmed);
          const url =
            created.webViewLink ||
            `https://drive.google.com/drive/folders/${created.id}`;
          onAttachDriveItem(task.id, {
            driveLink: url,
            driveFileId: created.id,
            driveFileName: created.name,
            driveMimeType: created.mimeType,
          });
          onNotify(`Created and linked folder "${created.name}".`);
          onClose();
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

  const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    onRequestConfirm({
      title: 'Upload file to Google Drive?',
      description: `Upload "${file.name}" (${formatFileSize(String(file.size))}) to your Google Drive and attach its Drive link to Row ${String(slNo).padStart(2, '0')}?`,
      confirmLabel: 'Upload and Link',
      tone: 'primary',
      onConfirm: async () => {
        try {
          const uploaded = await uploadFileToDrive(file);
          const url =
            uploaded.webViewLink ||
            `https://drive.google.com/file/d/${uploaded.id}/view`;
          onAttachDriveItem(task.id, {
            driveLink: url,
            driveFileId: uploaded.id,
            driveFileName: uploaded.name,
            driveMimeType: uploaded.mimeType,
          });
          onNotify(`Uploaded and linked "${uploaded.name}".`);
          onClose();
        } catch (err) {
          if (err instanceof DriveAuthError) {
            onSessionExpired();
          } else {
            onNotify(
              err instanceof Error ? err.message : 'Failed to upload file to Drive.',
              'error'
            );
          }
        }
      },
    });
  };

  const handleManualSave = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUrl = manualUrl.trim();
    onAttachDriveItem(task.id, {
      driveLink: trimmedUrl,
      driveFileId: undefined,
      driveFileName: manualLabel.trim() || undefined,
      driveMimeType: undefined,
    });
    onNotify(
      trimmedUrl
        ? `Saved Drive link for row ${String(slNo).padStart(2, '0')}.`
        : `Cleared Drive link for row ${String(slNo).padStart(2, '0')}.`
    );
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drive-link-modal-title"
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <h3
              id="drive-link-modal-title"
              className="text-base font-semibold text-[#1A365D]"
            >
              Attach Google Drive Link
            </h3>
            <p className="mt-0.5 text-xs text-slate-600">
              Row <span className="font-mono">{String(slNo).padStart(2, '0')}</span>
              {task.elInvoiceId && (
                <>
                  {' '}
                  · <span className="font-mono">{task.elInvoiceId}</span>
                </>
              )}
              {task.clientName && <> · {task.clientName}</>}
              {task.taskName && <> · {task.taskName}</>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Google Drive picker"
            className="rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Segmented Tabs */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-50/70 px-6 py-2.5">
          <div className="flex items-center gap-1 rounded-md bg-slate-200/70 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('browse')}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === 'browse'
                  ? 'bg-white text-[#1A365D] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Browse Google Drive
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('create')}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === 'create'
                  ? 'bg-white text-[#1A365D] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              New Folder or Upload
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('manual')}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === 'manual'
                  ? 'bg-white text-[#1A365D] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Paste URL
            </button>
          </div>

          {task.driveLink && (
            <button
              type="button"
              onClick={() => {
                onAttachDriveItem(task.id, {
                  driveLink: '',
                  driveFileId: undefined,
                  driveFileName: undefined,
                  driveMimeType: undefined,
                });
                onNotify(`Removed Drive link from row ${String(slNo).padStart(2, '0')}.`);
                onClose();
              }}
              className="text-xs font-medium text-red-700 hover:text-red-800 whitespace-nowrap"
            >
              Remove link
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {activeTab !== 'manual' && !isSignedIn ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Folder className="h-9 w-9 text-[#1A365D]/70" aria-hidden="true" />
              <h4 className="mt-3 text-sm font-semibold text-slate-900">
                Connect Google Drive to browse or create task folders
              </h4>
              <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-600">
                Sign in with your Google account to search existing Drive files, create
                dedicated client folders, or upload documents directly into this row.
              </p>
              <div className="mt-5">
                <GoogleSignInButton onClick={onSignIn} disabled={isSigningIn} />
              </div>
            </div>
          ) : activeTab === 'browse' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search Google Drive files and folders..."
                    className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#1A365D] focus:outline-none focus:ring-1 focus:ring-[#1A365D]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => fetchFiles(searchQuery)}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>

              {loadError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                  {loadError}
                </div>
              )}

              {isLoading ? (
                <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between px-4 py-3 animate-pulse"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-4 w-4 rounded bg-slate-200" />
                        <div className="h-3.5 w-48 rounded bg-slate-200" />
                      </div>
                      <div className="h-3 w-20 rounded bg-slate-200" />
                    </div>
                  ))}
                </div>
              ) : files.length === 0 ? (
                <div className="rounded-md border border-slate-200 py-10 text-center">
                  <p className="text-sm text-slate-600">
                    No matching files or folders found in Google Drive.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('create')}
                    className="mt-3 text-xs font-semibold text-[#1A365D] hover:underline"
                  >
                    Create a new Drive folder instead
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-200 rounded-md border border-slate-200">
                  {files.map((item) => {
                    const isFolder = item.mimeType === DRIVE_FOLDER_MIME;
                    const isSelected = task.driveFileId === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-[#F5F9FD] ${
                          isSelected ? 'bg-[#E6F0FA]/60' : ''
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-3">
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
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">
                              {item.name}
                            </p>
                            <p className="text-xs text-slate-500">
                              {getFriendlyMimeLabel(item.mimeType)}
                              {item.modifiedTime && (
                                <>
                                  {' '}
                                  · Modified{' '}
                                  {new Date(item.modifiedTime).toLocaleDateString()}
                                </>
                              )}
                              {item.size && <> · {formatFileSize(item.size)}</>}
                            </p>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          {item.webViewLink && (
                            <a
                              href={item.webViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open ${item.name} in Google Drive`}
                              className="rounded p-1.5 text-slate-500 hover:bg-slate-200/70 hover:text-slate-900"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => handleSelectFile(item)}
                            className="rounded-md border border-[#1A365D] bg-white px-3 py-1.5 text-xs font-medium text-[#1A365D] transition-colors hover:bg-[#1A365D] hover:text-white whitespace-nowrap"
                          >
                            {isSelected ? 'Linked' : 'Attach'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : activeTab === 'create' ? (
            <div className="space-y-6">
              <form
                onSubmit={handleCreateFolderSubmit}
                className="space-y-3 border-b border-slate-200 pb-6"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <FolderPlus className="h-4 w-4 text-[#1A365D]" aria-hidden="true" />
                  <span>Create a dedicated Google Drive folder</span>
                </div>
                <p className="text-xs text-slate-600">
                  Creates a new folder in your Google Drive and automatically inserts its
                  link into this task row.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="e.g. EL-2026-014 - Acme Corp - RJSC Filing"
                    className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none focus:ring-1 focus:ring-[#1A365D]"
                    required
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-[#1A365D] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#132948] whitespace-nowrap"
                  >
                    Create & Link
                  </button>
                </div>
              </form>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Upload className="h-4 w-4 text-[#1A365D]" aria-hidden="true" />
                  <span>Upload a document to Google Drive</span>
                </div>
                <p className="text-xs text-slate-600">
                  Select any PDF, DOCX, spreadsheet, or scanned copy from your computer to
                  upload directly to Google Drive and link to this task.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileChosen}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap"
                >
                  <Upload className="h-4 w-4" />
                  Choose File to Upload
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleManualSave} className="space-y-4">
              <div>
                <label
                  htmlFor="manual-drive-url"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Google Drive URL
                </label>
                <div className="relative mt-1.5">
                  <Link2
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="manual-drive-url"
                    type="url"
                    value={manualUrl}
                    onChange={(e) => setManualUrl(e.target.value)}
                    placeholder="https://drive.google.com/drive/folders/..."
                    className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none focus:ring-1 focus:ring-[#1A365D]"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="manual-drive-label"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Display Label (optional)
                </label>
                <input
                  id="manual-drive-label"
                  type="text"
                  value={manualLabel}
                  onChange={(e) => setManualLabel(e.target.value)}
                  placeholder="e.g. Client KYC Folder"
                  className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none focus:ring-1 focus:ring-[#1A365D]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-[#1A365D] px-4 py-2 text-sm font-medium text-white hover:bg-[#132948]"
                >
                  Save Link
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
