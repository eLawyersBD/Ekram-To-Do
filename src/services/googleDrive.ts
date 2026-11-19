import { DRIVE_FOLDER_MIME, type DriveFileItem, type TaskRow } from '../types/task';
import type { AppUser } from '../types/auth';
import { clearAccessToken, getAccessToken } from './googleAuth';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const FILE_FIELDS =
  'id,name,mimeType,webViewLink,modifiedTime,size,iconLink,owners(displayName,emailAddress),parents,appProperties';

export const LEDGER_APP_PROPERTY_KEY = 'elTaskLedger';
export const LEDGER_APP_PROPERTY_VALUE = 'v1';

export class DriveAuthError extends Error {
  constructor(message = 'Your Google Drive session has expired. Please sign in again.') {
    super(message);
    this.name = 'DriveAuthError';
  }
}

async function requireToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) {
    throw new DriveAuthError('Please sign in with Google to access Google Drive.');
  }
  return token;
}

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await requireToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(url, { ...init, headers });

  if (response.status === 401) {
    clearAccessToken();
    throw new DriveAuthError();
  }

  if (!response.ok) {
    let message = `Google Drive request failed (${response.status})`;
    try {
      const errorBody = await response.json();
      if (errorBody?.error?.message) {
        message = errorBody.error.message;
      }
    } catch {
      // keep default status message
    }
    throw new Error(message);
  }

  return response;
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export type DriveFilterType = 'all' | 'folders' | 'documents' | 'pdfs' | 'ledgers';

export async function listDriveFiles(options: {
  searchQuery?: string;
  folderId?: string;
  filterType?: DriveFilterType;
  pageSize?: number;
} = {}): Promise<DriveFileItem[]> {
  const { searchQuery = '', folderId, filterType = 'all', pageSize = 50 } = options;

  const queryParts: string[] = ['trashed = false'];

  if (folderId) {
    queryParts.push(`'${escapeDriveQuery(folderId)}' in parents`);
  }

  if (searchQuery.trim()) {
    queryParts.push(`name contains '${escapeDriveQuery(searchQuery.trim())}'`);
  }

  if (filterType === 'folders') {
    queryParts.push(`mimeType = '${DRIVE_FOLDER_MIME}'`);
  } else if (filterType === 'documents') {
    queryParts.push(
      `(mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.google-apps.presentation' or mimeType contains 'officedocument')`
    );
  } else if (filterType === 'pdfs') {
    queryParts.push(`mimeType = 'application/pdf'`);
  } else if (filterType === 'ledgers') {
    queryParts.push(
      `appProperties has { key='${LEDGER_APP_PROPERTY_KEY}' and value='${LEDGER_APP_PROPERTY_VALUE}' }`
    );
  }

  const params = new URLSearchParams({
    q: queryParts.join(' and '),
    fields: `files(${FILE_FIELDS})`,
    orderBy: 'folder,modifiedTime desc',
    pageSize: String(pageSize),
  });

  const res = await driveFetch(`${DRIVE_API_BASE}/files?${params.toString()}`);
  const data = await res.json();
  return (data.files ?? []) as DriveFileItem[];
}

export async function createDriveFolder(
  folderName: string,
  parentFolderId?: string
): Promise<DriveFileItem> {
  const metadata: Record<string, unknown> = {
    name: folderName.trim(),
    mimeType: DRIVE_FOLDER_MIME,
    appProperties: {
      createdByApp: 'elTaskPlan',
    },
  };

  if (parentFolderId) {
    metadata.parents = [parentFolderId];
  }

  const res = await driveFetch(
    `${DRIVE_API_BASE}/files?fields=${encodeURIComponent(FILE_FIELDS)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    }
  );

  return (await res.json()) as DriveFileItem;
}

export async function uploadFileToDrive(
  file: File,
  parentFolderId?: string
): Promise<DriveFileItem> {
  const metadata: Record<string, unknown> = {
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    appProperties: {
      createdByApp: 'elTaskPlan',
    },
  };

  if (parentFolderId) {
    metadata.parents = [parentFolderId];
  }

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', file);

  const res = await driveFetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=${encodeURIComponent(FILE_FIELDS)}`,
    {
      method: 'POST',
      body: form,
    }
  );

  return (await res.json()) as DriveFileItem;
}

export interface LedgerDrivePayload {
  version: number;
  exportedAt: string;
  currencySymbol: string;
  tasks: TaskRow[];
  users?: AppUser[];
}

export async function saveLedgerToDrive(options: {
  tasks: TaskRow[];
  currencySymbol: string;
  users?: AppUser[];
  fileName?: string;
  existingFileId?: string;
}): Promise<DriveFileItem> {
  const {
    tasks,
    currencySymbol,
    users,
    fileName = 'Task_Plan_and_Status_Ledger.json',
    existingFileId,
  } = options;

  const payload: LedgerDrivePayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    currencySymbol,
    tasks,
    users,
  };

  const jsonBlob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });

  if (existingFileId) {
    const res = await driveFetch(
      `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(existingFileId)}?uploadType=media&fields=${encodeURIComponent(FILE_FIELDS)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: jsonBlob,
      }
    );
    return (await res.json()) as DriveFileItem;
  }

  const metadata = {
    name: fileName,
    mimeType: 'application/json',
    appProperties: {
      [LEDGER_APP_PROPERTY_KEY]: LEDGER_APP_PROPERTY_VALUE,
      createdByApp: 'elTaskPlan',
    },
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', jsonBlob);

  const res = await driveFetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=${encodeURIComponent(FILE_FIELDS)}`,
    {
      method: 'POST',
      body: form,
    }
  );

  return (await res.json()) as DriveFileItem;
}

export async function loadLedgerFromDrive(fileId: string): Promise<LedgerDrivePayload> {
  const res = await driveFetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`
  );
  const data = await res.json();
  if (!data || !Array.isArray(data.tasks)) {
    throw new Error('The selected Drive file is not a valid Task Plan ledger backup.');
  }
  return data as LedgerDrivePayload;
}

export async function exportCsvToDrive(
  csvContent: string,
  fileName: string
): Promise<DriveFileItem> {
  const metadata = {
    name: fileName,
    mimeType: 'text/csv',
    appProperties: {
      createdByApp: 'elTaskPlan',
    },
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', new Blob([csvContent], { type: 'text/csv;charset=utf-8' }));

  const res = await driveFetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=${encodeURIComponent(FILE_FIELDS)}`,
    {
      method: 'POST',
      body: form,
    }
  );

  return (await res.json()) as DriveFileItem;
}

export async function deleteDriveFile(fileId: string): Promise<void> {
  await driveFetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
  });
}

export function formatFileSize(sizeStr?: string): string {
  if (!sizeStr) return '—';
  const bytes = Number.parseInt(sizeStr, 10);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function getFriendlyMimeLabel(mimeType: string): string {
  if (mimeType === DRIVE_FOLDER_MIME) return 'Folder';
  if (mimeType === 'application/vnd.google-apps.document') return 'Google Doc';
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'Google Sheet';
  if (mimeType === 'application/vnd.google-apps.presentation') return 'Google Slides';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType === 'text/csv') return 'CSV';
  if (mimeType === 'application/json') return 'JSON Ledger';
  if (mimeType.startsWith('image/')) return 'Image';
  if (mimeType.includes('wordprocessingml')) return 'Word Doc';
  if (mimeType.includes('spreadsheetml')) return 'Excel';
  return 'File';
}
