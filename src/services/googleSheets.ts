import {
  TASK_STATUS_OPTIONS,
  createEmptyTaskRow,
  type DriveFileItem,
  type TaskRow,
  type TaskStatus,
} from '../types/task';
import { clearAccessToken, getAccessToken } from './googleAuth';
import { DriveAuthError } from './googleDrive';

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

export const DEFAULT_TARGET_DRIVE_FOLDER_ID =
  '1OjfZm2kE5F9yGnmdFIv8WZpuAPpu9VpG';
export const DEFAULT_TARGET_DRIVE_FOLDER_URL =
  'https://drive.google.com/drive/folders/1OjfZm2kE5F9yGnmdFIv8WZpuAPpu9VpG';

export const SHEET_HEADERS = [
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

export interface SheetTabInfo {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
}

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  sheets: SheetTabInfo[];
}

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) {
    throw new DriveAuthError('Please sign in with Google to access Google Sheets.');
  }
  return token;
}

async function sheetsFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await requireToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(url, { ...init, headers });

  if (response.status === 401) {
    clearAccessToken();
    throw new DriveAuthError(
      'Your Google session expired or needs updated Google Sheets permissions. Please sign in again.'
    );
  }

  if (response.status === 403) {
    let message =
      'Permission denied for Google Sheets. Sign out and sign in with Google again to grant Sheets access.';
    try {
      const errBody = await response.json();
      if (errBody?.error?.message) {
        message = errBody.error.message;
      }
    } catch {
      // keep default message
    }
    throw new Error(message);
  }

  if (!response.ok) {
    let message = `Google Sheets request failed (${response.status})`;
    try {
      const errBody = await response.json();
      if (errBody?.error?.message) {
        message = errBody.error.message;
      }
    } catch {
      // keep default
    }
    throw new Error(message);
  }

  return response;
}

export function extractSpreadsheetIdFromInput(input: string): string {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }
  return trimmed;
}

function escapeSheetTitleForRange(sheetTitle: string): string {
  const escaped = sheetTitle.replace(/'/g, "''");
  return `'${escaped}'`;
}

export async function listGoogleSpreadsheets(
  searchQuery = ''
): Promise<DriveFileItem[]> {
  const queryParts = [
    `mimeType = 'application/vnd.google-apps.spreadsheet'`,
    'trashed = false',
  ];
  if (searchQuery.trim()) {
    const escaped = searchQuery.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    queryParts.push(`name contains '${escaped}'`);
  }

  const params = new URLSearchParams({
    q: queryParts.join(' and '),
    fields:
      'files(id,name,mimeType,webViewLink,modifiedTime,owners(displayName,emailAddress))',
    orderBy: 'modifiedTime desc',
    pageSize: '40',
  });

  const res = await sheetsFetch(`${DRIVE_API_BASE}/files?${params.toString()}`);
  const data = await res.json();
  return (data.files ?? []) as DriveFileItem[];
}

export async function getSpreadsheetMetadata(
  spreadsheetId: string
): Promise<SpreadsheetMetadata> {
  const fields =
    'spreadsheetId,spreadsheetUrl,properties.title,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))';
  const res = await sheetsFetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(fields)}`
  );
  const data = await res.json();
  const sheets: SheetTabInfo[] = Array.isArray(data.sheets)
    ? data.sheets.map(
        (s: {
          properties?: {
            sheetId?: number;
            title?: string;
            gridProperties?: { rowCount?: number; columnCount?: number };
          };
        }) => ({
          sheetId: s.properties?.sheetId ?? 0,
          title: s.properties?.title ?? 'Sheet1',
          rowCount: s.properties?.gridProperties?.rowCount ?? 1000,
          columnCount: s.properties?.gridProperties?.columnCount ?? 26,
        })
      )
    : [];

  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title ?? 'Untitled Spreadsheet',
    spreadsheetUrl:
      data.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
    sheets,
  };
}

export async function readSheetValues(
  spreadsheetId: string,
  sheetTitle: string,
  cellRange = 'A1:Z200'
): Promise<string[][]> {
  const fullRange = `${escapeSheetTitleForRange(sheetTitle)}!${cellRange}`;
  const res = await sheetsFetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(fullRange)}`
  );
  const data = await res.json();
  return Array.isArray(data.values) ? (data.values as string[][]) : [];
}

export function tasksToSheetMatrix(tasks: TaskRow[]): string[][] {
  const rows = tasks.map((row, idx) => [
    String(idx + 1).padStart(2, '0'),
    row.elInvoiceId || '',
    row.clientName || '',
    row.companyName || '',
    row.taskName || '',
    row.taskBy || '',
    row.taskStatus || '',
    row.dueDate || '',
    row.taskPrice || '',
    row.paidReceiveAmount || '',
    row.noteForPaidReceive || '',
    row.driveLink || '',
    row.assignedUser || row.actionToDo || '',
  ]);
  return [SHEET_HEADERS, ...rows];
}

async function applyHeaderStyling(
  spreadsheetId: string,
  sheetId: number
): Promise<void> {
  const requests = [
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            frozenRowCount: 1,
          },
        },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: SHEET_HEADERS.length,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: {
              red: 230 / 255,
              green: 240 / 255,
              blue: 250 / 255,
            },
            textFormat: {
              bold: true,
              foregroundColor: {
                red: 26 / 255,
                green: 54 / 255,
                blue: 93 / 255,
              },
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    },
  ];

  await sheetsFetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    }
  );
}

export async function createTaskSpreadsheet(
  title: string,
  tasks: TaskRow[],
  parentFolderId?: string
): Promise<SpreadsheetMetadata> {
  const safeTitle = title.trim() || 'Task Plan and Status';
  const targetTabTitle = 'Task Plan';
  let spreadsheetId: string;
  let sheetId: number;
  let actualTabTitle: string;
  let spreadsheetUrl: string;
  let rowCount = 1000;
  let columnCount = 26;

  if (parentFolderId && parentFolderId.trim()) {
    // Create the spreadsheet directly inside the target Google Drive folder
    const driveCreateRes = await sheetsFetch(
      `${DRIVE_API_BASE}/files?supportsAllDrives=true&fields=${encodeURIComponent(
        'id,name,webViewLink'
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: safeTitle,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          parents: [parentFolderId.trim()],
        }),
      }
    );
    const driveFile = await driveCreateRes.json();
    spreadsheetId = driveFile.id;
    spreadsheetUrl =
      driveFile.webViewLink ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    // Inspect actual sheet metadata (never hardcode "Sheet1")
    const meta = await getSpreadsheetMetadata(spreadsheetId);
    const firstTab = meta.sheets[0];
    sheetId = firstTab?.sheetId ?? 0;
    actualTabTitle = firstTab?.title ?? targetTabTitle;
    rowCount = firstTab?.rowCount ?? 1000;
    columnCount = firstTab?.columnCount ?? 26;

    // Rename the initial tab to "Task Plan" when different
    if (actualTabTitle !== targetTabTitle) {
      await sheetsFetch(
        `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [
              {
                updateSheetProperties: {
                  properties: {
                    sheetId,
                    title: targetTabTitle,
                  },
                  fields: 'title',
                },
              },
            ],
          }),
        }
      );
      actualTabTitle = targetTabTitle;
    }
  } else {
    const createRes = await sheetsFetch(SHEETS_API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        properties: { title: safeTitle },
        sheets: [{ properties: { title: targetTabTitle } }],
      }),
    });

    const created = await createRes.json();
    spreadsheetId = created.spreadsheetId;
    const firstSheet = created.sheets?.[0]?.properties;
    sheetId = firstSheet?.sheetId ?? 0;
    actualTabTitle = firstSheet?.title ?? targetTabTitle;
    rowCount = firstSheet?.gridProperties?.rowCount ?? 1000;
    columnCount = firstSheet?.gridProperties?.columnCount ?? 26;
    spreadsheetUrl =
      created.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  }

  const matrix = tasksToSheetMatrix(tasks);
  const range = `${escapeSheetTitleForRange(actualTabTitle)}!A1`;

  await sheetsFetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: matrix }),
    }
  );

  await applyHeaderStyling(spreadsheetId, sheetId);

  return {
    spreadsheetId,
    title: safeTitle,
    spreadsheetUrl,
    sheets: [
      {
        sheetId,
        title: actualTabTitle,
        rowCount,
        columnCount,
      },
    ],
  };
}

export async function overwriteSheetWithTasks(options: {
  spreadsheetId: string;
  sheetTitle: string;
  sheetId: number;
  tasks: TaskRow[];
}): Promise<void> {
  const { spreadsheetId, sheetTitle, sheetId, tasks } = options;
  const clearRange = `${escapeSheetTitleForRange(sheetTitle)}!A1:Z`;

  await sheetsFetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(clearRange)}:clear`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  );

  const matrix = tasksToSheetMatrix(tasks);
  const writeRange = `${escapeSheetTitleForRange(sheetTitle)}!A1`;

  await sheetsFetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(writeRange)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: matrix }),
    }
  );

  await applyHeaderStyling(spreadsheetId, sheetId);
}

export async function appendTasksToSheet(options: {
  spreadsheetId: string;
  sheetTitle: string;
  tasks: TaskRow[];
}): Promise<void> {
  const { spreadsheetId, sheetTitle, tasks } = options;
  const dataRows = tasksToSheetMatrix(tasks).slice(1);
  if (dataRows.length === 0) return;

  const appendRange = `${escapeSheetTitleForRange(sheetTitle)}!A1`;
  await sheetsFetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: dataRows }),
    }
  );
}

function normalizeStatusValue(raw: string): TaskStatus {
  const cleaned = raw.trim().toLowerCase();
  const matched = TASK_STATUS_OPTIONS.find(
    (opt) => opt.toLowerCase() === cleaned
  );
  return matched ?? '';
}

function normalizeHeaderKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Converts a 2D Google Sheets value matrix into TaskRow[] by matching column
 * headers flexibly (or falling back to standard column order if no header row matches).
 */
export function parseSheetValuesToTasks(values: string[][]): TaskRow[] {
  if (values.length === 0) return [];

  const firstRow = values[0].map((cell) => normalizeHeaderKey(String(cell ?? '')));
  const looksLikeHeader = firstRow.some((key) =>
    [
      'elinvoiceid',
      'invoiceid',
      'clientname',
      'companyname',
      'taskname',
      'taskstatus',
      'taskprice',
      'drivelink',
    ].includes(key)
  );

  const findColumnIndex = (aliases: string[], fallbackIndex: number): number => {
    if (!looksLikeHeader) return fallbackIndex;
    for (const alias of aliases) {
      const idx = firstRow.findIndex((k) => k === alias || k.includes(alias));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const idxInvoice = findColumnIndex(['elinvoiceid', 'invoiceid', 'invoice'], 1);
  const idxClient = findColumnIndex(['clientname', 'client'], 2);
  const idxCompany = findColumnIndex(['companyname', 'company'], 3);
  const idxTaskName = findColumnIndex(['taskname', 'task'], 4);
  const idxTaskBy = findColumnIndex(['taskby', 'assignee'], 5);
  const idxStatus = findColumnIndex(['taskstatus', 'status'], 6);
  const idxDueDate = findColumnIndex(['duedate', 'deadline'], 7);
  const idxPrice = findColumnIndex(['taskprice', 'price', 'amount'], 8);
  const idxPaid = findColumnIndex(['paidreceiveamount', 'paidamount', 'paid', 'received'], 9);
  const idxNote = findColumnIndex(['noteforpaidreceive', 'paymentnote', 'note'], 10);
  const idxDrive = findColumnIndex(['drivelink', 'drive', 'link'], 11);
  const idxAction = findColumnIndex(['actiontodo', 'action', 'assigneduser', 'user'], 12);

  const dataRows = looksLikeHeader ? values.slice(1) : values;

  const getCell = (row: string[], idx: number): string => {
    if (idx < 0 || idx >= row.length) return '';
    return String(row[idx] ?? '').trim();
  };

  return dataRows
    .map((rawRow) => {
      const row = createEmptyTaskRow();
      row.elInvoiceId = getCell(rawRow, idxInvoice);
      row.clientName = getCell(rawRow, idxClient);
      row.companyName = getCell(rawRow, idxCompany);
      row.taskName = getCell(rawRow, idxTaskName);
      row.taskBy = getCell(rawRow, idxTaskBy);
      row.taskStatus = normalizeStatusValue(getCell(rawRow, idxStatus));
      row.dueDate = getCell(rawRow, idxDueDate);
      row.taskPrice = getCell(rawRow, idxPrice);
      row.paidReceiveAmount = getCell(rawRow, idxPaid);
      row.noteForPaidReceive = getCell(rawRow, idxNote);
      row.driveLink = getCell(rawRow, idxDrive);
      const actionCell = getCell(rawRow, idxAction);
      if (actionCell && !/\s/.test(actionCell)) {
        row.assignedUser = actionCell.replace(/^@/, '');
      } else {
        row.actionToDo = actionCell;
      }
      return row;
    })
    .filter((r) =>
      Boolean(
        r.elInvoiceId ||
          r.clientName ||
          r.companyName ||
          r.taskName ||
          r.taskBy ||
          r.taskStatus ||
          r.dueDate ||
          r.taskPrice ||
          r.paidReceiveAmount ||
          r.noteForPaidReceive ||
          r.driveLink ||
          r.assignedUser ||
          r.actionToDo
      )
    );
}
