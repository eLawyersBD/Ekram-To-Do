import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  Folder,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  buildAppsScriptCode,
  verifyBridgeSecret,
  type BridgeConfig,
  type BridgeDiagnosticReport,
  type BridgeDiagnosticStepStatus,
  type BridgeSecretVerificationResult,
  type BridgeStatusResponse,
  type BridgeSyncState,
} from '../services/driveBridge';
import {
  DEFAULT_TARGET_DRIVE_FOLDER_ID,
  DEFAULT_TARGET_DRIVE_FOLDER_URL,
} from '../services/googleSheets';

interface DriveBridgeSettingsSectionProps {
  bridgeStatus: BridgeStatusResponse | null;
  diagnosticReport: BridgeDiagnosticReport | null;
  checkingBridge: boolean;
  bridgeConfig: BridgeConfig;
  syncState: BridgeSyncState;
  lastSyncedAt: string | null;
  lastError: string | null;
  onUpdateBridgeConfig: (patch: Partial<BridgeConfig>) => void;
  onTestBridgeConnection: () => Promise<void>;
  onSyncMasterNow: () => Promise<void>;
  onRefreshBridgeLogs?: () => Promise<void>;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
}

function getDiagnosticStatusMeta(status: BridgeDiagnosticStepStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case 'pass':
      return { label: 'Passed', className: 'font-semibold text-emerald-700' };
    case 'fail':
      return { label: 'Failed', className: 'font-semibold text-red-700' };
    case 'warn':
      return { label: 'Warning', className: 'font-semibold text-amber-700' };
    default:
      return { label: 'Skipped', className: 'font-medium text-slate-400' };
  }
}

function formatSyncTime(iso: string | null): string {
  if (!iso) return 'Not synced yet';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Not synced yet';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export const DriveBridgeSettingsSection: React.FC<
  DriveBridgeSettingsSectionProps
> = ({
  bridgeStatus,
  diagnosticReport,
  checkingBridge,
  bridgeConfig,
  syncState,
  lastSyncedAt,
  lastError,
  onUpdateBridgeConfig,
  onTestBridgeConnection,
  onSyncMasterNow,
  onRefreshBridgeLogs,
  onNotify,
}) => {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedPropName, setCopiedPropName] = useState(false);
  const [showScriptCode, setShowScriptCode] = useState(false);
  const [secretGuideOverride, setSecretGuideOverride] = useState<boolean | null>(
    null
  );
  const [verifyingSecret, setVerifyingSecret] = useState(false);
  const [secretCheckResult, setSecretCheckResult] =
    useState<BridgeSecretVerificationResult | null>(null);

  const folderId = bridgeStatus?.folderId || DEFAULT_TARGET_DRIVE_FOLDER_ID;
  const folderUrl = bridgeStatus?.folderUrl || DEFAULT_TARGET_DRIVE_FOLDER_URL;
  const appsScriptCode = useMemo(
    () => buildAppsScriptCode(folderId),
    [folderId]
  );

  const handleVerifySecret = async () => {
    setVerifyingSecret(true);
    try {
      const result = await verifyBridgeSecret();
      setSecretCheckResult(result);
      if (result.status === 'success') {
        onNotify('BRIDGE_SECRET verified: Success — secret matches Apps Script.');
      } else if (result.status === 'mismatch') {
        onNotify(
          'BRIDGE_SECRET verification failed: Mismatch detected between server and Apps Script.',
          'error'
        );
      } else {
        onNotify(result.message, 'error');
      }
      if (onRefreshBridgeLogs) {
        await onRefreshBridgeLogs();
      }
    } finally {
      setVerifyingSecret(false);
    }
  };

  const combinedError = `${bridgeStatus?.error || ''} ${lastError || ''} ${
    diagnosticReport?.summary || ''
  }`;
  const hasSecretError =
    secretCheckResult?.status === 'mismatch' ||
    diagnosticReport?.code === 'missing_apps_script_secret' ||
    diagnosticReport?.code === 'secret_mismatch' ||
    /BRIDGE_SECRET|Unauthorized|invalid bridge secret/i.test(combinedError);
  const showSecretGuide =
    secretGuideOverride !== null ? secretGuideOverride : hasSecretError;

  const handleCopyScript = async () => {
    try {
      await navigator.clipboard.writeText(appsScriptCode);
      setCopiedCode(true);
      onNotify('Copied Google Apps Script bridge code to clipboard.');
      window.setTimeout(() => setCopiedCode(false), 2400);
    } catch {
      onNotify(
        'Could not access clipboard. Expand the script below and copy it manually.',
        'error'
      );
      setShowScriptCode(true);
    }
  };

  const handleCopyPropertyName = async () => {
    try {
      await navigator.clipboard.writeText('BRIDGE_SECRET');
      setCopiedPropName(true);
      onNotify('Copied "BRIDGE_SECRET" to clipboard.');
      window.setTimeout(() => setCopiedPropName(false), 2000);
    } catch {
      onNotify('Could not access clipboard. Type BRIDGE_SECRET manually.', 'error');
    }
  };

  const isConnected = Boolean(bridgeStatus?.connected);
  const isConfigured = Boolean(bridgeStatus?.configured);

  return (
    <section className="rounded-lg border border-slate-200 bg-white px-6 py-6 shadow-xs space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-[#1A365D]">
            Automatic Drive Folder Bridge
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Connect directly to your Google Drive folder through a server-proxied
            Google Apps Script Web App so all logged-in users sync and save
            Google Sheets without signing in with Google.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onTestBridgeConnection}
            disabled={checkingBridge}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
          >
            {checkingBridge ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {checkingBridge ? 'Checking Connection...' : 'Check Connection'}
          </button>

          {isConnected && (
            <button
              type="button"
              onClick={onSyncMasterNow}
              disabled={syncState === 'syncing'}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[#1A365D] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#132948] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
            >
              {syncState === 'syncing' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {syncState === 'syncing' ? 'Syncing Master...' : 'Sync Master Now'}
            </button>
          )}
        </div>
      </div>

      {/* Connection Status & Target Folder Summary */}
      <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-[#F7FAFE] px-4 py-3.5 text-xs md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {isConnected ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                Bridge Connected
              </span>
            ) : isConfigured ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                Bridge Unreachable
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                Waiting for Server Env Setup
              </span>
            )}
            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>
            <a
              href={folderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-[#1A365D] hover:underline"
            >
              <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {bridgeStatus?.folderName
                  ? bridgeStatus.folderName
                  : 'Target Drive Folder'}
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                ({folderId.slice(0, 10)}...)
              </span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            </a>
          </div>

          <p className="text-slate-600">
            {isConnected ? (
              <>
                Last Master sync:{' '}
                <span className="font-mono font-medium text-slate-800 tabular-nums">
                  {formatSyncTime(lastSyncedAt)}
                </span>
                {bridgeConfig.masterSheetUrl && (
                  <>
                    {' · '}
                    <a
                      href={bridgeConfig.masterSheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline"
                    >
                      Open Master Sheet
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </>
                )}
              </>
            ) : (
              bridgeStatus?.error ||
              bridgeStatus?.message ||
              'Deploy the Google Apps Script below and set GOOGLE_APPS_SCRIPT_URL and GOOGLE_APPS_SCRIPT_SECRET on the server.'
            )}
          </p>

          {lastError && (
            <p className="text-red-700 font-medium">Last sync error: {lastError}</p>
          )}
        </div>
      </div>

      {/* Prominent BRIDGE_SECRET Verification Strip */}
      <div
        role="status"
        aria-live="polite"
        className={`flex flex-col gap-3 rounded-md border px-4 py-3.5 text-xs md:flex-row md:items-center md:justify-between ${
          verifyingSecret
            ? 'border-[#1A365D]/25 bg-[#F4F8FC]'
            : secretCheckResult?.status === 'success'
              ? 'border-emerald-200 bg-emerald-50/45'
              : secretCheckResult?.status === 'mismatch'
                ? 'border-red-200 bg-red-50/45'
                : secretCheckResult
                  ? 'border-amber-200 bg-amber-50/45'
                  : 'border-slate-200 bg-white'
        }`}
      >
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5 shrink-0">
            {verifyingSecret ? (
              <Loader2
                className="h-4 w-4 animate-spin text-[#1A365D]"
                aria-hidden="true"
              />
            ) : secretCheckResult?.status === 'success' ? (
              <ShieldCheck
                className="h-4 w-4 text-emerald-700"
                aria-hidden="true"
              />
            ) : secretCheckResult?.status === 'mismatch' ? (
              <ShieldAlert
                className="h-4 w-4 text-red-700"
                aria-hidden="true"
              />
            ) : secretCheckResult ? (
              <AlertCircle
                className="h-4 w-4 text-amber-700"
                aria-hidden="true"
              />
            ) : (
              <ShieldCheck
                className="h-4 w-4 text-[#1A365D]"
                aria-hidden="true"
              />
            )}
          </div>

          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold text-slate-900">
                BRIDGE_SECRET Match Check
              </span>
              <span className="text-slate-300" aria-hidden="true">
                ·
              </span>
              {verifyingSecret ? (
                <span className="font-semibold text-[#1A365D]">
                  Verifying...
                </span>
              ) : secretCheckResult ? (
                <span
                  data-testid="bridge-secret-status"
                  className={`inline-flex items-center gap-1 font-bold tracking-tight ${
                    secretCheckResult.status === 'success'
                      ? 'text-emerald-700'
                      : secretCheckResult.status === 'mismatch'
                        ? 'text-red-700'
                        : 'text-amber-700'
                  }`}
                >
                  {secretCheckResult.status === 'success' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  )}
                  {secretCheckResult.label}
                </span>
              ) : (
                <span className="font-medium text-slate-500">
                  Not tested yet
                </span>
              )}

              {secretCheckResult && !verifyingSecret && (
                <>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                    {formatSyncTime(secretCheckResult.checkedAt)} ·{' '}
                    {secretCheckResult.durationMs}ms
                    {secretCheckResult.httpStatus !== null
                      ? ` · HTTP ${secretCheckResult.httpStatus}`
                      : ''}
                  </span>
                </>
              )}
            </div>

            <p
              className={`leading-relaxed ${
                secretCheckResult?.status === 'mismatch'
                  ? 'text-red-800'
                  : secretCheckResult?.status === 'success'
                    ? 'text-emerald-900'
                    : 'text-slate-600'
              }`}
            >
              {verifyingSecret
                ? 'Sending a test request to the Apps Script Web App to verify BRIDGE_SECRET...'
                : secretCheckResult
                  ? secretCheckResult.message
                  : 'Send a direct test request to your Apps Script endpoint to confirm BRIDGE_SECRET matches GOOGLE_APPS_SCRIPT_SECRET.'}
            </p>
          </div>
        </div>

        <div className="shrink-0 pl-7 md:pl-0">
          <button
            type="button"
            onClick={handleVerifySecret}
            disabled={verifyingSecret}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[#1A365D] px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#132948] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
          >
            {verifyingSecret ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {verifyingSecret ? 'Verifying Secret...' : 'Verify Secret'}
          </button>
        </div>
      </div>

      {/* Explicit BRIDGE_SECRET Diagnostic Report */}
      {diagnosticReport && (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-md border text-xs ${
            diagnosticReport.ok
              ? 'border-emerald-200 bg-emerald-50/40'
              : 'border-red-200 bg-red-50/40'
          }`}
        >
          <div className="flex flex-col gap-1.5 border-b border-slate-200/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              {diagnosticReport.ok ? (
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700"
                  aria-hidden="true"
                />
              ) : (
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-red-700"
                  aria-hidden="true"
                />
              )}
              <div>
                <p
                  className={`font-semibold ${
                    diagnosticReport.ok ? 'text-emerald-900' : 'text-red-900'
                  }`}
                >
                  {diagnosticReport.summary}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500 font-mono tabular-nums">
                  Checked {formatSyncTime(diagnosticReport.checkedAt)} ·{' '}
                  {diagnosticReport.durationMs}ms · Result:{' '}
                  {diagnosticReport.code}
                </p>
              </div>
            </div>
          </div>

          <div className="divide-y divide-slate-200/80 bg-white rounded-b-md">
            {diagnosticReport.steps.map((step, index) => {
              const statusMeta = getDiagnosticStatusMeta(step.status);
              return (
                <div
                  key={step.id}
                  className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
                >
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                        0{index + 1}.
                      </span>
                      <span className="font-semibold text-slate-900">
                        {step.label}
                      </span>
                    </div>
                    <p className="mt-0.5 pl-6 text-slate-600 leading-relaxed">
                      {step.detail}
                    </p>
                  </div>
                  <span
                    className={`pl-6 sm:pl-0 shrink-0 whitespace-nowrap ${statusMeta.className}`}
                  >
                    {statusMeta.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Admin Sync Preferences */}
      <div className="grid grid-cols-1 gap-4 border-b border-slate-200 pb-5 md:grid-cols-3">
        <div>
          <label
            htmlFor="bridge-master-title"
            className="block text-xs font-semibold text-slate-700"
          >
            Master Google Sheet Title
          </label>
          <input
            id="bridge-master-title"
            type="text"
            value={bridgeConfig.masterSheetTitle}
            onChange={(e) =>
              onUpdateBridgeConfig({ masterSheetTitle: e.target.value })
            }
            placeholder="Task Plan and Status — Master"
            className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-[#1A365D] focus:outline-none focus:ring-1 focus:ring-[#1A365D]"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Automatically created or updated inside your target Drive folder.
          </p>
        </div>

        <div>
          <label
            htmlFor="bridge-debounce"
            className="block text-xs font-semibold text-slate-700"
          >
            Auto-Sync Delay
          </label>
          <select
            id="bridge-debounce"
            value={bridgeConfig.debounceSeconds}
            onChange={(e) =>
              onUpdateBridgeConfig({
                debounceSeconds: Number.parseInt(e.target.value, 10) || 3,
              })
            }
            className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-[#1A365D] focus:outline-none"
          >
            <option value={2}>2 seconds after edits</option>
            <option value={3}>3 seconds after edits (Recommended)</option>
            <option value={5}>5 seconds after edits</option>
            <option value={10}>10 seconds after edits</option>
          </select>
          <p className="mt-1 text-[11px] text-slate-500">
            Batches rapid inline edits into a single Google Sheet update.
          </p>
        </div>

        <div>
          <span className="block text-xs font-semibold text-slate-700">
            Automatic Master Sheet Sync
          </span>
          <div className="mt-1.5 flex items-center gap-1 rounded-md bg-slate-100 p-1 w-fit">
            <button
              type="button"
              onClick={() => onUpdateBridgeConfig({ autoSyncEnabled: true })}
              className={`cursor-pointer rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                bridgeConfig.autoSyncEnabled
                  ? 'bg-white text-[#1A365D] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Enabled
            </button>
            <button
              type="button"
              onClick={() => onUpdateBridgeConfig({ autoSyncEnabled: false })}
              className={`cursor-pointer rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                !bridgeConfig.autoSyncEnabled
                  ? 'bg-white text-[#1A365D] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Paused
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Manual table snapshots remain available for all logged-in users.
          </p>
        </div>
      </div>

      {/* 3-Step One-Time Google Apps Script Deployment Guide */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">
            One-Time Setup Guide (No Google Sign-In Required After Setup)
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowScriptCode((prev) => !prev)}
              className="cursor-pointer text-xs font-medium text-[#1A365D] hover:underline whitespace-nowrap"
            >
              {showScriptCode ? 'Hide Script Code' : 'View Script Code'}
            </button>
            <button
              type="button"
              onClick={handleCopyScript}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#1A365D]/30 bg-[#E6F0FA]/70 px-3 py-1.5 text-xs font-medium text-[#1A365D] transition-colors hover:bg-[#E6F0FA] whitespace-nowrap"
            >
              {copiedCode ? (
                <>
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Copied Code
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Copy Apps Script Code
                </>
              )}
            </button>
          </div>
        </div>

        <ol className="list-decimal space-y-1.5 pl-5 text-xs text-slate-700 leading-relaxed">
          <li>
            Open{' '}
            <a
              href="https://script.new"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-[#1A365D] hover:underline"
            >
              script.new
            </a>{' '}
            while signed into the Google account that owns folder{' '}
            <span className="font-mono text-[11px] text-slate-900">
              {folderId}
            </span>
            , replace the editor contents with the copied Apps Script code, and
            save.
          </li>
          <li>
            In Apps Script, open{' '}
            <strong className="font-semibold text-slate-900">
              Project Settings → Script Properties
            </strong>{' '}
            and add property{' '}
            <span className="font-mono text-[11px] font-semibold text-slate-900">
              BRIDGE_SECRET
            </span>{' '}
            with any strong passphrase you choose.
          </li>
          <li>
            Click{' '}
            <strong className="font-semibold text-slate-900">
              Deploy → New deployment → Web app
            </strong>
            , choose{' '}
            <strong className="font-semibold text-slate-900">
              Execute as: Me
            </strong>{' '}
            and{' '}
            <strong className="font-semibold text-slate-900">
              Who has access: Anyone
            </strong>
            , authorize once, and add{' '}
            <span className="font-mono text-[11px] font-semibold text-slate-900">
              GOOGLE_APPS_SCRIPT_URL
            </span>{' '}
            (the Web App <span className="font-mono text-[11px]">/exec</span>{' '}
            URL) and{' '}
            <span className="font-mono text-[11px] font-semibold text-slate-900">
              GOOGLE_APPS_SCRIPT_SECRET
            </span>{' '}
            to your server environment secrets, then click{' '}
            <strong className="font-semibold text-slate-900">
              Check Connection
            </strong>
            .
          </li>
        </ol>

        {showScriptCode && (
          <pre className="ledger-scroll max-h-80 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-4 font-mono text-[11.5px] leading-relaxed text-slate-100">
            <code>{appsScriptCode}</code>
          </pre>
        )}
      </div>

      {/* BRIDGE_SECRET Setup & Troubleshooting Guide */}
      <div className="border-t border-slate-200 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setSecretGuideOverride(!showSecretGuide)}
            aria-expanded={showSecretGuide}
            className="inline-flex cursor-pointer items-center gap-2 text-left text-sm font-semibold text-[#1A365D] hover:underline"
          >
            <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              BRIDGE_SECRET Setup &amp; Unauthorized Error Troubleshooting Guide
            </span>
            {showSecretGuide ? (
              <ChevronUp className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={handleCopyPropertyName}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
          >
            {copiedPropName ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                Copied BRIDGE_SECRET
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                Copy Property Name
              </>
            )}
          </button>
        </div>

        {showSecretGuide && (
          <div className="mt-4 space-y-5 text-xs text-slate-700">
            <p className="leading-relaxed text-slate-600">
              Your app authenticates every Drive folder sync by sending{' '}
              <span className="font-mono font-semibold text-slate-900">
                GOOGLE_APPS_SCRIPT_SECRET
              </span>{' '}
              from the server and verifying it against{' '}
              <span className="font-mono font-semibold text-slate-900">
                BRIDGE_SECRET
              </span>{' '}
              stored in Google Apps Script. Both sides must hold the exact same
              passphrase (no quotes, no leading or trailing spaces).
            </p>

            {/* Side-by-side Property Mapping Table */}
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-[#E6F0FA] font-semibold text-slate-900">
                    <th className="px-4 py-2.5">Where to Configure</th>
                    <th className="px-4 py-2.5">Property / Variable Name</th>
                    <th className="px-4 py-2.5">Value to Enter</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  <tr>
                    <td className="px-4 py-2.5 font-medium text-slate-900 whitespace-nowrap">
                      Google Apps Script
                      <span className="block font-normal text-[11px] text-slate-500">
                        Project Settings → Script Properties
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-[#1A365D] whitespace-nowrap">
                      BRIDGE_SECRET
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      Your chosen passphrase (e.g.,{' '}
                      <span className="font-mono text-slate-900">
                        elawyers_bridge_2026_secret
                      </span>
                      ) — click{' '}
                      <strong className="font-semibold text-slate-900">
                        Save script properties
                      </strong>
                      .
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-medium text-slate-900 whitespace-nowrap">
                      Server Environment Secrets
                      <span className="block font-normal text-[11px] text-slate-500">
                        AI Studio Secrets Panel / .env
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-[#1A365D] whitespace-nowrap">
                      GOOGLE_APPS_SCRIPT_SECRET
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      The <strong className="font-semibold text-slate-900">exact same</strong>{' '}
                      passphrase saved in <span className="font-mono">BRIDGE_SECRET</span>.
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-medium text-slate-900 whitespace-nowrap">
                      Server Environment Secrets
                      <span className="block font-normal text-[11px] text-slate-500">
                        AI Studio Secrets Panel / .env
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-[#1A365D] whitespace-nowrap">
                      GOOGLE_APPS_SCRIPT_URL
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      The deployed Web App <span className="font-mono">/exec</span>{' '}
                      URL from that <strong className="font-semibold text-slate-900">exact same</strong>{' '}
                      Apps Script project.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Step-by-Step Instructions */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-900">
                How to Set BRIDGE_SECRET in Google Apps Script
              </h4>
              <ol className="list-decimal space-y-1.5 pl-5 leading-relaxed text-slate-700">
                <li>
                  Open your project at{' '}
                  <a
                    href="https://script.google.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[#1A365D] hover:underline"
                  >
                    script.google.com
                  </a>{' '}
                  and confirm via{' '}
                  <strong className="font-semibold text-slate-900">
                    Deploy → Manage deployments
                  </strong>{' '}
                  that its Web App <span className="font-mono">/exec</span> URL
                  matches your{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    GOOGLE_APPS_SCRIPT_URL
                  </span>
                  .
                </li>
                <li>
                  Click{' '}
                  <strong className="font-semibold text-slate-900">
                    Project Settings
                  </strong>{' '}
                  (gear icon in the left sidebar) and scroll to{' '}
                  <strong className="font-semibold text-slate-900">
                    Script Properties
                  </strong>
                  .
                </li>
                <li>
                  Click{' '}
                  <strong className="font-semibold text-slate-900">
                    Add script property
                  </strong>
                  . Enter{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    BRIDGE_SECRET
                  </span>{' '}
                  in the <strong className="font-semibold text-slate-900">Property</strong>{' '}
                  (left) box and your secret passphrase in the{' '}
                  <strong className="font-semibold text-slate-900">Value</strong>{' '}
                  (right) box.
                </li>
                <li>
                  Click{' '}
                  <strong className="font-semibold text-slate-900">
                    Save script properties
                  </strong>
                  . Script Properties apply immediately — no redeployment is
                  required.
                </li>
                <li>
                  Return here and click{' '}
                  <strong className="font-semibold text-slate-900">
                    Check Connection
                  </strong>{' '}
                  at the top right of this section.
                </li>
              </ol>
            </div>

            {/* Error-Specific Troubleshooting */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-900">
                Resolving Common Bridge Errors
              </h4>
              <dl className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-[#F9FBFD]">
                <div className="px-4 py-2.5">
                  <dt className="font-mono text-[11.5px] font-semibold text-red-700">
                    BRIDGE_SECRET is not set in Apps Script Project Settings -&gt; Script Properties.
                  </dt>
                  <dd className="mt-1 text-slate-600 leading-relaxed">
                    The left <strong className="font-semibold text-slate-800">Property</strong>{' '}
                    box is missing, misspelled (must be exact uppercase{' '}
                    <span className="font-mono">BRIDGE_SECRET</span>, not{' '}
                    <span className="font-mono">GOOGLE_APPS_SCRIPT_SECRET</span>),
                    was not saved with{' '}
                    <strong className="font-semibold text-slate-800">
                      Save script properties
                    </strong>
                    , or was added to a different Apps Script project than your{' '}
                    <span className="font-mono">GOOGLE_APPS_SCRIPT_URL</span>.
                  </dd>
                </div>
                <div className="px-4 py-2.5">
                  <dt className="font-mono text-[11.5px] font-semibold text-red-700">
                    Unauthorized: invalid bridge secret.
                  </dt>
                  <dd className="mt-1 text-slate-600 leading-relaxed">
                    <span className="font-mono">BRIDGE_SECRET</span> exists in Apps
                    Script, but its value does not match{' '}
                    <span className="font-mono">GOOGLE_APPS_SCRIPT_SECRET</span> on
                    the server. Re-paste the identical passphrase (letters,
                    numbers, and underscores only — no spaces or quotes) in both
                    places and re-run{' '}
                    <strong className="font-semibold text-slate-800">
                      Check Connection
                    </strong>
                    .
                  </dd>
                </div>
                <div className="px-4 py-2.5">
                  <dt className="font-mono text-[11.5px] font-semibold text-red-700">
                    Google Apps Script returned an HTML page instead of JSON.
                  </dt>
                  <dd className="mt-1 text-slate-600 leading-relaxed">
                    Open{' '}
                    <strong className="font-semibold text-slate-800">
                      Deploy → Manage deployments → Edit
                    </strong>{' '}
                    in Apps Script and verify{' '}
                    <strong className="font-semibold text-slate-800">
                      Execute as: Me
                    </strong>{' '}
                    and{' '}
                    <strong className="font-semibold text-slate-800">
                      Who has access: Anyone
                    </strong>
                    , and confirm your URL ends in{' '}
                    <span className="font-mono">/exec</span> (not{' '}
                    <span className="font-mono">/dev</span>).
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
