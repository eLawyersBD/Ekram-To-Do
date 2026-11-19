import type { TaskRow } from '../types/task';

const CSV_HEADERS = [
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

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildTaskLedgerCsv(tasks: TaskRow[]): string {
  const headerLine = CSV_HEADERS.map(escapeCsvCell).join(',');
  const dataLines = tasks.map((row, idx) => {
    const cells = [
      String(idx + 1).padStart(2, '0'),
      row.elInvoiceId,
      row.clientName,
      row.companyName,
      row.taskName,
      row.taskBy,
      row.taskStatus,
      row.dueDate || '',
      row.taskPrice,
      row.paidReceiveAmount,
      row.noteForPaidReceive,
      row.driveLink,
      row.assignedUser && row.actionToDo
        ? `${row.assignedUser} - ${row.actionToDo}`
        : row.assignedUser || row.actionToDo,
    ];
    return cells.map((cell) => escapeCsvCell(cell ?? '')).join(',');
  });

  return [headerLine, ...dataLines].join('\r\n');
}

export function downloadCsvFile(csvContent: string, fileName: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
