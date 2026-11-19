import React, { useMemo } from 'react';
import {
  formatAmount,
  isRowPopulated,
  parseCurrencyValue,
  type TaskRow,
  type TaskStatus,
} from '../types/task';
import { BillingAnalyticsDashboard } from './BillingAnalyticsDashboard';

interface BillingSummaryViewProps {
  tasks: TaskRow[];
  currencySymbol: string;
  onFilterByCompany: (companyOrClient: string) => void;
  onFilterByStatus: (status: TaskStatus | 'ALL') => void;
}

interface ClientAggregate {
  key: string;
  companyName: string;
  clientName: string;
  taskCount: number;
  completedCount: number;
  totalPrice: number;
  totalPaid: number;
  totalDue: number;
}

export const BillingSummaryView: React.FC<BillingSummaryViewProps> = ({
  tasks,
  currencySymbol,
  onFilterByCompany,
  onFilterByStatus,
}) => {
  const populatedTasks = useMemo(() => tasks.filter(isRowPopulated), [tasks]);

  const totals = useMemo(() => {
    let totalPrice = 0;
    let totalPaid = 0;
    let linkedCount = 0;
    for (const t of populatedTasks) {
      totalPrice += parseCurrencyValue(t.taskPrice);
      totalPaid += parseCurrencyValue(t.paidReceiveAmount);
      if (t.driveLink.trim()) linkedCount += 1;
    }
    const totalDue = Math.max(0, totalPrice - totalPaid);
    const collectionRate = totalPrice > 0 ? Math.min(100, (totalPaid / totalPrice) * 100) : 0;
    return {
      totalTasks: populatedTasks.length,
      totalPrice,
      totalPaid,
      totalDue,
      collectionRate,
      linkedCount,
    };
  }, [populatedTasks]);

  const statusBreakdown = useMemo(() => {
    const statuses: Array<{ label: string; value: TaskStatus }> = [
      { label: 'Completed', value: 'Completed' },
      { label: 'In Progress', value: 'In Progress' },
      { label: 'Under Review', value: 'Under Review' },
      { label: 'Not Started', value: 'Not Started' },
      { label: 'On Hold', value: 'On Hold' },
      { label: 'Unassigned Status', value: '' },
    ];

    return statuses
      .map((s) => {
        const matching = populatedTasks.filter((t) => t.taskStatus === s.value);
        const price = matching.reduce((acc, t) => acc + parseCurrencyValue(t.taskPrice), 0);
        const paid = matching.reduce(
          (acc, t) => acc + parseCurrencyValue(t.paidReceiveAmount),
          0
        );
        return {
          ...s,
          count: matching.length,
          price,
          paid,
          due: Math.max(0, price - paid),
        };
      })
      .filter((row) => row.count > 0);
  }, [populatedTasks]);

  const clientGroups = useMemo<ClientAggregate[]>(() => {
    const map = new Map<string, ClientAggregate>();
    for (const t of populatedTasks) {
      const company = t.companyName.trim() || 'Individual / Unspecified';
      const client = t.clientName.trim() || '—';
      const key = `${company.toLowerCase()}::${client.toLowerCase()}`;
      const existing = map.get(key) ?? {
        key,
        companyName: company,
        clientName: client,
        taskCount: 0,
        completedCount: 0,
        totalPrice: 0,
        totalPaid: 0,
        totalDue: 0,
      };
      const price = parseCurrencyValue(t.taskPrice);
      const paid = parseCurrencyValue(t.paidReceiveAmount);
      existing.taskCount += 1;
      if (t.taskStatus === 'Completed') existing.completedCount += 1;
      existing.totalPrice += price;
      existing.totalPaid += paid;
      existing.totalDue = Math.max(0, existing.totalPrice - existing.totalPaid);
      map.set(key, existing);
    }

    return Array.from(map.values()).sort((a, b) => b.totalDue - a.totalDue || b.totalPrice - a.totalPrice);
  }, [populatedTasks]);

  if (populatedTasks.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-8 py-14 text-center">
        <h2 className="text-lg font-semibold text-[#1A365D]">
          No billing entries recorded yet
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
          Add task prices and paid/received amounts in the Task Plan ledger to view
          client balances, outstanding dues, and status breakdowns here.
        </p>
        <button
          type="button"
          onClick={() => onFilterByStatus('ALL')}
          className="mt-5 rounded-md bg-[#1A365D] px-4 py-2 text-sm font-medium text-white hover:bg-[#132948]"
        >
          Return to Task Ledger
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Top Metric Strip */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-2 divide-y divide-slate-200 md:grid-cols-4 md:divide-x md:divide-y-0">
          <div className="px-6 py-5">
            <p className="text-xs font-medium text-slate-500">Total Task Value</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {formatAmount(totals.totalPrice, currencySymbol)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Across {totals.totalTasks} active {totals.totalTasks === 1 ? 'row' : 'rows'}
            </p>
          </div>
          <div className="px-6 py-5">
            <p className="text-xs font-medium text-slate-500">Paid / Received</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
              {formatAmount(totals.totalPaid, currencySymbol)}
            </p>
            <p className="mt-1 text-xs text-slate-500 tabular-nums">
              {totals.collectionRate.toFixed(1)}% collected
            </p>
          </div>
          <div className="px-6 py-5">
            <p className="text-xs font-medium text-slate-500">Outstanding Balance</p>
            <p
              className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${
                totals.totalDue > 0 ? 'text-amber-700' : 'text-slate-900'
              }`}
            >
              {formatAmount(totals.totalDue, currencySymbol)}
            </p>
            <p className="mt-1 text-xs text-slate-500">Pending receivable</p>
          </div>
          <div className="px-6 py-5">
            <p className="text-xs font-medium text-slate-500">Drive Documentation</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-[#1A365D] tabular-nums">
              {totals.linkedCount} / {totals.totalTasks}
            </p>
            <p className="mt-1 text-xs text-slate-500">Rows with Google Drive links</p>
          </div>
        </div>
      </section>

      {/* Recharts Analytics Dashboard: 30-Day Completion Trends & Status Pie Chart */}
      <BillingAnalyticsDashboard
        tasks={tasks}
        currencySymbol={currencySymbol}
        onFilterByStatus={onFilterByStatus}
      />

      {/* Client & Company Billing Ledger */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-[#1A365D]">
            Receivables by Company and Client
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Select any row to filter the main Task Plan ledger for that client.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-[#E6F0FA] text-left text-xs font-semibold text-slate-900">
                <th className="px-6 py-3">Company Name</th>
                <th className="px-4 py-3">Client Name</th>
                <th className="px-4 py-3 text-right">Tasks</th>
                <th className="px-4 py-3 text-right">Task Price</th>
                <th className="px-4 py-3 text-right">Paid / Received</th>
                <th className="px-6 py-3 text-right">Balance Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {clientGroups.map((group) => (
                <tr
                  key={group.key}
                  onClick={() =>
                    onFilterByCompany(
                      group.companyName !== 'Individual / Unspecified'
                        ? group.companyName
                        : group.clientName
                    )
                  }
                  className="cursor-pointer transition-colors hover:bg-[#F5F9FD]"
                >
                  <td className="px-6 py-3 font-medium text-slate-900">
                    {group.companyName}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{group.clientName}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700 tabular-nums">
                    {group.completedCount}/{group.taskCount} done
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-900 tabular-nums">
                    {formatAmount(group.totalPrice, currencySymbol)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-700 tabular-nums">
                    {formatAmount(group.totalPaid, currencySymbol)}
                  </td>
                  <td
                    className={`px-6 py-3 text-right font-mono font-semibold tabular-nums ${
                      group.totalDue > 0 ? 'text-amber-700' : 'text-slate-600'
                    }`}
                  >
                    {formatAmount(group.totalDue, currencySymbol)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Breakdown by Task Status */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-[#1A365D]">
            Breakdown by Task Status
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-[#E6F0FA] text-left text-xs font-semibold text-slate-900">
                <th className="px-6 py-3">Task Status</th>
                <th className="px-4 py-3 text-right">Row Count</th>
                <th className="px-4 py-3 text-right">Contract Value</th>
                <th className="px-4 py-3 text-right">Paid / Received</th>
                <th className="px-6 py-3 text-right">Balance Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {statusBreakdown.map((item) => (
                <tr
                  key={item.label}
                  onClick={() =>
                    item.value
                      ? onFilterByStatus(item.value)
                      : onFilterByStatus('ALL')
                  }
                  className="cursor-pointer transition-colors hover:bg-[#F5F9FD]"
                >
                  <td className="px-6 py-3 font-medium text-slate-900">
                    {item.label}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700 tabular-nums">
                    {item.count}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-900 tabular-nums">
                    {formatAmount(item.price, currencySymbol)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-700 tabular-nums">
                    {formatAmount(item.paid, currencySymbol)}
                  </td>
                  <td className="px-6 py-3 text-right font-mono text-slate-900 tabular-nums">
                    {formatAmount(item.due, currencySymbol)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
