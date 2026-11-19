import type { TaskRow } from '../types/task';
import {
  DEFAULT_TARGET_DRIVE_FOLDER_ID,
  DEFAULT_TARGET_DRIVE_FOLDER_URL,
} from './googleSheets';

export interface BridgeStatusResponse {
  configured: boolean;
  connected: boolean;
  folderId: string;
  folderUrl: string;
  folderName?: string;
  message?: string;
  error?: string;
  checkedAt?: string;
}

export interface BridgeSyncResult {
  ok: true;
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  syncedAt: string;
  rowCount: number;
}

export interface BridgeConfig {
  autoSyncEnabled: boolean;
  masterSheetTitle: string;
  masterSheetId: string | null;
  masterSheetUrl: string | null;
  lastSyncedAt: string | null;
  debounceSeconds: number;
}

export type BridgeSyncState = 'idle' | 'syncing' | 'synced' | 'error';

export const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  autoSyncEnabled: true,
  masterSheetTitle: 'Task Plan and Status — Master',
  masterSheetId: null,
  masterSheetUrl: null,
  lastSyncedAt: null,
  debounceSeconds: 3,
};

const STORAGE_KEY_BRIDGE_CONFIG = 'el_task_plan_bridge_config_v1';

export function loadBridgeConfig(): BridgeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BRIDGE_CONFIG);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BridgeConfig>;
      return {
        autoSyncEnabled:
          typeof parsed.autoSyncEnabled === 'boolean'
            ? parsed.autoSyncEnabled
            : DEFAULT_BRIDGE_CONFIG.autoSyncEnabled,
        masterSheetTitle:
          typeof parsed.masterSheetTitle === 'string' &&
          parsed.masterSheetTitle.trim()
            ? parsed.masterSheetTitle
            : DEFAULT_BRIDGE_CONFIG.masterSheetTitle,
        masterSheetId:
          typeof parsed.masterSheetId === 'string' && parsed.masterSheetId
            ? parsed.masterSheetId
            : null,
        masterSheetUrl:
          typeof parsed.masterSheetUrl === 'string' && parsed.masterSheetUrl
            ? parsed.masterSheetUrl
            : null,
        lastSyncedAt:
          typeof parsed.lastSyncedAt === 'string' && parsed.lastSyncedAt
            ? parsed.lastSyncedAt
            : null,
        debounceSeconds:
          typeof parsed.debounceSeconds === 'number' &&
          parsed.debounceSeconds >= 1 &&
          parsed.debounceSeconds <= 30
            ? parsed.debounceSeconds
            : DEFAULT_BRIDGE_CONFIG.debounceSeconds,
      };
    }
  } catch {
    // fall back to defaults
  }
  return { ...DEFAULT_BRIDGE_CONFIG };
}

export function saveBridgeConfig(config: BridgeConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY_BRIDGE_CONFIG, JSON.stringify(config));
  } catch {
    // ignore storage errors
  }
}

export async function fetchBridgeStatus(
  ping = true
): Promise<BridgeStatusResponse> {
  try {
    const res = await fetch(
      `/api/drive-bridge/status?ping=${ping ? '1' : '0'}`,
      { method: 'GET' }
    );
    if (!res.ok) {
      return {
        configured: false,
        connected: false,
        folderId: DEFAULT_TARGET_DRIVE_FOLDER_ID,
        folderUrl: DEFAULT_TARGET_DRIVE_FOLDER_URL,
        error: `Bridge status check returned HTTP ${res.status}.`,
      };
    }
    return (await res.json()) as BridgeStatusResponse;
  } catch {
    return {
      configured: false,
      connected: false,
      folderId: DEFAULT_TARGET_DRIVE_FOLDER_ID,
      folderUrl: DEFAULT_TARGET_DRIVE_FOLDER_URL,
      message:
        'Server bridge endpoint is not running. Start the full-stack server and configure server environment variables.',
    };
  }
}

export type BridgeDiagnosticCode =
  | 'ok'
  | 'missing_server_env'
  | 'invalid_script_url'
  | 'html_response'
  | 'missing_apps_script_secret'
  | 'secret_mismatch'
  | 'folder_access_error'
  | 'network_error'
  | 'script_error';

export type BridgeDiagnosticStepStatus = 'pass' | 'fail' | 'warn' | 'skipped';

export interface BridgeDiagnosticStep {
  id: 'server_env' | 'endpoint_reachability' | 'bridge_secret' | 'drive_folder';
  label: string;
  status: BridgeDiagnosticStepStatus;
  detail: string;
}

export interface BridgeDiagnosticReport {
  ok: boolean;
  code: BridgeDiagnosticCode;
  summary: string;
  checkedAt: string;
  durationMs: number;
  folderId: string;
  folderUrl: string;
  folderName?: string;
  steps: BridgeDiagnosticStep[];
}

export async function runBridgeDiagnostics(): Promise<BridgeDiagnosticReport> {
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetch('/api/drive-bridge/diagnose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      return {
        ok: false,
        code: 'network_error',
        summary: `Diagnostic endpoint returned HTTP ${res.status}.`,
        checkedAt,
        durationMs: 0,
        folderId: DEFAULT_TARGET_DRIVE_FOLDER_ID,
        folderUrl: DEFAULT_TARGET_DRIVE_FOLDER_URL,
        steps: [
          {
            id: 'server_env',
            label: 'Server Environment Secrets',
            status: 'fail',
            detail: `Backend diagnostic route returned HTTP ${res.status}. Restart the server and try again.`,
          },
        ],
      };
    }
    return (await res.json()) as BridgeDiagnosticReport;
  } catch {
    return {
      ok: false,
      code: 'network_error',
      summary:
        'Could not reach the backend diagnostic endpoint (/api/drive-bridge/diagnose).',
      checkedAt,
      durationMs: 0,
      folderId: DEFAULT_TARGET_DRIVE_FOLDER_ID,
      folderUrl: DEFAULT_TARGET_DRIVE_FOLDER_URL,
      steps: [
        {
          id: 'server_env',
          label: 'Server Environment Secrets',
          status: 'fail',
          detail:
            'Backend Express server is unreachable. Ensure the server is running.',
        },
      ],
    };
  }
}

export type BridgeSecretVerificationStatus =
  | 'success'
  | 'mismatch'
  | 'missing'
  | 'error';

export interface BridgeSecretVerificationResult {
  ok: boolean;
  status: BridgeSecretVerificationStatus;
  label: 'Success' | 'Mismatch' | 'Missing' | 'Error';
  message: string;
  httpStatus: number | null;
  durationMs: number;
  checkedAt: string;
}

export async function verifyBridgeSecret(): Promise<BridgeSecretVerificationResult> {
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetch('/api/drive-bridge/verify-secret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      return {
        ok: false,
        status: 'error',
        label: 'Error',
        message: `Secret verification endpoint returned HTTP ${res.status}.`,
        httpStatus: res.status,
        durationMs: 0,
        checkedAt,
      };
    }
    return (await res.json()) as BridgeSecretVerificationResult;
  } catch {
    return {
      ok: false,
      status: 'error',
      label: 'Error',
      message:
        'Could not reach the backend secret verification endpoint (/api/drive-bridge/verify-secret).',
      httpStatus: null,
      durationMs: 0,
      checkedAt,
    };
  }
}

export type BridgeLogAction =
  | 'ping'
  | 'diagnose'
  | 'verifySecret'
  | 'syncMaster'
  | 'createSnapshot';

export interface BridgeApiLogEntry {
  id: string;
  timestamp: string;
  action: BridgeLogAction;
  endpoint: string;
  ok: boolean;
  httpStatus: number | null;
  durationMs: number;
  folderId: string;
  summary: string;
  rawError: string | null;
  rawResponsePreview: string | null;
  rowCount?: number;
  spreadsheetTitle?: string;
  spreadsheetUrl?: string;
}

export async function fetchBridgeLogs(): Promise<BridgeApiLogEntry[]> {
  try {
    const res = await fetch('/api/drive-bridge/logs', { method: 'GET' });
    if (!res.ok) return [];
    const data = (await res.json()) as { logs?: BridgeApiLogEntry[] };
    return Array.isArray(data.logs) ? data.logs : [];
  } catch {
    return [];
  }
}

export async function clearBridgeLogs(): Promise<boolean> {
  try {
    const res = await fetch('/api/drive-bridge/logs', { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function syncMasterSheetViaBridge(options: {
  tasks: TaskRow[];
  masterSheetTitle: string;
  masterSheetId?: string | null;
}): Promise<BridgeSyncResult> {
  const res = await fetch('/api/drive-bridge/sync-master', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tasks: options.tasks,
      masterSheetTitle: options.masterSheetTitle,
      masterSheetId: options.masterSheetId || null,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    spreadsheetId?: string;
    title?: string;
    spreadsheetUrl?: string;
    syncedAt?: string;
    rowCount?: number;
  };

  if (!res.ok || !data.ok) {
    throw new Error(
      data.error || `Master Sheet sync failed (HTTP ${res.status}).`
    );
  }

  return {
    ok: true,
    spreadsheetId: data.spreadsheetId || '',
    title: data.title || options.masterSheetTitle,
    spreadsheetUrl: data.spreadsheetUrl || '',
    syncedAt: data.syncedAt || new Date().toISOString(),
    rowCount: data.rowCount ?? options.tasks.length,
  };
}

export async function createSnapshotViaBridge(options: {
  tasks: TaskRow[];
  title: string;
}): Promise<BridgeSyncResult> {
  const res = await fetch('/api/drive-bridge/snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tasks: options.tasks,
      title: options.title,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    spreadsheetId?: string;
    title?: string;
    spreadsheetUrl?: string;
    syncedAt?: string;
    rowCount?: number;
  };

  if (!res.ok || !data.ok) {
    throw new Error(
      data.error || `Snapshot Google Sheet export failed (HTTP ${res.status}).`
    );
  }

  return {
    ok: true,
    spreadsheetId: data.spreadsheetId || '',
    title: data.title || options.title,
    spreadsheetUrl: data.spreadsheetUrl || '',
    syncedAt: data.syncedAt || new Date().toISOString(),
    rowCount: data.rowCount ?? options.tasks.length,
  };
}

export function buildAppsScriptCode(
  folderId = DEFAULT_TARGET_DRIVE_FOLDER_ID
): string {
  return `/**
 * Task Plan and Status — Automatic Google Drive & Sheets Bridge
 * Deploy as Web App:
 *   1. Project Settings -> Script Properties -> Add property: BRIDGE_SECRET
 *   2. Deploy -> New deployment -> Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 *   3. Set GOOGLE_APPS_SCRIPT_URL and GOOGLE_APPS_SCRIPT_SECRET on the server.
 */

const DEFAULT_FOLDER_ID = '${folderId}';
const MASTER_TAB_NAME = 'Task Plan';

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function writeAndFormatSheet(spreadsheet, headers, rows) {
  var sheet = spreadsheet.getSheets()[0];
  if (sheet.getName() !== MASTER_TAB_NAME) {
    sheet.setName(MASTER_TAB_NAME);
  }

  sheet.clearContents();
  var matrix = [headers].concat(rows || []);
  var colCount = headers.length;
  var rowCount = matrix.length;

  sheet.getRange(1, 1, rowCount, colCount).setValues(matrix);
  sheet.setFrozenRows(1);

  var headerRange = sheet.getRange(1, 1, 1, colCount);
  headerRange
    .setBackground('#E6F0FA')
    .setFontColor('#1A365D')
    .setFontWeight('bold');

  sheet.autoResizeColumns(1, colCount);
}

function findOrCreateMasterSpreadsheet(folder, spreadsheetId, title) {
  if (spreadsheetId) {
    try {
      var existingFile = DriveApp.getFileById(spreadsheetId);
      if (!existingFile.isTrashed()) {
        var existingSs = SpreadsheetApp.openById(spreadsheetId);
        if (existingSs.getName() !== title) {
          existingSs.rename(title);
        }
        return existingSs;
      }
    } catch (e) {
      // Fall through to search by name inside target folder
    }
  }

  var files = folder.getFilesByName(title);
  while (files.hasNext()) {
    var candidate = files.next();
    if (
      !candidate.isTrashed() &&
      candidate.getMimeType() === MimeType.GOOGLE_SHEETS
    ) {
      return SpreadsheetApp.openById(candidate.getId());
    }
  }

  var created = SpreadsheetApp.create(title);
  DriveApp.getFileById(created.getId()).moveTo(folder);
  return created;
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var payload = JSON.parse(raw);

    var expectedSecret = (PropertiesService.getScriptProperties().getProperty('BRIDGE_SECRET') || '').trim();
    if (!expectedSecret) {
      return jsonResponse({
        ok: false,
        error: 'BRIDGE_SECRET is not set in Apps Script Project Settings -> Script Properties.'
      });
    }
    var incomingSecret = typeof payload.secret === 'string' ? payload.secret.trim() : '';
    if (!incomingSecret || incomingSecret !== expectedSecret) {
      return jsonResponse({ ok: false, error: 'Unauthorized: invalid bridge secret.' });
    }

    var folderId = payload.folderId || DEFAULT_FOLDER_ID;
    var folder = DriveApp.getFolderById(folderId);
    var action = payload.action || 'ping';

    if (action === 'ping') {
      return jsonResponse({
        ok: true,
        folderId: folder.getId(),
        folderName: folder.getName()
      });
    }

    var headers = Array.isArray(payload.headers) ? payload.headers : [];
    var rows = Array.isArray(payload.rows) ? payload.rows : [];
    var title = (payload.title || 'Task Plan and Status').trim();

    if (action === 'syncMaster') {
      var masterSs = findOrCreateMasterSpreadsheet(folder, payload.spreadsheetId, title);
      writeAndFormatSheet(masterSs, headers, rows);
      return jsonResponse({
        ok: true,
        spreadsheetId: masterSs.getId(),
        title: masterSs.getName(),
        spreadsheetUrl: masterSs.getUrl(),
        syncedAt: new Date().toISOString()
      });
    }

    if (action === 'createSnapshot') {
      var snapSs = SpreadsheetApp.create(title);
      DriveApp.getFileById(snapSs.getId()).moveTo(folder);
      writeAndFormatSheet(snapSs, headers, rows);
      return jsonResponse({
        ok: true,
        spreadsheetId: snapSs.getId(),
        title: snapSs.getName(),
        spreadsheetUrl: snapSs.getUrl(),
        syncedAt: new Date().toISOString()
      });
    }

    return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}
`;
}
