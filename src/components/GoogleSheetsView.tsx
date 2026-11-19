import React, { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,
  FilePlus2,
  FileSpreadsheet,
  Link2,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  isRowPopulated,
  type ConfirmDialogRequest,
  type DriveFileItem,
  type TaskRow,
} from '../types/task';
import { DriveAuthError } from '../services/googleDrive';
import {
  appendTasksToSheet,
  createTaskSpreadsheet,
  extractSpreadsheetIdFromInput,
  getSpreadsheetMetadata,
  listGoogleSpreadsheets,
  overwriteSheetWithTasks,
  parseSheetValuesToTasks,
  readSheetValues,
  type SpreadsheetMetadata,
} from '../services/googleSheets';
import { GoogleSignInButton } from './GoogleSignInButton';

interface GoogleSheetsViewProps {
  tasks: TaskRow[];
  isSignedIn: boolean;
  isSigningIn: boolean;
  linkedSheetId: string | null;
  linkedSheetTab: string | null;
  onLinkSheet: (spreadsheetId: string, title: string, tabTitle: string) => void;
  onImportTasks: (imported: TaskRow[], mode: 'replace' | 'append') => void;
  onSignIn: () => void;
  onSessionExpired: () => void;
  onRequestConfirm: (req: ConfirmDialogRequest) => void;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
}

export const GoogleSheetsView: React.FC<GoogleSheetsViewProps> = ({
  tasks,
  isSignedIn,
  isSigningIn,
  linkedSheetId,
  linkedSheetTab,
  onLinkSheet,
  onImportTasks,
  onSignIn,
  onSessionExpired,
  onRequestConfirm,
  onNotify,
}) => {
  const [spreadsheets, setSpreadsheets] = useState<DriveFileItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Selected spreadsheet & tab metadata
  const [selectedMeta, setSelectedMeta] = useState<SpreadsheetMetadata | null>(null);
  const [selectedTabTitle, setSelectedTabTitle] = useState<string>('');
  const [previewValues, setPreviewValues] = useState<string[][]>([]);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  // Create new sheet & direct URL open inputs
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSheetTitle, setNewSheetTitle] = useState(
    `Task Plan and Status - ${new Date().toISOString().slice(0, 10)}`
  );
  const [directUrlInput, setDirectUrlInput] = useState('');

  const loadSpreadsheetList = async (query = searchQuery) => {
    if (!isSignedIn) return;
    setLoadingList(true);
    setListError(null);
    try {
      const files = await listGoogleSpreadsheets(query);
      setSpreadsheets(files);
    } catch (err) {
      if (err instanceof DriveAuthError) {
        onSessionExpired();
      } else {
        setListError(
          err instanceof Error ? err.message : 'Unable to list Google Sheets.'
        );
      }
    } finally {
      setLoadingList(false);
    }
  };

  const inspectSpreadsheet = async (spreadsheetId: string, preferredTab?: string) => {
    if (!isSignedIn || !spreadsheetId) return;
    setLoadingSheet(true);
    setSheetError(null);
    try {
      const meta = await getSpreadsheetMetadata(spreadsheetId);
      setSelectedMeta(meta);
      const chosenTab =
        (preferredTab &&
          meta.sheets.find((s) => s.title === preferredTab)?.title) ||
        meta.sheets[0]?.title ||
        '';
      setSelectedTabTitle(chosenTab);

      if (chosenTab) {
        onLinkSheet(meta.spreadsheetId, meta.title, chosenTab);
        const values = await readSheetValues(meta.spreadsheetId, chosenTab);
        setPreviewValues(values);
      } else {
        setPreviewValues([]);
      }
    } catch (err) {
      if (err instanceof DriveAuthError) {
        onSessionExpired();
      } else {
        setSheetError(
          err instanceof Error ? err.message : 'Unable to load spreadsheet data.'
        );
      }
    } finally {
      setLoadingSheet(false);
    }
  };

  const loadTabPreview = async (meta: SpreadsheetMetadata, tabTitle: string) => {
    if (!isSignedIn || !tabTitle) return;
    setSelectedTabTitle(tabTitle);
    onLinkSheet(meta.spreadsheetId, meta.title, tabTitle);
    setLoadingSheet(true);
    setSheetError(null);
    try {
      const values = await readSheetValues(meta.spreadsheetId, tabTitle);
      setPreviewValues(values);
    } catch (err) {
      if (err instanceof DriveAuthError) {
        onSessionExpired();
      } else {
        setSheetError(
          err instanceof Error ? err.message : 'Unable to read sheet tab values.'
        );
      }
    } finally {
      setLoadingSheet(false);
    }
  };

  useEffect(() => {
    if (!isSignedIn) return;
    const timer = window.setTimeout(() => {
      loadSpreadsheetList(searchQuery);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [isSignedIn, searchQuery]);

  // Auto-open previously linked spreadsheet when signed in
  useEffect(() => {
    if (isSignedIn && linkedSheetId && !selectedMeta) {
      inspectSpreadsheet(linkedSheetId, linkedSheetTab || undefined);
    }
  }, [isSignedIn, linkedSheetId]);

  if (!isSignedIn) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-8 py-16 text-center">
        <FileSpreadsheet
          className="mx-auto h-10 w-10 text-[#1A365D]/75"
          aria-hidden="true"
        />
        <h2 className="mt-4 text-xl font-semibold text-[#1A365D]">
          Connect Google Sheets
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-600">
          Sign in with Google to create formatted Task Plan spreadsheets, push updates
          directly to any Google Sheet tab, or import existing rows into your Task
          Ledger.
        </p>
        <div className="mt-6 flex justify-center">
          <GoogleSignInButton onClick={onSignIn} disabled={isSigningIn} />
        </div>
      </div>
    );
  }

  const populatedTasks = tasks.filter(isRowPopulated);
  const selectedTabObj =
    selectedMeta?.sheets.find((s) => s.title === selectedTabTitle) ??
    selectedMeta?.sheets[0] ??
    null;

  const handleCreateSpreadsheetSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const title = newSheetTitle.trim();
    if (!title) return;

    onRequestConfirm({
      title: 'Create new Google Sheet?',
      description: `Create a new Google Sheet named "${title}" in your Google Drive and populate it with ${populatedTasks.length} populated task ${
        populatedTasks.length === 1 ? 'row' : 'rows'
      } (${tasks.length} total rows)?`,
      confirmLabel: 'Create Google Sheet',
      tone: 'primary',
      onConfirm: async () => {
        try {
          const rowsToWrite = populatedTasks.length > 0 ? populatedTasks : tasks;
          const created = await createTaskSpreadsheet(title, rowsToWrite);
          setSelectedMeta(created);
          const tab = created.sheets[0]?.title || '';
          setSelectedTabTitle(tab);
          if (tab) {
            onLinkSheet(created.spreadsheetId, created.title, tab);
            const values = await readSheetValues(created.spreadsheetId, tab);
            setPreviewValues(values);
          }
          setShowCreateForm(false);
          onNotify(`Created Google Sheet "${created.title}".`);
          await loadSpreadsheetList(searchQuery);
        } catch (err) {
          if (err instanceof DriveAuthError) {
            onSessionExpired();
          } else {
            onNotify(
              err instanceof Error ? err.message : 'Failed to create Google Sheet.',
              'error'
            );
          }
        }
      },
    });
  };

  const handleOpenByUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const id = extractSpreadsheetIdFromInput(directUrlInput);
    if (!id) return;
    inspectSpreadsheet(id);
    setDirectUrlInput('');
  };

  const handlePushOverwrite = () => {
    if (!selectedMeta || !selectedTabObj) return;
    const rowsToWrite = populatedTasks.length > 0 ? populatedTasks : tasks;

    onRequestConfirm({
      title: `Overwrite "${selectedTabObj.title}" in Google Sheets?`,
      description: `This will clear existing cells in tab "${selectedTabObj.title}" of "${selectedMeta.title}" and write ${rowsToWrite.length} task ${
        rowsToWrite.length === 1 ? 'row' : 'rows'
      } with formatted headers.`,
      details: [
        `Spreadsheet: ${selectedMeta.title}`,
        `Tab: ${selectedTabObj.title}`,
        `Rows to write: ${rowsToWrite.length}`,
      ],
      confirmLabel: 'Overwrite Sheet Tab',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await overwriteSheetWithTasks({
            spreadsheetId: selectedMeta.spreadsheetId,
            sheetTitle: selectedTabObj.title,
            sheetId: selectedTabObj.sheetId,
            tasks: rowsToWrite,
          });
          const refreshed = await readSheetValues(
            selectedMeta.spreadsheetId,
            selectedTabObj.title
          );
          setPreviewValues(refreshed);
          onNotify(
            `Synced ${rowsToWrite.length} rows to "${selectedMeta.title}" (${selectedTabObj.title}).`
          );
        } catch (err) {
          if (err instanceof DriveAuthError) {
            onSessionExpired();
          } else {
            onNotify(
              err instanceof Error ? err.message : 'Failed to update Google Sheet.',
              'error'
            );
          }
        }
      },
    });
  };

  const handleAppendRows = () => {
    if (!selectedMeta || !selectedTabObj) return;
    if (populatedTasks.length === 0) {
      onNotify('There are no populated tasks to append.', 'error');
      return;
    }

    onRequestConfirm({
      title: `Append ${populatedTasks.length} rows to "${selectedTabObj.title}"?`,
      description: `Append ${populatedTasks.length} populated task ${
        populatedTasks.length === 1 ? 'row' : 'rows'
      } to the bottom of "${selectedTabObj.title}" in "${selectedMeta.title}" without overwriting existing rows.`,
      confirmLabel: 'Append Rows',
      tone: 'primary',
      onConfirm: async () => {
        try {
          await appendTasksToSheet({
            spreadsheetId: selectedMeta.spreadsheetId,
            sheetTitle: selectedTabObj.title,
            tasks: populatedTasks,
          });
          const refreshed = await readSheetValues(
            selectedMeta.spreadsheetId,
            selectedTabObj.title
          );
          setPreviewValues(refreshed);
          onNotify(`Appended ${populatedTasks.length} rows to "${selectedTabObj.title}".`);
        } catch (err) {
          if (err instanceof DriveAuthError) {
            onSessionExpired();
          } else {
            onNotify(
              err instanceof Error ? err.message : 'Failed to append rows to Sheet.',
              'error'
            );
          }
        }
      },
    });
  };

  const handleImportFromSheet = (mode: 'replace' | 'append') => {
    if (!selectedMeta || !selectedTabObj) return;
    const parsed = parseSheetValuesToTasks(previewValues);
    if (parsed.length === 0) {
      onNotify('No importable task rows were found in this sheet tab.', 'error');
      return;
    }

    onRequestConfirm({
      title:
        mode === 'replace'
          ? 'Replace Task Ledger with Google Sheet rows?'
          : 'Append Google Sheet rows to Task Ledger?',
      description:
        mode === 'replace'
          ? `Import ${parsed.length} rows from "${selectedMeta.title}" (${selectedTabObj.title}) and replace your current local Task Ledger rows?`
          : `Append ${parsed.length} rows from "${selectedMeta.title}" (${selectedTabObj.title}) to your current Task Ledger?`,
      confirmLabel: mode === 'replace' ? 'Import & Replace' : 'Import & Append',
      tone: mode === 'replace' ? 'danger' : 'primary',
      onConfirm: () => {
        onImportTasks(parsed, mode);
        onNotify(
          `Imported ${parsed.length} rows from "${selectedMeta.title}" (${selectedTabObj.title}).`
        );
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Action Header */}
      <section className="rounded-lg border border-slate-200 bg-white px-6 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-base font-semibold text-[#1A365D]">
              Google Sheets Sync & Import
            </h1>
            <p className="mt-0.5 text-xs text-slate-600">
              Create a formatted Google Sheet from your Task Plan, push live ledger updates
              into any spreadsheet tab, or import existing spreadsheet rows.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowCreateForm((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#1A365D] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#132948] whitespace-nowrap"
            >
              <FilePlus2 className="h-3.5 w-3.5" />
              New Task Plan Sheet
            </button>
            <form onSubmit={handleOpenByUrl} className="flex items-center gap-1.5">
              <div className="relative">
                <Link2
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={directUrlInput}
                  onChange={(e) => setDirectUrlInput(e.target.value)}
                  placeholder="Paste Sheet URL or ID..."
                  className="w-52 rounded-md border border-slate-300 py-1.5 pl-8 pr-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#1A365D] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={!directUrlInput.trim()}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
              >
                Open
              </button>
            </form>
          </div>
        </div>

        {showCreateForm && (
          <form
            onSubmit={handleCreateSpreadsheetSubmit}
            className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-4 sm:flex-row"
          >
            <input
              type="text"
              value={newSheetTitle}
              onChange={(e) => setNewSheetTitle(e.target.value)}
              placeholder="Spreadsheet title..."
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1A365D] focus:outline-none"
              autoFocus
              required
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-md bg-[#1A365D] px-4 py-2 text-xs font-medium text-white hover:bg-[#132948] whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                Create & Sync
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Main 2-Column Workspace: Spreadsheet Directory + Live Sheet Inspector */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left: Available Spreadsheets */}
        <section className="rounded-lg border border-slate-200 bg-white lg:col-span-4">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3.5">
            <h2 className="text-sm font-semibold text-[#1A365D]">
              Your Google Sheets
            </h2>
            <button
              type="button"
              onClick={() => loadSpreadsheetList(searchQuery)}
              disabled={loadingList}
              aria-label="Refresh spreadsheets"
              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingList ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="border-b border-slate-200 px-4 py-2.5">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search spreadsheets..."
                className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#1A365D] focus:outline-none"
              />
            </div>
          </div>

          {listError && (
            <div className="border-b border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
              {listError}
            </div>
          )}

          <div className="max-h-[540px] divide-y divide-slate-200 overflow-y-auto">
            {loadingList ? (
              Array.from({ length: 5 }).map((_, idx) => (
                <div key={idx} className="px-4 py-3 animate-pulse space-y-1.5">
                  <div className="h-3.5 w-44 rounded bg-slate-200" />
                  <div className="h-3 w-24 rounded bg-slate-100" />
                </div>
              ))
            ) : spreadsheets.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-slate-500">
                No spreadsheets found. Create a new Task Plan Sheet above.
              </div>
            ) : (
              spreadsheets.map((sheet) => {
                const isActive = selectedMeta?.spreadsheetId === sheet.id;
                return (
                  <button
                    key={sheet.id}
                    type="button"
                    onClick={() => inspectSpreadsheet(sheet.id)}
                    className={`flex w-full items-start justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-[#F5F9FD] ${
                      isActive ? 'bg-[#E6F0FA]/70' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-900">
                        {sheet.name}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                        {sheet.modifiedTime
                          ? `Modified ${new Date(sheet.modifiedTime).toLocaleDateString()}`
                          : 'Google Sheet'}
                      </p>
                    </div>
                    <FileSpreadsheet
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        isActive ? 'text-[#1A365D]' : 'text-emerald-700/75'
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Right: Selected Sheet Tab Controls & Live Data Preview */}
        <section className="rounded-lg border border-slate-200 bg-white lg:col-span-8">
          {!selectedMeta ? (
            <div className="px-8 py-20 text-center">
              <FileSpreadsheet
                className="mx-auto h-9 w-9 text-slate-300"
                aria-hidden="true"
              />
              <h3 className="mt-3 text-sm font-semibold text-slate-800">
                Select a Google Sheet to inspect or sync
              </h3>
              <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
                Choose any spreadsheet on the left, paste a Google Sheets URL above, or
                create a new formatted Task Plan spreadsheet.
              </p>
            </div>
          ) : (
            <div>
              {/* Sheet Header & Tab Selector */}
              <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-base font-semibold text-[#1A365D]">
                      {selectedMeta.title}
                    </h2>
                    <a
                      href={selectedMeta.spreadsheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-slate-600 hover:text-[#1A365D] whitespace-nowrap"
                    >
                      Open in Sheets
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                    {selectedMeta.sheets.length}{' '}
                    {selectedMeta.sheets.length === 1 ? 'tab' : 'tabs'} ·{' '}
                    {previewValues.length} populated{' '}
                    {previewValues.length === 1 ? 'row' : 'rows'} loaded
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <label
                    htmlFor="sheet-tab-select"
                    className="text-xs font-medium text-slate-600 whitespace-nowrap"
                  >
                    Tab:
                  </label>
                  <select
                    id="sheet-tab-select"
                    value={selectedTabTitle}
                    onChange={(e) => loadTabPreview(selectedMeta, e.target.value)}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:border-[#1A365D] focus:outline-none"
                  >
                    {selectedMeta.sheets.map((tab) => (
                      <option key={tab.sheetId} value={tab.title}>
                        {tab.title}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => loadTabPreview(selectedMeta, selectedTabTitle)}
                    disabled={loadingSheet}
                    aria-label="Reload tab data"
                    className="rounded-md border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${loadingSheet ? 'animate-spin' : ''}`}
                    />
                  </button>
                </div>
              </div>

              {/* Two-Way Sync Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-200 bg-slate-50/70 px-6 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePushOverwrite}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#1A365D] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#132948] whitespace-nowrap"
                  >
                    <ArrowUpFromLine className="h-3.5 w-3.5" />
                    Push Ledger to Tab
                  </button>
                  <button
                    type="button"
                    onClick={handleAppendRows}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Append Populated Rows
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleImportFromSheet('append')}
                    disabled={previewValues.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                  >
                    <ArrowDownToLine className="h-3.5 w-3.5" />
                    Import (Append)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleImportFromSheet('replace')}
                    disabled={previewValues.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-[#1A365D] transition-colors hover:bg-[#E6F0FA]/60 disabled:opacity-50 whitespace-nowrap"
                  >
                    <ArrowDownToLine className="h-3.5 w-3.5" />
                    Import (Replace)
                  </button>
                </div>
              </div>

              {sheetError && (
                <div className="border-b border-red-200 bg-red-50 px-6 py-3 text-xs text-red-800">
                  {sheetError}
                </div>
              )}

              {/* Live Preview Table */}
              <div className="ledger-scroll max-h-[460px] overflow-auto">
                {loadingSheet ? (
                  <div className="space-y-2.5 p-6 animate-pulse">
                    {Array.from({ length: 6 }).map((_, idx) => (
                      <div key={idx} className="h-7 w-full rounded bg-slate-100" />
                    ))}
                  </div>
                ) : previewValues.length === 0 ? (
                  <div className="px-6 py-12 text-center text-xs text-slate-500">
                    This tab is currently empty. Click <strong>Push Ledger to Tab</strong>{' '}
                    to export your Task Plan here.
                  </div>
                ) : (
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="sticky top-0 bg-[#E6F0FA] text-left font-semibold text-slate-900">
                        {previewValues[0].map((header, colIdx) => (
                          <th
                            key={colIdx}
                            className="border-b border-r border-[#8FA6C1]/70 px-3 py-2 whitespace-nowrap"
                          >
                            {header || `Col ${colIdx + 1}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {previewValues.slice(1).map((row, rowIdx) => (
                        <tr key={rowIdx} className="hover:bg-[#F5F9FD]">
                          {previewValues[0].map((_, colIdx) => (
                            <td
                              key={colIdx}
                              className="max-w-[240px] truncate border-r border-slate-200 px-3 py-2 text-slate-800 whitespace-nowrap"
                            >
                              {row[colIdx] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
