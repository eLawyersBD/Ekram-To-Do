import 'dotenv/config';
import { randomUUID } from 'crypto';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, 'data');
const USERS_FILE = path.resolve(DATA_DIR, 'users.json');

const PORT = Number(process.env.PORT) || 3091;
const DEFAULT_FOLDER_ID = '1OjfZm2kE5F9yGnmdFIv8WZpuAPpu9VpG';
const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbyTj9mCkKeQa3s4ZPWFlxBSweV1vDMes0sXcXlDF77NS7vfV1Airk8qzrdbEqGidNGCMQ/exec';
const DEFAULT_APPS_SCRIPT_SECRET =
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

interface TaskInputRow {
  elInvoiceId?: string;
  clientName?: string;
  companyName?: string;
  taskName?: string;
  taskBy?: string;
  taskStatus?: string;
  dueDate?: string;
  taskPrice?: string;
  paidReceiveAmount?: string;
  noteForPaidReceive?: string;
  driveLink?: string;
  assignedUser?: string;
  actionToDo?: string;
}

function cleanEnvValue(raw: string | undefined): string {
  const trimmed = (raw || '').trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function getBridgeEnv() {
  const scriptUrl =
    cleanEnvValue(process.env.GOOGLE_APPS_SCRIPT_URL) || DEFAULT_APPS_SCRIPT_URL;
  const rawSecret =
    process.env.GOOGLE_APPS_SCRIPT_SECRET || DEFAULT_APPS_SCRIPT_SECRET;
  const secret = cleanEnvValue(rawSecret);
  const folderId =
    cleanEnvValue(process.env.GOOGLE_DRIVE_TARGET_FOLDER_ID) ||
    DEFAULT_FOLDER_ID;
  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
  return {
    scriptUrl,
    secret,
    rawSecret,
    folderId,
    folderUrl,
    configured: Boolean(scriptUrl && secret),
  };
}

function buildSecretMismatchDetail(env: ReturnType<typeof getBridgeEnv>): string {
  const baseHint =
    'BRIDGE_SECRET is present in Apps Script, but it does not match GOOGLE_APPS_SCRIPT_SECRET on the server.';

  if (env.secret === env.scriptUrl || /^https?:\/\//i.test(env.secret)) {
    return `${baseHint} Server GOOGLE_APPS_SCRIPT_SECRET currently looks like a URL (not a passphrase). Update GOOGLE_APPS_SCRIPT_SECRET in AI Studio Secrets to match your BRIDGE_SECRET passphrase.`;
  }

  if (env.secret === env.folderId) {
    return `${baseHint} Server GOOGLE_APPS_SCRIPT_SECRET currently matches the Google Drive Folder ID instead of a passphrase. Update GOOGLE_APPS_SCRIPT_SECRET in AI Studio Secrets to match your BRIDGE_SECRET passphrase.`;
  }

  if (/^(BRIDGE_SECRET|GOOGLE_APPS_SCRIPT_SECRET)$/i.test(env.secret)) {
    return `${baseHint} Server GOOGLE_APPS_SCRIPT_SECRET is set to the literal key name instead of a passphrase value. Replace it with your actual secret passphrase.`;
  }

  if (/^(BRIDGE_SECRET|GOOGLE_APPS_SCRIPT_SECRET)\s*=/i.test(env.secret)) {
    return `${baseHint} Server GOOGLE_APPS_SCRIPT_SECRET appears to include a "KEY=" prefix. Store only the passphrase value itself (without "BRIDGE_SECRET=" or "GOOGLE_APPS_SCRIPT_SECRET=").`;
  }

  if (/^AKfycb[A-Za-z0-9_-]{20,}$/.test(env.secret)) {
    return `${baseHint} Server GOOGLE_APPS_SCRIPT_SECRET (${env.secret.length} chars) looks like a Google Apps Script Deployment ID instead of a custom passphrase. Set both GOOGLE_APPS_SCRIPT_SECRET (AI Studio Secrets) and BRIDGE_SECRET (Apps Script Script Properties) to the exact same passphrase.`;
  }

  if (/\.apps\.googleusercontent\.com$/i.test(env.secret)) {
    return `${baseHint} Server GOOGLE_APPS_SCRIPT_SECRET (${env.secret.length} chars) looks like a Google OAuth Client ID instead of your bridge passphrase. Set both GOOGLE_APPS_SCRIPT_SECRET and BRIDGE_SECRET to the same passphrase.`;
  }

  if (/^GOCSPX-/i.test(env.secret) || /^AIza[0-9A-Za-z_-]{20,}$/.test(env.secret)) {
    return `${baseHint} Server GOOGLE_APPS_SCRIPT_SECRET (${env.secret.length} chars) looks like a Google API/OAuth key rather than your Apps Script BRIDGE_SECRET passphrase. Set both GOOGLE_APPS_SCRIPT_SECRET and BRIDGE_SECRET to the exact same value.`;
  }

  const notes: string[] = [];
  if (/\s/.test(env.secret)) {
    notes.push('contains whitespace');
  }
  if (env.rawSecret !== env.secret) {
    notes.push('had leading/trailing whitespace or quotes');
  }
  const noteSuffix = notes.length > 0 ? ` (${notes.join('; ')})` : '';

  return `${baseHint} Server GOOGLE_APPS_SCRIPT_SECRET is ${env.secret.length} characters long${noteSuffix}. Confirm that BRIDGE_SECRET in Apps Script Project Settings → Script Properties is the exact same ${env.secret.length}-character passphrase (case-sensitive, no extra spaces or quotes).`;
}

function serializeTasksForSheet(tasks: TaskInputRow[]): string[][] {
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

type BridgeLogAction =
  | 'ping'
  | 'diagnose'
  | 'verifySecret'
  | 'syncMaster'
  | 'createSnapshot';

interface BridgeApiLogEntry {
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

const MAX_BRIDGE_API_LOGS = 150;
const bridgeApiLogs: BridgeApiLogEntry[] = [];

function sanitizeRawPreview(
  raw: string | null | undefined,
  secrets?: string | string[]
): string | null {
  if (!raw) return null;
  let cleaned = raw;
  const secretList = Array.isArray(secrets)
    ? secrets
    : secrets
      ? [secrets]
      : [];
  for (const s of secretList) {
    if (s && s.length >= 3) {
      cleaned = cleaned.split(s).join('[REDACTED]');
    }
  }
  const MAX_CHARS = 2000;
  return cleaned.length > MAX_CHARS
    ? `${cleaned.slice(0, MAX_CHARS)}\n... [truncated]`
    : cleaned;
}

function recordBridgeApiLog(
  entry: Omit<BridgeApiLogEntry, 'id' | 'timestamp'> & { timestamp?: string },
  secretsToRedact?: string | string[]
): void {
  const sanitizedError = entry.rawError
    ? sanitizeRawPreview(entry.rawError, secretsToRedact)
    : null;
  const sanitizedPreview = sanitizeRawPreview(
    entry.rawResponsePreview,
    secretsToRedact
  );
  bridgeApiLogs.unshift({
    id: randomUUID(),
    timestamp: entry.timestamp || new Date().toISOString(),
    action: entry.action,
    endpoint: entry.endpoint,
    ok: entry.ok,
    httpStatus: entry.httpStatus,
    durationMs: Math.max(1, entry.durationMs),
    folderId: entry.folderId,
    summary: entry.summary,
    rawError: sanitizedError,
    rawResponsePreview: sanitizedPreview,
    rowCount: entry.rowCount,
    spreadsheetTitle: entry.spreadsheetTitle,
    spreadsheetUrl: entry.spreadsheetUrl,
  });
  if (bridgeApiLogs.length > MAX_BRIDGE_API_LOGS) {
    bridgeApiLogs.length = MAX_BRIDGE_API_LOGS;
  }
}

async function postAppsScriptOnce(
  scriptUrl: string,
  payload: Record<string, unknown>
): Promise<{ response: globalThis.Response; rawText: string }> {
  const response = await fetch(scriptUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });
  const rawText = await response.text();
  return { response, rawText };
}

async function callAppsScriptBridge(
  scriptUrl: string,
  payload: Record<string, unknown>,
  logContext?: {
    action: BridgeLogAction;
    endpoint: string;
    folderId: string;
    secret?: string;
    fallbackSecret?: string;
    rowCount?: number;
    spreadsheetTitle?: string;
  }
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const secretsToRedact = [
    logContext?.secret || '',
    logContext?.fallbackSecret || '',
  ].filter(Boolean);
  let response: globalThis.Response;
  let rawText = '';

  try {
    const firstAttempt = await postAppsScriptOnce(scriptUrl, payload);
    response = firstAttempt.response;
    rawText = firstAttempt.rawText;
  } catch (err) {
    const errMsg =
      err instanceof Error
        ? err.message
        : 'Network error contacting Google Apps Script.';
    if (logContext) {
      recordBridgeApiLog(
        {
          action: logContext.action,
          endpoint: logContext.endpoint,
          ok: false,
          httpStatus: null,
          durationMs: Date.now() - startedAt,
          folderId: logContext.folderId,
          summary: errMsg,
          rawError: errMsg,
          rawResponsePreview: null,
          rowCount: logContext.rowCount,
          spreadsheetTitle: logContext.spreadsheetTitle,
        },
        secretsToRedact
      );
    }
    throw new Error(errMsg);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    const looksLikeLoginPage =
      rawText.includes('accounts.google.com') ||
      rawText.toLowerCase().includes('<html');
    const errMsg = looksLikeLoginPage
      ? 'Google Apps Script returned an HTML page instead of JSON. Ensure the Web App is deployed with "Execute as: Me" and "Who has access: Anyone".'
      : `Unexpected response from Google Apps Script (HTTP ${response.status}).`;
    if (logContext) {
      recordBridgeApiLog(
        {
          action: logContext.action,
          endpoint: logContext.endpoint,
          ok: false,
          httpStatus: response.status,
          durationMs: Date.now() - startedAt,
          folderId: logContext.folderId,
          summary: errMsg,
          rawError: errMsg,
          rawResponsePreview: rawText,
          rowCount: logContext.rowCount,
          spreadsheetTitle: logContext.spreadsheetTitle,
        },
        secretsToRedact
      );
    }
    throw new Error(errMsg);
  }

  // If Apps Script rejected cleaned secret with Unauthorized, retry once with the raw env secret
  // (handles cases where quotes or whitespace were literally included on both sides).
  if (
    (!response.ok || parsed.ok === false) &&
    typeof parsed.error === 'string' &&
    /Unauthorized|invalid bridge secret/i.test(parsed.error) &&
    logContext?.fallbackSecret &&
    logContext.fallbackSecret !== payload.secret
  ) {
    try {
      const retryAttempt = await postAppsScriptOnce(scriptUrl, {
        ...payload,
        secret: logContext.fallbackSecret,
      });
      const retryParsed = JSON.parse(retryAttempt.rawText) as Record<
        string,
        unknown
      >;
      if (retryAttempt.response.ok && retryParsed.ok !== false) {
        response = retryAttempt.response;
        rawText = retryAttempt.rawText;
        parsed = retryParsed;
      }
    } catch {
      // Fall through to report the original unauthorized response cleanly
    }
  }

  if (!response.ok || parsed.ok === false) {
    const msg =
      typeof parsed.error === 'string' && parsed.error
        ? parsed.error
        : `Google Apps Script bridge request failed (HTTP ${response.status}).`;
    if (logContext) {
      recordBridgeApiLog(
        {
          action: logContext.action,
          endpoint: logContext.endpoint,
          ok: false,
          httpStatus: response.status,
          durationMs: Date.now() - startedAt,
          folderId: logContext.folderId,
          summary: msg,
          rawError: msg,
          rawResponsePreview: rawText,
          rowCount: logContext.rowCount,
          spreadsheetTitle: logContext.spreadsheetTitle,
        },
        secretsToRedact
      );
    }
    throw new Error(msg);
  }

  if (logContext) {
    const resolvedTitle =
      typeof parsed.title === 'string' && parsed.title
        ? parsed.title
        : logContext.spreadsheetTitle;
    const resolvedUrl =
      typeof parsed.spreadsheetUrl === 'string' && parsed.spreadsheetUrl
        ? parsed.spreadsheetUrl
        : undefined;
    const resolvedFolder =
      typeof parsed.folderName === 'string' && parsed.folderName
        ? parsed.folderName
        : logContext.folderId;

    const successSummary =
      logContext.action === 'ping'
        ? `Ping succeeded for Drive folder "${resolvedFolder}".`
        : logContext.action === 'syncMaster'
          ? `Synced Master Sheet "${resolvedTitle || 'Master'}" (${
              logContext.rowCount ?? 0
            } rows).`
          : `Created Snapshot Sheet "${resolvedTitle || 'Snapshot'}" (${
              logContext.rowCount ?? 0
            } rows).`;

    recordBridgeApiLog(
      {
        action: logContext.action,
        endpoint: logContext.endpoint,
        ok: true,
        httpStatus: response.status,
        durationMs: Date.now() - startedAt,
        folderId: logContext.folderId,
        summary: successSummary,
        rawError: null,
        rawResponsePreview: rawText,
        rowCount: logContext.rowCount,
        spreadsheetTitle: resolvedTitle,
        spreadsheetUrl: resolvedUrl,
      },
      secretsToRedact
    );
  }

  return parsed;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // 1. Check server bridge configuration & optionally ping the deployed Apps Script
  app.get('/api/drive-bridge/status', async (req: Request, res: Response) => {
    const env = getBridgeEnv();
    const shouldPing = req.query.ping !== '0';

    if (!env.configured) {
      res.json({
        configured: false,
        connected: false,
        folderId: env.folderId,
        folderUrl: env.folderUrl,
        message:
          'Set GOOGLE_APPS_SCRIPT_URL and GOOGLE_APPS_SCRIPT_SECRET in server environment variables to activate automatic sync.',
      });
      return;
    }

    if (!shouldPing) {
      res.json({
        configured: true,
        connected: true,
        folderId: env.folderId,
        folderUrl: env.folderUrl,
      });
      return;
    }

    try {
      const result = await callAppsScriptBridge(
        env.scriptUrl,
        {
          action: 'ping',
          secret: env.secret,
          folderId: env.folderId,
        },
        {
          action: 'ping',
          endpoint: '/api/drive-bridge/status',
          folderId: env.folderId,
          secret: env.secret,
          fallbackSecret: env.rawSecret,
        }
      );

      res.json({
        configured: true,
        connected: true,
        folderId: env.folderId,
        folderUrl: env.folderUrl,
        folderName:
          typeof result.folderName === 'string' ? result.folderName : undefined,
        checkedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.json({
        configured: true,
        connected: false,
        folderId: env.folderId,
        folderUrl: env.folderUrl,
        error:
          err instanceof Error
            ? err.message
            : 'Could not reach the Google Apps Script bridge.',
        checkedAt: new Date().toISOString(),
      });
    }
  });

  // 1b. Explicit step-by-step diagnostic check (verifies BRIDGE_SECRET recognition & match)
  app.post('/api/drive-bridge/diagnose', async (_req: Request, res: Response) => {
    const startedAt = Date.now();
    const env = getBridgeEnv();
    const checkedAt = new Date().toISOString();

    type StepStatus = 'pass' | 'fail' | 'warn' | 'skipped';
    interface DiagnosticStep {
      id: 'server_env' | 'endpoint_reachability' | 'bridge_secret' | 'drive_folder';
      label: string;
      status: StepStatus;
      detail: string;
    }

    let lastHttpStatus: number | null = null;
    let lastRawResponse: string | null = null;

    const sendReport = (payload: {
      ok: boolean;
      code:
        | 'ok'
        | 'missing_server_env'
        | 'invalid_script_url'
        | 'html_response'
        | 'missing_apps_script_secret'
        | 'secret_mismatch'
        | 'folder_access_error'
        | 'network_error'
        | 'script_error';
      summary: string;
      folderName?: string;
      rawError?: string | null;
      steps: DiagnosticStep[];
    }) => {
      const durationMs = Math.max(1, Date.now() - startedAt);
      recordBridgeApiLog(
        {
          timestamp: checkedAt,
          action: 'diagnose',
          endpoint: '/api/drive-bridge/diagnose',
          ok: payload.ok,
          httpStatus: lastHttpStatus,
          durationMs,
          folderId: env.folderId,
          summary: payload.summary,
          rawError: payload.ok ? null : payload.rawError ?? payload.summary,
          rawResponsePreview: lastRawResponse,
        },
        [env.secret, env.rawSecret].filter(Boolean)
      );
      res.json({
        ok: payload.ok,
        code: payload.code,
        summary: payload.summary,
        folderName: payload.folderName,
        steps: payload.steps,
        checkedAt,
        durationMs,
        folderId: env.folderId,
        folderUrl: env.folderUrl,
      });
    };

    // Step 1: Server environment secrets
    if (!env.scriptUrl || !env.secret) {
      const missingVars: string[] = [];
      if (!env.scriptUrl) missingVars.push('GOOGLE_APPS_SCRIPT_URL');
      if (!env.secret) missingVars.push('GOOGLE_APPS_SCRIPT_SECRET');
      const detail = `Missing server environment secret(s): ${missingVars.join(' and ')}. Add them in your AI Studio Secrets panel.`;
      sendReport({
        ok: false,
        code: 'missing_server_env',
        summary: detail,
        steps: [
          {
            id: 'server_env',
            label: 'Server Environment Secrets',
            status: 'fail',
            detail,
          },
          {
            id: 'endpoint_reachability',
            label: 'Apps Script Endpoint',
            status: 'skipped',
            detail: 'Skipped until server environment secrets are set.',
          },
          {
            id: 'bridge_secret',
            label: 'BRIDGE_SECRET Verification',
            status: 'skipped',
            detail: 'Skipped until GOOGLE_APPS_SCRIPT_SECRET is configured.',
          },
          {
            id: 'drive_folder',
            label: 'Target Drive Folder Access',
            status: 'skipped',
            detail: 'Skipped until authentication succeeds.',
          },
        ],
      });
      return;
    }

    if (
      !/^https:\/\//i.test(env.scriptUrl) ||
      /\/dev(\?.*)?$/i.test(env.scriptUrl)
    ) {
      const isDevUrl = /\/dev(\?.*)?$/i.test(env.scriptUrl);
      const detail = isDevUrl
        ? 'GOOGLE_APPS_SCRIPT_URL points to a test (/dev) URL. Use the deployed Web App URL ending in /exec.'
        : 'GOOGLE_APPS_SCRIPT_URL must be a valid HTTPS Google Apps Script Web App URL ending in /exec.';
      sendReport({
        ok: false,
        code: 'invalid_script_url',
        summary: detail,
        steps: [
          {
            id: 'server_env',
            label: 'Server Environment Secrets',
            status: 'fail',
            detail,
          },
          {
            id: 'endpoint_reachability',
            label: 'Apps Script Endpoint',
            status: 'skipped',
            detail: 'Skipped due to invalid Web App URL.',
          },
          {
            id: 'bridge_secret',
            label: 'BRIDGE_SECRET Verification',
            status: 'skipped',
            detail: 'Skipped until Web App URL is valid.',
          },
          {
            id: 'drive_folder',
            label: 'Target Drive Folder Access',
            status: 'skipped',
            detail: 'Skipped until authentication succeeds.',
          },
        ],
      });
      return;
    }

    const serverEnvStep: DiagnosticStep = {
      id: 'server_env',
      label: 'Server Environment Secrets',
      status: 'pass',
      detail:
        'GOOGLE_APPS_SCRIPT_URL (/exec) and GOOGLE_APPS_SCRIPT_SECRET are configured on the server.',
    };

    // Step 2: Reach Apps Script Web App
    let response: globalThis.Response;
    let rawText = '';
    try {
      response = await fetch(env.scriptUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify({
          action: 'ping',
          secret: env.secret,
          folderId: env.folderId,
        }),
        redirect: 'follow',
      });
      rawText = await response.text();
      lastHttpStatus = response.status;
      lastRawResponse = rawText;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Network error contacting Google Apps Script.';
      sendReport({
        ok: false,
        code: 'network_error',
        summary: `Could not reach Apps Script endpoint: ${msg}`,
        steps: [
          serverEnvStep,
          {
            id: 'endpoint_reachability',
            label: 'Apps Script Endpoint',
            status: 'fail',
            detail: `Request failed: ${msg}`,
          },
          {
            id: 'bridge_secret',
            label: 'BRIDGE_SECRET Verification',
            status: 'skipped',
            detail: 'Could not verify BRIDGE_SECRET because the endpoint was unreachable.',
          },
          {
            id: 'drive_folder',
            label: 'Target Drive Folder Access',
            status: 'skipped',
            detail: 'Skipped until endpoint is reachable.',
          },
        ],
      });
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      const looksLikeHtml =
        rawText.includes('accounts.google.com') ||
        rawText.toLowerCase().includes('<html');
      const detail = looksLikeHtml
        ? 'Apps Script returned an HTML login or error page instead of JSON. Confirm deployment uses "Execute as: Me" and "Who has access: Anyone".'
        : `Apps Script returned a non-JSON response (HTTP ${response.status}).`;
      sendReport({
        ok: false,
        code: 'html_response',
        summary: detail,
        steps: [
          serverEnvStep,
          {
            id: 'endpoint_reachability',
            label: 'Apps Script Endpoint',
            status: 'fail',
            detail,
          },
          {
            id: 'bridge_secret',
            label: 'BRIDGE_SECRET Verification',
            status: 'skipped',
            detail:
              'Could not verify BRIDGE_SECRET because Apps Script did not return a JSON response.',
          },
          {
            id: 'drive_folder',
            label: 'Target Drive Folder Access',
            status: 'skipped',
            detail: 'Skipped until Apps Script returns JSON.',
          },
        ],
      });
      return;
    }

    const endpointStep: DiagnosticStep = {
      id: 'endpoint_reachability',
      label: 'Apps Script Endpoint',
      status: 'pass',
      detail: `Apps Script Web App responded with valid JSON (HTTP ${response.status}).`,
    };

    // Step 3: Explicit BRIDGE_SECRET recognition & match verification
    let errorMessage =
      typeof parsed.error === 'string' ? parsed.error.trim() : '';

    // Auto-retry once with raw env secret if cleaned secret was rejected as Unauthorized
    if (
      (parsed.ok === false || !response.ok) &&
      /Unauthorized|invalid bridge secret/i.test(errorMessage) &&
      env.rawSecret &&
      env.rawSecret !== env.secret
    ) {
      try {
        const retryAttempt = await postAppsScriptOnce(env.scriptUrl, {
          action: 'ping',
          secret: env.rawSecret,
          folderId: env.folderId,
        });
        const retryParsed = JSON.parse(retryAttempt.rawText) as Record<
          string,
          unknown
        >;
        if (retryAttempt.response.ok && retryParsed.ok !== false) {
          response = retryAttempt.response;
          rawText = retryAttempt.rawText;
          lastHttpStatus = response.status;
          lastRawResponse = rawText;
          parsed = retryParsed;
          errorMessage = '';
        }
      } catch {
        // Keep original unauthorized error response
      }
    }

    if (parsed.ok === false || !response.ok) {
      if (/BRIDGE_SECRET.*not set/i.test(errorMessage)) {
        const detail =
          'BRIDGE_SECRET is missing in Google Apps Script. Open Project Settings → Script Properties, add Property "BRIDGE_SECRET" with your passphrase, and click Save script properties.';
        sendReport({
          ok: false,
          code: 'missing_apps_script_secret',
          summary:
            'BRIDGE_SECRET is missing in Apps Script Project Settings → Script Properties.',
          steps: [
            serverEnvStep,
            endpointStep,
            {
              id: 'bridge_secret',
              label: 'BRIDGE_SECRET Verification',
              status: 'fail',
              detail,
            },
            {
              id: 'drive_folder',
              label: 'Target Drive Folder Access',
              status: 'skipped',
              detail: 'Skipped until BRIDGE_SECRET is configured.',
            },
          ],
        });
        return;
      }

      if (/Unauthorized|invalid bridge secret/i.test(errorMessage)) {
        const detail = buildSecretMismatchDetail(env);
        sendReport({
          ok: false,
          code: 'secret_mismatch',
          summary:
            'Secret mismatch: BRIDGE_SECRET in Apps Script does not match GOOGLE_APPS_SCRIPT_SECRET.',
          rawError: errorMessage,
          steps: [
            serverEnvStep,
            endpointStep,
            {
              id: 'bridge_secret',
              label: 'BRIDGE_SECRET Verification',
              status: 'fail',
              detail,
            },
            {
              id: 'drive_folder',
              label: 'Target Drive Folder Access',
              status: 'skipped',
              detail: 'Skipped until BRIDGE_SECRET matches.',
            },
          ],
        });
        return;
      }

      // If Apps Script got past secret validation and threw a Drive folder or runtime error
      const isFolderError =
        /folder|DriveApp|No item with the given ID|permission|access/i.test(
          errorMessage
        );
      sendReport({
        ok: false,
        code: isFolderError ? 'folder_access_error' : 'script_error',
        summary:
          errorMessage ||
          `Apps Script rejected the request (HTTP ${response.status}).`,
        steps: [
          serverEnvStep,
          endpointStep,
          {
            id: 'bridge_secret',
            label: 'BRIDGE_SECRET Verification',
            status: 'pass',
            detail:
              'BRIDGE_SECRET was recognized and accepted by the Apps Script endpoint.',
          },
          {
            id: 'drive_folder',
            label: 'Target Drive Folder Access',
            status: 'fail',
            detail:
              errorMessage ||
              `Could not access target Drive folder "${env.folderId}".`,
          },
        ],
      });
      return;
    }

    // Step 4: Full end-to-end success
    const folderName =
      typeof parsed.folderName === 'string' && parsed.folderName.trim()
        ? parsed.folderName.trim()
        : undefined;

    sendReport({
      ok: true,
      code: 'ok',
      folderName,
      summary: `Connection verified: BRIDGE_SECRET accepted and Drive folder "${
        folderName || env.folderId
      }" is accessible.`,
      steps: [
        serverEnvStep,
        endpointStep,
        {
          id: 'bridge_secret',
          label: 'BRIDGE_SECRET Verification',
          status: 'pass',
          detail:
            'BRIDGE_SECRET was explicitly recognized and matched GOOGLE_APPS_SCRIPT_SECRET.',
        },
        {
          id: 'drive_folder',
          label: 'Target Drive Folder Access',
          status: 'pass',
          detail: folderName
            ? `Resolved target Google Drive folder "${folderName}" (${env.folderId}).`
            : `Resolved target Google Drive folder (${env.folderId}).`,
        },
      ],
    });
  });

  // 1c. Dedicated BRIDGE_SECRET verification test (returns explicit Success or Mismatch status)
  app.post(
    '/api/drive-bridge/verify-secret',
    async (_req: Request, res: Response) => {
      const startedAt = Date.now();
      const env = getBridgeEnv();
      const checkedAt = new Date().toISOString();
      const secretsToRedact = [env.secret, env.rawSecret].filter(Boolean);

      type VerifyStatus = 'success' | 'mismatch' | 'missing' | 'error';

      const sendResult = (payload: {
        ok: boolean;
        status: VerifyStatus;
        label: 'Success' | 'Mismatch' | 'Missing' | 'Error';
        message: string;
        httpStatus: number | null;
        rawError?: string | null;
        rawResponse?: string | null;
      }) => {
        const durationMs = Math.max(1, Date.now() - startedAt);
        recordBridgeApiLog(
          {
            timestamp: checkedAt,
            action: 'verifySecret',
            endpoint: '/api/drive-bridge/verify-secret',
            ok: payload.ok,
            httpStatus: payload.httpStatus,
            durationMs,
            folderId: env.folderId,
            summary: `Verify Secret: ${payload.label} — ${payload.message}`,
            rawError: payload.ok ? null : payload.rawError ?? payload.message,
            rawResponsePreview: payload.rawResponse ?? null,
          },
          secretsToRedact
        );
        res.json({
          ok: payload.ok,
          status: payload.status,
          label: payload.label,
          message: payload.message,
          httpStatus: payload.httpStatus,
          durationMs,
          checkedAt,
        });
      };

      if (!env.scriptUrl || !env.secret) {
        const missingVars: string[] = [];
        if (!env.scriptUrl) missingVars.push('GOOGLE_APPS_SCRIPT_URL');
        if (!env.secret) missingVars.push('GOOGLE_APPS_SCRIPT_SECRET');
        sendResult({
          ok: false,
          status: 'missing',
          label: 'Missing',
          message: `Missing server secret(s): ${missingVars.join(' and ')}. Set them in your AI Studio Secrets panel first.`,
          httpStatus: null,
        });
        return;
      }

      if (
        !/^https:\/\//i.test(env.scriptUrl) ||
        /\/dev(\?.*)?$/i.test(env.scriptUrl)
      ) {
        sendResult({
          ok: false,
          status: 'error',
          label: 'Error',
          message:
            'GOOGLE_APPS_SCRIPT_URL must be a deployed HTTPS Web App URL ending in /exec.',
          httpStatus: null,
        });
        return;
      }

      let response: globalThis.Response;
      let rawText = '';
      try {
        const attempt = await postAppsScriptOnce(env.scriptUrl, {
          action: 'ping',
          secret: env.secret,
          folderId: env.folderId,
        });
        response = attempt.response;
        rawText = attempt.rawText;
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Network error contacting Apps Script endpoint.';
        sendResult({
          ok: false,
          status: 'error',
          label: 'Error',
          message: `Could not reach Apps Script endpoint: ${msg}`,
          httpStatus: null,
          rawError: msg,
        });
        return;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        const looksLikeHtml =
          rawText.includes('accounts.google.com') ||
          rawText.toLowerCase().includes('<html');
        const msg = looksLikeHtml
          ? 'Apps Script returned an HTML page instead of JSON. Ensure the Web App is deployed with "Execute as: Me" and "Who has access: Anyone".'
          : `Apps Script returned a non-JSON response (HTTP ${response.status}).`;
        sendResult({
          ok: false,
          status: 'error',
          label: 'Error',
          message: msg,
          httpStatus: response.status,
          rawError: msg,
          rawResponse: rawText,
        });
        return;
      }

      let errorMessage =
        typeof parsed.error === 'string' ? parsed.error.trim() : '';

      // Auto-retry once with raw env secret if cleaned secret was rejected as Unauthorized
      if (
        (parsed.ok === false || !response.ok) &&
        /Unauthorized|invalid bridge secret/i.test(errorMessage) &&
        env.rawSecret &&
        env.rawSecret !== env.secret
      ) {
        try {
          const retryAttempt = await postAppsScriptOnce(env.scriptUrl, {
            action: 'ping',
            secret: env.rawSecret,
            folderId: env.folderId,
          });
          const retryParsed = JSON.parse(retryAttempt.rawText) as Record<
            string,
            unknown
          >;
          if (
            retryAttempt.response.ok &&
            (retryParsed.ok !== false ||
              (typeof retryParsed.error === 'string' &&
                !/Unauthorized|invalid bridge secret|BRIDGE_SECRET.*not set/i.test(
                  retryParsed.error
                )))
          ) {
            response = retryAttempt.response;
            rawText = retryAttempt.rawText;
            parsed = retryParsed;
            errorMessage =
              typeof retryParsed.error === 'string'
                ? retryParsed.error.trim()
                : '';
          }
        } catch {
          // Keep original unauthorized error response
        }
      }

      if (parsed.ok === false || !response.ok) {
        if (/BRIDGE_SECRET.*not set/i.test(errorMessage)) {
          sendResult({
            ok: false,
            status: 'mismatch',
            label: 'Mismatch',
            message:
              'BRIDGE_SECRET is not set in Apps Script Project Settings → Script Properties.',
            httpStatus: response.status,
            rawError: errorMessage,
            rawResponse: rawText,
          });
          return;
        }

        if (/Unauthorized|invalid bridge secret/i.test(errorMessage)) {
          sendResult({
            ok: false,
            status: 'mismatch',
            label: 'Mismatch',
            message: buildSecretMismatchDetail(env),
            httpStatus: response.status,
            rawError: errorMessage,
            rawResponse: rawText,
          });
          return;
        }

        // Apps Script passed the BRIDGE_SECRET comparison and reached downstream Drive execution
        sendResult({
          ok: true,
          status: 'success',
          label: 'Success',
          message: `BRIDGE_SECRET matched GOOGLE_APPS_SCRIPT_SECRET (Apps Script then reported: ${errorMessage}).`,
          httpStatus: response.status,
          rawResponse: rawText,
        });
        return;
      }

      const folderName =
        typeof parsed.folderName === 'string' && parsed.folderName.trim()
          ? parsed.folderName.trim()
          : '';
      sendResult({
        ok: true,
        status: 'success',
        label: 'Success',
        message: folderName
          ? `BRIDGE_SECRET matches GOOGLE_APPS_SCRIPT_SECRET on the Apps Script endpoint (Drive folder "${folderName}" verified).`
          : 'BRIDGE_SECRET matches GOOGLE_APPS_SCRIPT_SECRET on the Apps Script endpoint.',
        httpStatus: response.status,
        rawResponse: rawText,
      });
    }
  );

  // 2. Sync live Master Google Sheet inside the target Drive folder
  app.post(
    '/api/drive-bridge/sync-master',
    async (req: Request, res: Response) => {
      const env = getBridgeEnv();
      if (!env.configured) {
        res.status(503).json({
          ok: false,
          error:
            'Automatic Drive Folder Bridge is not configured on the server yet. Open Settings to copy and deploy the Apps Script.',
        });
        return;
      }

      const body = (req.body ?? {}) as {
        tasks?: TaskInputRow[];
        masterSheetTitle?: string;
        masterSheetId?: string | null;
      };

      if (!Array.isArray(body.tasks)) {
        res.status(400).json({
          ok: false,
          error: 'Invalid payload: tasks array is required.',
        });
        return;
      }

      const title =
        typeof body.masterSheetTitle === 'string' && body.masterSheetTitle.trim()
          ? body.masterSheetTitle.trim()
          : 'Task Plan and Status — Master';

      try {
        const result = await callAppsScriptBridge(
          env.scriptUrl,
          {
            action: 'syncMaster',
            secret: env.secret,
            folderId: env.folderId,
            title,
            spreadsheetId: body.masterSheetId || '',
            headers: SHEET_HEADERS,
            rows: serializeTasksForSheet(body.tasks),
          },
          {
            action: 'syncMaster',
            endpoint: '/api/drive-bridge/sync-master',
            folderId: env.folderId,
            secret: env.secret,
            fallbackSecret: env.rawSecret,
            rowCount: body.tasks.length,
            spreadsheetTitle: title,
          }
        );

        res.json({
          ok: true,
          spreadsheetId: String(result.spreadsheetId || ''),
          title: String(result.title || title),
          spreadsheetUrl: String(result.spreadsheetUrl || ''),
          syncedAt:
            typeof result.syncedAt === 'string'
              ? result.syncedAt
              : new Date().toISOString(),
          rowCount: body.tasks.length,
        });
      } catch (err) {
        res.status(502).json({
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : 'Failed to sync Master Sheet via Google Apps Script bridge.',
        });
      }
    }
  );

  // 3. Create a standalone formatted Snapshot Google Sheet inside the target Drive folder
  app.post(
    '/api/drive-bridge/snapshot',
    async (req: Request, res: Response) => {
      const env = getBridgeEnv();
      if (!env.configured) {
        res.status(503).json({
          ok: false,
          error:
            'Automatic Drive Folder Bridge is not configured on the server yet. Open Settings to copy and deploy the Apps Script.',
        });
        return;
      }

      const body = (req.body ?? {}) as {
        tasks?: TaskInputRow[];
        title?: string;
      };

      if (!Array.isArray(body.tasks)) {
        res.status(400).json({
          ok: false,
          error: 'Invalid payload: tasks array is required.',
        });
        return;
      }

      const dateStamp = new Date().toISOString().slice(0, 10);
      const title =
        typeof body.title === 'string' && body.title.trim()
          ? body.title.trim()
          : `Task Plan and Status - ${dateStamp}`;

      try {
        const result = await callAppsScriptBridge(
          env.scriptUrl,
          {
            action: 'createSnapshot',
            secret: env.secret,
            folderId: env.folderId,
            title,
            headers: SHEET_HEADERS,
            rows: serializeTasksForSheet(body.tasks),
          },
          {
            action: 'createSnapshot',
            endpoint: '/api/drive-bridge/snapshot',
            folderId: env.folderId,
            secret: env.secret,
            fallbackSecret: env.rawSecret,
            rowCount: body.tasks.length,
            spreadsheetTitle: title,
          }
        );

        res.json({
          ok: true,
          spreadsheetId: String(result.spreadsheetId || ''),
          title: String(result.title || title),
          spreadsheetUrl: String(result.spreadsheetUrl || ''),
          syncedAt:
            typeof result.syncedAt === 'string'
              ? result.syncedAt
              : new Date().toISOString(),
          rowCount: body.tasks.length,
        });
      } catch (err) {
        res.status(502).json({
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : 'Failed to create snapshot Google Sheet via bridge.',
        });
      }
    }
  );

  // 4. Inspect & clear recent Google Apps Script bridge API responses
  app.get('/api/drive-bridge/logs', (_req: Request, res: Response) => {
    res.json({ logs: bridgeApiLogs });
  });

  app.delete('/api/drive-bridge/logs', (_req: Request, res: Response) => {
    bridgeApiLogs.length = 0;
    res.json({ ok: true });
  });

  // 5. Persistent Registered User Accounts store (synced across browsers/sessions)
  app.get('/api/users', (_req: Request, res: Response) => {
    try {
      if (fs.existsSync(USERS_FILE)) {
        const raw = fs.readFileSync(USERS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          res.json({ ok: true, users: parsed });
          return;
        }
      }
    } catch {
      // ignore read errors
    }
    res.json({ ok: true, users: [] });
  });

  app.put('/api/users', (req: Request, res: Response) => {
    const incoming = (req.body ?? {}) as { users?: unknown[] };
    if (!Array.isArray(incoming.users)) {
      res.status(400).json({ ok: false, error: 'users array is required' });
      return;
    }
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(USERS_FILE, JSON.stringify(incoming.users, null, 2), 'utf8');
      res.json({ ok: true, count: incoming.users.length });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to persist users.',
      });
    }
  });

  // Mount Vite middleware in development or serve production dist bundle
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
