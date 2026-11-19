import React from 'react';
import {
  Archive,
  ArrowLeft,
  Maximize2,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  ARCHIVE_AFTER_DAYS,
  formatAmount,
  getDaysSinceCompleted,
  parseCurrencyValue,
  type TaskRow,
} from '../types/task';

interface ArchiveTasksViewProps {
  rows: Array<{ task: TaskRow; slNo: number }>;
  currencySymbol: string;
  onRestoreTask: (task: TaskRow) => void;
  onRestoreAll: () => void;
  onOpenDetailDrawer: (task: TaskRow, slNo: number) => void;
  onDeleteRow: (task: TaskRow, slNo: number) => void;
  onBackToActive: () => void;
}

function formatShortDate(iso?: string): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export const ArchiveTasksView: React.FC<ArchiveTasksViewProps> = ({
  rows,
  currencySymbol,
  onRestoreTask,
  onRestoreAll,
  onOpenDetailDrawer,
  onDeleteRow,
  onBackToActive,
}) => {
  const totalArchivedPrice = rows.reduce(
    (sum, item) => sum + parseCurrencyValue(item.task.taskPrice),
    0
  );
  const totalArchivedPaid = rows.reduce(
    (sum, item) => sum + parseCurrencyValue(item.task.paidReceiveAmount),
    0
  );

  return (
    <div className="space-y-4">
      {/* Archive Banner */}
      <div className="flex flex-col gap-3 rounded-md border border-[#8FA6C1] bg-[#F4F8FD] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5">
          <Archive
            className="mt-0.5 h-4 w-4 shrink-0 text-[#1A365D]"
            aria-hidden="true"
          />
          <div>
            <p className="text-xs font-semibold text-[#1A365D]">
              Archived Tasks ({rows.length})
            </p>
            <p className="mt-0.5 text-xs text-slate-600">
              Completed tasks older than {ARCHIVE_AFTER_DAYS} days are
              automatically moved here and hidden from the active ledger. You
              can inspect or restore any task at any time.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {rows.length > 0 && (
            <button
              type="button"
              onClick={onRestoreAll}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#1A365D]/30 bg-white px-3 py-1.5 text-xs font-medium text-[#1A365D] transition-colors hover:bg-[#E6F0FA] whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Restore All
            </button>
          )}
          <button
            type="button"
            onClick={onBackToActive}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[#1A365D] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#132948] whitespace-nowrap"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to Active Tasks
          </button>
        </div>
      </div>

      {/* Archived Rows Table */}
      <div className="ledger-scroll overflow-x-auto rounded-md border border-[#8FA6C1] bg-white">
        <table className="w-full min-w-[1040px] border-collapse text-[13.5px]">
          <thead>
            <tr className="bg-[#E6F0FA] text-left text-slate-950">
              <th className="w-[125px] border-b border-r border-[#8FA6C1] px-3 py-2.5 text-xs font-bold whitespace-nowrap">
                EL Invoice ID
              </th>
              <th className="w-[190px] border-b border-r border-[#8FA6C1] px-3 py-2.5 text-xs font-bold whitespace-nowrap">
                Client / Company
              </th>
              <th className="border-b border-r border-[#8FA6C1] px-3 py-2.5 text-xs font-bold whitespace-nowrap">
                Task Name
              </th>
              <th className="w-[115px] border-b border-r border-[#8FA6C1] px-3 py-2.5 text-xs font-bold whitespace-nowrap">
                Due Date
              </th>
              <th className="w-[155px] border-b border-r border-[#8FA6C1] px-3 py-2.5 text-xs font-bold whitespace-nowrap">
                Archived
              </th>
              <th className="w-[120px] border-b border-r border-[#8FA6C1] px-3 py-2.5 text-right text-xs font-bold whitespace-nowrap">
                Task Price
              </th>
              <th className="w-[120px] border-b border-r border-[#8FA6C1] px-3 py-2.5 text-xs font-bold whitespace-nowrap">
                Tagged User
              </th>
              <th className="w-[190px] border-b border-[#8FA6C1] px-3 py-2.5 text-right text-xs font-bold whitespace-nowrap">
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-6 py-12 text-center text-sm text-slate-600"
                >
                  No archived tasks yet. Completed tasks older than{' '}
                  {ARCHIVE_AFTER_DAYS} days will appear here automatically.
                </td>
              </tr>
            ) : (
              rows.map(({ task, slNo }) => {
                const daysCompleted = getDaysSinceCompleted(task);
                return (
                  <tr
                    key={task.id}
                    className="bg-white transition-colors hover:bg-[#F7FAFE]"
                  >
                    <td className="border-b border-r border-[#8FA6C1]/70 px-3 py-2.5 font-mono text-xs text-slate-800 whitespace-nowrap">
                      {task.elInvoiceId || '—'}
                    </td>
                    <td className="border-b border-r border-[#8FA6C1]/70 px-3 py-2.5 text-xs">
                      <p className="font-medium text-slate-900">
                        {task.clientName || '—'}
                      </p>
                      {task.companyName && (
                        <p className="text-slate-500">{task.companyName}</p>
                      )}
                    </td>
                    <td className="border-b border-r border-[#8FA6C1]/70 px-3 py-2.5">
                      <p className="font-medium text-slate-900">
                        {task.taskName || 'Untitled Task'}
                      </p>
                      {task.taskBy && (
                        <p className="text-xs text-slate-500">
                          By {task.taskBy}
                        </p>
                      )}
                    </td>
                    <td className="border-b border-r border-[#8FA6C1]/70 px-3 py-2.5 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                      {task.dueDate || '—'}
                    </td>
                    <td className="border-b border-r border-[#8FA6C1]/70 px-3 py-2.5 text-xs text-slate-600">
                      <p className="font-medium text-slate-800">
                        {formatShortDate(task.archivedAt)}
                      </p>
                      {daysCompleted !== null && (
                        <p className="text-[11px] text-slate-500">
                          Completed {daysCompleted}d ago
                        </p>
                      )}
                    </td>
                    <td className="border-b border-r border-[#8FA6C1]/70 px-3 py-2.5 text-right font-mono text-xs text-slate-900 tabular-nums whitespace-nowrap">
                      {task.taskPrice
                        ? formatAmount(
                            parseCurrencyValue(task.taskPrice),
                            currencySymbol
                          )
                        : '—'}
                    </td>
                    <td className="border-b border-r border-[#8FA6C1]/70 px-3 py-2.5 font-mono text-xs text-[#1A365D] whitespace-nowrap">
                      {task.assignedUser || '—'}
                    </td>
                    <td className="border-b border-[#8FA6C1]/70 px-3 py-2 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onRestoreTask(task)}
                          className="inline-flex cursor-pointer items-center gap-1 rounded border border-[#1A365D]/30 bg-[#E6F0FA]/70 px-2.5 py-1 text-xs font-medium text-[#1A365D] transition-colors hover:bg-[#E6F0FA]"
                        >
                          <RotateCcw className="h-3 w-3" aria-hidden="true" />
                          Restore
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenDetailDrawer(task, slNo)}
                          title="Inspect task details"
                          aria-label={`Inspect archived task ${task.taskName || slNo}`}
                          className="cursor-pointer rounded border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#1A365D]"
                        >
                          <Maximize2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteRow(task, slNo)}
                          title="Delete archived task permanently"
                          aria-label={`Delete archived task ${task.taskName || slNo}`}
                          className="cursor-pointer rounded border border-slate-200 bg-white p-1.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 font-medium text-slate-900">
                <td
                  colSpan={5}
                  className="border-r border-[#8FA6C1] px-3 py-2.5 text-xs text-slate-600"
                >
                  Showing{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    {rows.length}
                  </span>{' '}
                  archived {rows.length === 1 ? 'task' : 'tasks'} · Total Paid:{' '}
                  <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                    {formatAmount(totalArchivedPaid, currencySymbol)}
                  </span>
                </td>
                <td className="border-r border-[#8FA6C1] px-3 py-2.5 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                  {formatAmount(totalArchivedPrice, currencySymbol)}
                </td>
                <td
                  colSpan={2}
                  className="px-3 py-2.5 text-right text-xs text-slate-500"
                >
                  Restored tasks return to your active ledger
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};
