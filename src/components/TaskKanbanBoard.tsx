import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  ExternalLink,
  FolderPlus,
  GripVertical,
  MessageSquare,
  Plus,
} from 'lucide-react';
import {
  formatAmount,
  getDaysOverdue,
  getDueDateState,
  isRowPopulated,
  parseCurrencyValue,
  type TaskRow,
  type TaskStatus,
} from '../types/task';

interface TaskKanbanBoardProps {
  rows: Array<{ task: TaskRow; slNo: number }>;
  currencySymbol: string;
  onMoveTaskStatus: (taskId: string, nextStatus: TaskStatus) => void;
  onOpenDetailDrawer: (task: TaskRow, slNo: number) => void;
  onOpenDrivePicker: (task: TaskRow, slNo: number) => void;
  onAddTaskInStatus: (status: TaskStatus) => void;
}

interface KanbanColumnConfig {
  status: Exclude<TaskStatus, ''>;
  label: string;
  headerTextClass: string;
  accentBarClass: string;
  badgeClass: string;
}

const KANBAN_COLUMNS: KanbanColumnConfig[] = [
  {
    status: 'Not Started',
    label: 'Not Started',
    headerTextClass: 'text-slate-700',
    accentBarClass: 'bg-slate-400',
    badgeClass: 'bg-slate-200/80 text-slate-700',
  },
  {
    status: 'In Progress',
    label: 'In Progress',
    headerTextClass: 'text-[#1A365D]',
    accentBarClass: 'bg-[#1A365D]',
    badgeClass: 'bg-blue-100 text-[#1A365D]',
  },
  {
    status: 'Under Review',
    label: 'Under Review',
    headerTextClass: 'text-amber-800',
    accentBarClass: 'bg-amber-500',
    badgeClass: 'bg-amber-100 text-amber-800',
  },
  {
    status: 'On Hold',
    label: 'On Hold',
    headerTextClass: 'text-rose-800',
    accentBarClass: 'bg-rose-500',
    badgeClass: 'bg-rose-100 text-rose-800',
  },
  {
    status: 'Completed',
    label: 'Completed',
    headerTextClass: 'text-emerald-800',
    accentBarClass: 'bg-emerald-600',
    badgeClass: 'bg-emerald-100 text-emerald-800',
  },
];

export const TaskKanbanBoard: React.FC<TaskKanbanBoardProps> = ({
  rows,
  currencySymbol,
  onMoveTaskStatus,
  onOpenDetailDrawer,
  onOpenDrivePicker,
  onAddTaskInStatus,
}) => {
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);

  const populatedRows = useMemo(
    () => rows.filter(({ task }) => isRowPopulated(task)),
    [rows]
  );

  const groupedByColumn = useMemo(() => {
    const map = new Map<Exclude<TaskStatus, ''>, Array<{ task: TaskRow; slNo: number }>>();
    for (const col of KANBAN_COLUMNS) {
      map.set(col.status, []);
    }

    for (const entry of populatedRows) {
      const normalizedStatus: Exclude<TaskStatus, ''> =
        entry.task.taskStatus || 'Not Started';
      const bucket = map.get(normalizedStatus) ?? map.get('Not Started')!;
      bucket.push(entry);
    }

    return map;
  }, [populatedRows]);

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    taskId: string
  ) => {
    setDraggingTaskId(taskId);
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggingTaskId(null);
    setDragOverColumn(null);
  };

  const handleColumnDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    status: Exclude<TaskStatus, ''>
  ) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumn !== status) {
      setDragOverColumn(status);
    }
  };

  const handleColumnDragLeave = (
    e: React.DragEvent<HTMLDivElement>,
    status: Exclude<TaskStatus, ''>
  ) => {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    if (dragOverColumn === status) {
      setDragOverColumn(null);
    }
  };

  const handleColumnDrop = (
    e: React.DragEvent<HTMLDivElement>,
    targetStatus: Exclude<TaskStatus, ''>
  ) => {
    e.preventDefault();
    const droppedId = e.dataTransfer.getData('text/plain') || draggingTaskId;
    setDraggingTaskId(null);
    setDragOverColumn(null);

    if (!droppedId) return;
    const found = populatedRows.find((r) => r.task.id === droppedId);
    if (!found) return;

    const currentEffectiveStatus: Exclude<TaskStatus, ''> =
      found.task.taskStatus || 'Not Started';
    if (
      currentEffectiveStatus !== targetStatus ||
      found.task.taskStatus !== targetStatus
    ) {
      onMoveTaskStatus(droppedId, targetStatus);
    }
  };

  return (
    <div className="space-y-4">
      {populatedRows.length === 0 && (
        <div className="flex flex-col items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50/70 px-5 py-4 sm:flex-row">
          <p className="text-xs text-slate-600">
            No populated tasks match the current view. Add a task in any column or fill
            out rows in Table view to organize them on the board.
          </p>
          <button
            type="button"
            onClick={() => onAddTaskInStatus('Not Started')}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[#1A365D] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#132948] whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            Add First Task
          </button>
        </div>
      )}

      <div className="ledger-scroll overflow-x-auto pb-2">
        <div className="grid min-w-[1260px] grid-cols-5 gap-4">
          {KANBAN_COLUMNS.map((col) => {
            const items = groupedByColumn.get(col.status) ?? [];
            const columnTotal = items.reduce(
              (sum, item) => sum + parseCurrencyValue(item.task.taskPrice),
              0
            );
            const isDropTarget = dragOverColumn === col.status;

            return (
              <div
                key={col.status}
                onDragOver={(e) => handleColumnDragOver(e, col.status)}
                onDragLeave={(e) => handleColumnDragLeave(e, col.status)}
                onDrop={(e) => handleColumnDrop(e, col.status)}
                className={`relative flex min-h-[460px] flex-col overflow-hidden rounded-xl border transition-all ${
                  isDropTarget
                    ? 'border-[#1A365D] bg-[#E6F0FA]/50 shadow-sm'
                    : 'border-slate-200/90 bg-slate-50/80'
                }`}
              >
                <div className={`h-1 w-full ${col.accentBarClass}`} />
                {/* Column Header */}
                <div className="flex items-start justify-between gap-2 border-b border-slate-200/80 bg-white/90 px-3.5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2
                        className={`text-xs font-bold tracking-tight whitespace-nowrap ${col.headerTextClass}`}
                      >
                        {col.label}
                      </h2>
                      <span
                        className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${col.badgeClass}`}
                      >
                        {items.length}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-[11px] font-medium text-slate-500 tabular-nums">
                      {formatAmount(columnTotal, currencySymbol)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAddTaskInStatus(col.status)}
                    title={`Add task in ${col.label}`}
                    aria-label={`Add task in ${col.label}`}
                    className="cursor-pointer rounded-lg p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#1A365D]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Cards List */}
                <div className="flex-1 space-y-2.5 p-3">
                  {items.length === 0 ? (
                    <div
                      className={`flex h-24 items-center justify-center rounded-md border border-dashed text-xs transition-colors ${
                        isDropTarget
                          ? 'border-[#1A365D] bg-white/70 text-[#1A365D] font-medium'
                          : 'border-slate-300/80 text-slate-400'
                      }`}
                    >
                      {isDropTarget ? `Move to ${col.label}` : 'Drop a task here'}
                    </div>
                  ) : (
                    items.map(({ task, slNo }) => {
                      const priceNum = parseCurrencyValue(task.taskPrice);
                      const paidNum = parseCurrencyValue(task.paidReceiveAmount);
                      const dueNum = Math.max(0, priceNum - paidNum);
                      const dueState = getDueDateState(task.dueDate, task.taskStatus);
                      const isOverdue = dueState === 'overdue';
                      const isDueToday = dueState === 'due-today';
                      const daysLate = isOverdue ? getDaysOverdue(task.dueDate) : 0;
                      const isDragging = draggingTaskId === task.id;

                      return (
                        <div
                          key={task.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, task.id)}
                          onDragEnd={handleDragEnd}
                          onClick={() => onOpenDetailDrawer(task, slNo)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onOpenDetailDrawer(task, slNo);
                            }
                          }}
                          className={`group cursor-grab active:cursor-grabbing rounded-xl border bg-white p-3.5 shadow-2xs transition-all hover:-translate-y-0.5 hover:border-[#8FA6C1] hover:shadow-md focus-visible:outline-2 focus-visible:outline-[#1A365D] ${
                            isDragging
                              ? 'opacity-45 border-[#1A365D]'
                              : isOverdue
                                ? 'border-red-200 bg-red-50/20'
                                : 'border-slate-200/90'
                          }`}
                        >
                          {/* Top Metadata Kicker */}
                          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                            <span className="truncate font-mono tabular-nums">
                              SL {String(slNo).padStart(2, '0')}
                              {task.elInvoiceId ? ` · ${task.elInvoiceId}` : ''}
                            </span>
                            <GripVertical
                              className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-500"
                              aria-hidden="true"
                            />
                          </div>

                          {/* Primary Title */}
                          <h3 className="mt-1.5 text-sm font-semibold leading-snug text-slate-900">
                            {task.taskName.trim() || 'Untitled Task'}
                          </h3>

                          {/* Client & Company Line */}
                          {(task.clientName.trim() || task.companyName.trim()) && (
                            <p className="mt-1 truncate text-xs text-slate-600">
                              {[task.clientName.trim(), task.companyName.trim()]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          )}

                          {/* Due Date Line */}
                          {task.dueDate && (
                            <div className="mt-2.5 flex items-center justify-between gap-2 text-xs">
                              <span
                                className={`inline-flex items-center gap-1 font-mono tabular-nums ${
                                  isOverdue
                                    ? 'font-semibold text-red-700'
                                    : isDueToday
                                      ? 'font-semibold text-amber-700'
                                      : 'text-slate-600'
                                }`}
                              >
                                <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
                                {task.dueDate}
                              </span>
                              {isOverdue && (
                                <span
                                  title={`Overdue by ${daysLate} ${
                                    daysLate === 1 ? 'day' : 'days'
                                  }`}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 whitespace-nowrap"
                                >
                                  <AlertTriangle
                                    className="h-3 w-3 shrink-0"
                                    aria-hidden="true"
                                  />
                                  Overdue ({daysLate}d)
                                </span>
                              )}
                              {isDueToday && (
                                <span className="text-[11px] font-semibold text-amber-700 whitespace-nowrap">
                                  Due today
                                </span>
                              )}
                            </div>
                          )}

                          {/* Financials Line */}
                          {(priceNum > 0 || paidNum > 0) && (
                            <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 font-mono text-[11px] tabular-nums">
                              <span className="text-slate-800 font-medium">
                                {formatAmount(priceNum, currencySymbol)}
                              </span>
                              <span
                                className={
                                  dueNum > 0
                                    ? 'text-amber-700 font-medium'
                                    : 'text-emerald-700 font-medium'
                                }
                              >
                                {dueNum > 0
                                  ? `Due ${formatAmount(dueNum, currencySymbol)}`
                                  : 'Paid'}
                              </span>
                            </div>
                          )}

                          {/* Footer: Assignee, Comment Count & Drive Link */}
                          <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                            <span className="truncate">
                              {task.assignedUser ? (
                                <span className="font-mono font-medium text-[#1A365D]">
                                  @{task.assignedUser}
                                </span>
                              ) : task.taskBy.trim() ? (
                                task.taskBy.trim()
                              ) : (
                                'Unassigned'
                              )}
                            </span>

                            <div className="flex shrink-0 items-center gap-2.5">
                              {(() => {
                                const noteCount = (task.comments ?? []).filter(
                                  (c) => c.kind !== 'activity'
                                ).length;
                                if (noteCount === 0) return null;
                                return (
                                  <span
                                    title={`${noteCount} ${
                                      noteCount === 1 ? 'comment' : 'comments'
                                    }`}
                                    className="inline-flex items-center gap-1 font-mono text-slate-500 tabular-nums"
                                  >
                                    <MessageSquare className="h-3 w-3" aria-hidden="true" />
                                    {noteCount}
                                  </span>
                                );
                              })()}

                              {task.driveLink ? (
                                <a
                                  href={task.driveLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  title={task.driveFileName || task.driveLink}
                                  className="inline-flex shrink-0 items-center gap-1 font-medium text-[#1A365D] hover:underline whitespace-nowrap"
                                >
                                  Drive
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenDrivePicker(task, slNo);
                                  }}
                                  className="inline-flex shrink-0 items-center gap-1 text-slate-400 hover:text-[#1A365D] whitespace-nowrap"
                                >
                                  <FolderPlus className="h-3 w-3" />
                                  Drive
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
