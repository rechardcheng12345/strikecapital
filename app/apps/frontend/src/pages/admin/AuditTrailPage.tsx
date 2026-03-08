import { useState } from 'react';
import { ScrollText, ChevronDown, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, Filter, Calendar, Search } from 'lucide-react';
import { adminApi } from '../../api/client';
import type { AuditTrailResponse, AuditLog } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Card, CardBody, Badge, Button, ErrorAlert, Skeleton, EmptyState } from '../../components/ui';

const ACTION_OPTIONS = [
  { value: '', label: 'All Actions' },
  { value: 'user.login', label: 'User Login' },
  { value: 'position.create', label: 'Position Create' },
  { value: 'position.update', label: 'Position Update' },
  { value: 'position.resolve', label: 'Position Resolve' },
  { value: 'position.roll', label: 'Position Roll' },
  { value: 'position.delete', label: 'Position Delete' },
  { value: 'investor.create', label: 'Investor Create' },
  { value: 'investor.update', label: 'Investor Update' },
  { value: 'investor.delete', label: 'Investor Delete' },
  { value: 'fund.update', label: 'Fund Update' },
  { value: 'announcement.create', label: 'Announcement Create' },
  { value: 'announcement.update', label: 'Announcement Update' },
  { value: 'announcement.delete', label: 'Announcement Delete' },
];

const LIMIT = 25;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function actionBadgeVariant(action: string): 'gray' | 'green' | 'yellow' | 'red' | 'blue' {
  if (action.includes('create')) return 'green';
  if (action.includes('update')) return 'blue';
  if (action.includes('delete')) return 'red';
  if (action.includes('resolve') || action.includes('roll')) return 'yellow';
  return 'gray';
}

function ExpandableRow({ log }: { log: AuditLog }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = log.old_values || log.new_values;

  return (
    <>
      <tr
        className={`border-b border-gray-100 transition-colors ${hasDetails ? 'cursor-pointer hover:bg-[#F5F3EF]/50' : ''}`}
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            {hasDetails ? (
              expanded ? (
                <ChevronDown className="w-4 h-4 text-[#F06010]" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-400" />
              )
            ) : (
              <span className="w-4" />
            )}
            {formatDateTime(log.created_at)}
          </div>
        </td>
        <td className="px-4 py-3 text-sm font-medium text-[#0D2654]">
          {log.user_name || `User #${log.user_id}`}
        </td>
        <td className="px-4 py-3">
          <Badge variant={actionBadgeVariant(log.action)} className="rounded-none">
            {log.action}
          </Badge>
        </td>
        <td className="px-4 py-3 text-sm text-gray-600">{log.entity_type}</td>
        <td className="px-4 py-3 text-sm text-gray-500 font-mono">{log.entity_id ?? '-'}</td>
        <td className="px-4 py-3 text-sm text-gray-500 font-mono">{log.ip_address || '-'}</td>
      </tr>
      {expanded && hasDetails && (
        <tr className="border-b border-gray-200 bg-[#F5F3EF]/30">
          <td colSpan={6} className="px-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-6">
              {log.old_values && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Old Values</p>
                  <pre className="bg-white border border-gray-200 rounded-none p-3 text-xs text-gray-700 overflow-x-auto max-h-48">
                    <code>{JSON.stringify(log.old_values, null, 2)}</code>
                  </pre>
                </div>
              )}
              {log.new_values && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">New Values</p>
                  <pre className="bg-white border border-gray-200 rounded-none p-3 text-xs text-gray-700 overflow-x-auto max-h-48">
                    <code>{JSON.stringify(log.new_values, null, 2)}</code>
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-gray-100">
          <Skeleton variant="text" className="w-36 h-4" />
          <Skeleton variant="text" className="w-24 h-4" />
          <Skeleton variant="text" className="w-28 h-5" />
          <Skeleton variant="text" className="w-20 h-4" />
          <Skeleton variant="text" className="w-12 h-4" />
          <Skeleton variant="text" className="w-28 h-4" />
        </div>
      ))}
    </div>
  );
}

export function AuditTrailPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const { data, isLoading, isError, error, refetch } = useApiQuery<AuditTrailResponse>({
    queryKey: ['audit-trail', page, LIMIT, action, startDate, endDate],
    queryFn: () =>
      adminApi.getAuditTrail(
        page,
        LIMIT,
        action || undefined,
        undefined,
        startDate || undefined,
        endDate || undefined,
      ),
  });

  const logs = data?.logs ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination?.pages ?? 1;

  const handleFilterReset = () => {
    setAction('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const hasActiveFilters = action || startDate || endDate;

  return (
    <div className="space-y-6">
      {/* Header */}
      <h1
        className="text-2xl font-bold text-gray-900 flex items-center gap-2"
        style={{ fontFamily: 'Space Grotesk, sans-serif' }}
      >
        <ScrollText className="w-6 h-6 text-[#F06010]" />
        Audit Trail
      </h1>

      {/* Filter Bar */}
      <Card className="rounded-none">
        <CardBody>
          <div className="flex flex-wrap items-end gap-4">
            {/* Action filter */}
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                <Filter className="w-3 h-3 inline mr-1" />
                Action
              </label>
              <select
                value={action}
                onChange={(e) => { setAction(e.target.value); setPage(1); }}
                className="block w-full px-3 py-2 border border-gray-300 rounded-none bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0D2654] focus:border-[#0D2654]"
              >
                {ACTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Start date */}
            <div className="min-w-[160px]">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                <Calendar className="w-3 h-3 inline mr-1" />
                From
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                className="block w-full px-3 py-2 border border-gray-300 rounded-none bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0D2654] focus:border-[#0D2654]"
              />
            </div>

            {/* End date */}
            <div className="min-w-[160px]">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                <Calendar className="w-3 h-3 inline mr-1" />
                To
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                className="block w-full px-3 py-2 border border-gray-300 rounded-none bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0D2654] focus:border-[#0D2654]"
              />
            </div>

            {/* Reset */}
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={handleFilterReset} className="rounded-none">
                Clear Filters
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Error State */}
      {isError && (
        <ErrorAlert message={error?.message} onRetry={() => refetch()} />
      )}

      {/* Table */}
      <Card className="rounded-none overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : logs.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No audit logs found"
            description={hasActiveFilters ? 'Try adjusting your filters.' : 'No activity has been recorded yet.'}
            action={
              hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={handleFilterReset} className="rounded-none">
                  Clear Filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#0D2654] text-white text-left">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider">Date / Time</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider">User</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider">Action</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider">Entity Type</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider">Entity ID</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider">IP Address</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <ExpandableRow key={log.id} log={log} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <p className="text-sm text-gray-600">
              Showing{' '}
              <span className="font-semibold">{(page - 1) * LIMIT + 1}</span>
              {' '}-{' '}
              <span className="font-semibold">{Math.min(page * LIMIT, pagination.total)}</span>
              {' '}of{' '}
              <span className="font-semibold">{pagination.total}</span> logs
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="rounded-none"
                disabled={page <= 1}
                onClick={() => setPage(1)}
              >
                <ChevronsLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-none"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="px-3 py-1 text-sm font-medium text-[#0D2654]">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="rounded-none"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-none"
                disabled={page >= totalPages}
                onClick={() => setPage(totalPages)}
              >
                <ChevronsRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
