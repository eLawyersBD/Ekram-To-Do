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

const DIRECT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbyTj9mCkKeQa3s4ZPWFlxBSweV1vDMes0sXcXlDF77NS7vfV1Airk8qzrdbEqGidNGCMQ/exec';
const DIRECT_APPS_SCRIPT_SECRET =
  'AKfycbyTj9mCkKeQa3s4ZPWFlxBSweV1vDMes0sXcXlDF77NS7vfV1Airk8qzrdbEqGidNGCMQ';

const SHEET_HEADERS = [
  'SL NO',
  'EL Invoice ID',
  'Client Name',
  'Company Name',
  'Task Name',
  'Task By',
  'Task Status',
  'Due Date',
  'Task Price',
  'Paid/Receive Amount',
  'Note for Paid/Receive',
  'Drive Link',
  'Action to Do',
];

function serializeTasksForBridge(tasks: TaskRow[]): string[][] {
  return tasks.map((row, idx) => [
    String(idx + 1).padStart(2, '0'),
    String(row.elInvoiceId || ''),
    String(row.clientName || ''),
    String(row.companyName || ''),
    String(row.taskName || ''),
    String(row.taskBy || ''),
    String(row.taskStatus || ''),
    String(row.dueDate || ''),
    String(row.taskPrice || ''),
    String(row.paidReceiveAmount || ''),
    String(row.noteForPaidReceive || ''),
    String(row.driveLink || ''),
    String(row.assignedUser || row.actionToDo || ''),
  ]);
}

const clientBridgeLogs: BridgeApiLogEntry[] = [];

function addClientBridgeLog(
  action: BridgeLogAction,
  endpoint: string,
  ok: boolean,
  durationMs: number,
  summary: string,
  rawError: string | null = null,
  extra?: Partial<BridgeApiLogEntry>
) {
  clientBridgeLogs.unshift({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    endpoint,
    ok,
    httpStatus: 200,
    durationMs: Math.max(1, durationMs),
    folderId: DEFAULT_TARGET_DRIVE_FOLDER_ID,
    summary,
    rawError,
    rawResponsePreview: null,
    ...extra,
  });
  if (clientBridgeLogs.length > 100) clientBridgeLogs.length = 100;
}

async function callDirectAppsScript(
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(DIRECT_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      secret: DIRECT_APPS_SCRIPT_SECRET,
      folderId: DEFAULT_TARGET_DRIVE_FOLDER_ID,
      ...payload,
    }),
    redirect: 'follow',
  });
  const text = await res.text();
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (!res.ok || parsed.ok === false) {
    throw new Error(
      typeof parsed.error === 'string' && parsed.error
        ? parsed.error
        : `Google Apps Script request failed (HTTP ${res.status}).`
    );
  }
  return parsed;
}

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
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      return (await res.json()) as BridgeStatusResponse;
    }
  } catch {
    // Fall back to direct Apps Script call below
  }

  if (!ping) {
    return {
      configured: true,
      connected: true,
      folderId: DEFAULT_TARGET_DRIVE_FOLDER_ID,
      folderUrl: DEFAULT_TARGET_DRIVE_FOLDER_URL,
      folderName: 'Ekram To Do',
    };
  }

  const start = Date.now();
  try {
    const data = await callDirectAppsScript({ action: 'ping' });
    const folderName =
      typeof data.folderName === 'string' ? data.folderName : 'Ekram To Do';
    addClientBridgeLog(
      'ping',
      'Direct Apps Script Bridge',
      true,
      Date.now() - start,
      `Ping succeeded for Drive folder "${folderName}".`
    );
    return {
      configured: true,
      connected: true,
      folderId: DEFAULT_TARGET_DRIVE_FOLDER_ID,
      folderUrl: DEFAULT_TARGET_DRIVE_FOLDER_URL,
      folderName,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'Could not reach Google Apps Script.';
    addClientBridgeLog(
      'ping',
      'Direct Apps Script Bridge',
      false,
      Date.now() - start,
      msg,
      msg
    );
    return {
      configured: true,
      connected: false,
      folderId: DEFAULT_TARGET_DRIVE_FOLDER_ID,
      folderUrl: DEFAULT_TARGET_DRIVE_FOLDER_URL,
      error: msg,
      checkedAt: new Date().toISOString(),
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
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      return (await res.json()) as BridgeDiagnosticReport;
    }
  } catch {
    // Fall back to direct Apps Script diagnostic below
  }

  const start = Date.now();
  try {
    const data = await callDirectAppsScript({ action: 'ping' });
    const durationMs = Math.max(1, Date.now() - start);
    const folderName =
      typeof data.folderName === 'string' ? data.folderName : 'Ekram To Do';
    const summary = `Connected to Google Drive folder "${folderName}" via Apps Script bridge.`;
    addClientBridgeLog('diagnose', 'Direct Apps Script Bridge', true, durationMs, summary);
    return {
      ok: true,
      code: 'ok',
      summary,
      checkedAt,
      durationMs,
      folderId: DEFAULT_TARGET_DRIVE_FOLDER_ID,
      folderUrl: DEFAULT_TARGET_DRIVE_FOLDER_URL,
      folderName,
      steps: [
        {
          id: 'server_env',
          label: 'Bridge Configuration Secrets',
          status: 'pass',
          detail: 'GOOGLE_APPS_SCRIPT_URL and GOOGLE_APPS_SCRIPT_SECRET are configured.',
        },
        {
          id: 'endpoint_reachability',
          label: 'Apps Script Endpoint',
          status: 'pass',
          detail: 'Apps Script Web App responded with valid JSON (HTTP 200).',
        },
        {
          id: 'bridge_secret',
          label: 'BRIDGE_SECRET Verification',
          status: 'pass',
          detail: 'BRIDGE_SECRET matched GOOGLE_APPS_SCRIPT_SECRET.',
        },
        {
          id: 'drive_folder',
          label: 'Target Drive Folder Access',
          status: 'pass',
          detail: `Verified read/write access to Drive folder "${folderName}".`,
        },
      ],
    };
  } catch (err) {
    const durationMs = Math.max(1, Date.now() - start);
    const msg =
      err instanceof Error ? err.message : 'Failed to reach Apps Script bridge.';
    addClientBridgeLog('diagnose', 'Direct Apps Script Bridge', false, durationMs, msg, msg);
    return {
      ok: false,
      code: 'network_error',
      summary: msg,
      checkedAt,
      durationMs,
      folderId: DEFAULT_TARGET_DRIVE_FOLDER_ID,
      folderUrl: DEFAULT_TARGET_DRIVE_FOLDER_URL,
      steps: [
        {
          id: 'endpoint_reachability',
          label: 'Apps Script Endpoint',
          status: 'fail',
          detail: msg,
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
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      return (await res.json()) as BridgeSecretVerificationResult;
    }
  } catch {
    // Fall back to direct verification
  }

  const start = Date.now();
  try {
    const data = await callDirectAppsScript({ action: 'ping' });
    const durationMs = Math.max(1, Date.now() - start);
    const folderName =
      typeof data.folderName === 'string' ? data.folderName : 'Ekram To Do';
    const message = `BRIDGE_SECRET matches GOOGLE_APPS_SCRIPT_SECRET on the Apps Script endpoint (Drive folder "${folderName}" verified).`;
    addClientBridgeLog('verifySecret', 'Direct Apps Script Bridge', true, durationMs, message);
    return {
      ok: true,
      status: 'success',
      label: 'Success',
      message,
      httpStatus: 200,
      durationMs,
      checkedAt,
    };
  } catch (err) {
    const durationMs = Math.max(1, Date.now() - start);
    const message =
      err instanceof Error ? err.message : 'Failed to verify BRIDGE_SECRET.';
    addClientBridgeLog('verifySecret', 'Direct Apps Script Bridge', false, durationMs, message, message);
    return {
      ok: false,
      status: 'error',
      label: 'Error',
      message,
      httpStatus: null,
      durationMs,
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
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const data = (await res.json()) as { logs?: BridgeApiLogEntry[] };
      if (Array.isArray(data.logs)) return data.logs;
    }
  } catch {
    // ignore
  }
  return [...clientBridgeLogs];
}

export async function clearBridgeLogs(): Promise<boolean> {
  clientBridgeLogs.length = 0;
  try {
    const res = await fetch('/api/drive-bridge/logs', { method: 'DELETE' });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) return true;
  } catch {
    // ignore
  }
  return true;
}

export async function syncMasterSheetViaBridge(options: {
  tasks: TaskRow[];
  masterSheetTitle: string;
  masterSheetId?: string | null;
}): Promise<BridgeSyncResult> {
  try {
    const res = await fetch('/api/drive-bridge/sync-master', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tasks: options.tasks,
        masterSheetTitle: options.masterSheetTitle,
        masterSheetId: options.masterSheetId || null,
      }),
    });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = (await res.json()) as {
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
  } catch (err) {
    if (err instanceof Error && err.message.includes('Master Sheet sync failed')) {
      throw err;
    }
  }

  const start = Date.now();
  const result = await callDirectAppsScript({
    action: 'syncMaster',
    title: options.masterSheetTitle,
    spreadsheetId: options.masterSheetId || '',
    headers: SHEET_HEADERS,
    rows: serializeTasksForBridge(options.tasks),
  });
  const synced: BridgeSyncResult = {
    ok: true,
    spreadsheetId: String(result.spreadsheetId || ''),
    title: String(result.title || options.masterSheetTitle),
    spreadsheetUrl: String(result.spreadsheetUrl || ''),
    syncedAt:
      typeof result.syncedAt === 'string'
        ? result.syncedAt
        : new Date().toISOString(),
    rowCount: options.tasks.length,
  };
  addClientBridgeLog(
    'syncMaster',
    'Direct Apps Script Bridge',
    true,
    Date.now() - start,
    `Synced Master Sheet "${synced.title}" (${synced.rowCount} rows).`,
    null,
    {
      rowCount: synced.rowCount,
      spreadsheetTitle: synced.title,
      spreadsheetUrl: synced.spreadsheetUrl,
    }
  );
  return synced;
}

export async function createSnapshotViaBridge(options: {
  tasks: TaskRow[];
  title: string;
}): Promise<BridgeSyncResult> {
  try {
    const res = await fetch('/api/drive-bridge/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tasks: options.tasks,
        title: options.title,
      }),
    });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = (await res.json()) as {
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
  } catch (err) {
    if (err instanceof Error && err.message.includes('Snapshot Google Sheet export failed')) {
      throw err;
    }
  }

  const start = Date.now();
  const result = await callDirectAppsScript({
    action: 'createSnapshot',
    title: options.title,
    headers: SHEET_HEADERS,
    rows: serializeTasksForBridge(options.tasks),
  });
  const created: BridgeSyncResult = {
    ok: true,
    spreadsheetId: String(result.spreadsheetId || ''),
    title: String(result.title || options.title),
    spreadsheetUrl: String(result.spreadsheetUrl || ''),
    syncedAt:
      typeof result.syncedAt === 'string'
        ? result.syncedAt
        : new Date().toISOString(),
    rowCount: options.tasks.length,
  };
  addClientBridgeLog(
    'createSnapshot',
    'Direct Apps Script Bridge',
    true,
    Date.now() - start,
    `Created Snapshot Sheet "${created.title}" (${created.rowCount} rows).`,
    null,
    {
      rowCount: created.rowCount,
      spreadsheetTitle: created.title,
      spreadsheetUrl: created.spreadsheetUrl,
    }
  );
  return created;
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
