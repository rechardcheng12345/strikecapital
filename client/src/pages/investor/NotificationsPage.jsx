import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronLeft, ChevronRight, CheckCheck } from 'lucide-react';
import { investorApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Button, Skeleton, EmptyState, ErrorAlert, PageHeader } from '../../components/ui';
import { NOTIFICATION_TYPE } from '../../lib/constants';
export function NotificationsPage() {
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const [markingAll, setMarkingAll] = useState(false);
    const [markingId, setMarkingId] = useState(null);
    const limit = 20;
    const { data, isLoading, isError, error, refetch, } = useApiQuery({
        queryKey: ['investor', 'notifications', page],
        queryFn: () => investorApi.getNotifications(page, limit),
    });
    const notifications = data?.notifications || [];
    const pagination = data?.pagination;
    const unreadCount = data?.unread_count ?? 0;
    async function handleMarkAllRead() {
        setMarkingAll(true);
        try {
            await investorApi.markAllNotificationsRead();
            queryClient.invalidateQueries({ queryKey: ['investor', 'notifications'] });
            queryClient.invalidateQueries({ queryKey: ['investor', 'dashboard'] });
        }
        finally {
            setMarkingAll(false);
        }
    }
    async function handleMarkRead(id) {
        setMarkingId(id);
        try {
            await investorApi.markNotificationRead(id);
            queryClient.invalidateQueries({ queryKey: ['investor', 'notifications'] });
            queryClient.invalidateQueries({ queryKey: ['investor', 'dashboard'] });
        }
        finally {
            setMarkingId(null);
        }
    }
    function formatTimestamp(dateStr) {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        const diffHr = Math.floor(diffMin / 60);
        const diffDays = Math.floor(diffHr / 24);
        if (diffMin < 1)
            return 'Just now';
        if (diffMin < 60)
            return `${diffMin}m ago`;
        if (diffHr < 24)
            return `${diffHr}h ago`;
        if (diffDays < 7)
            return `${diffDays}d ago`;
        return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    return (<div>
      <PageHeader
        eyebrow="Inbox"
        title="Notifications"
        description={unreadCount > 0 ? `${unreadCount} unread — trades opened, closed and expiring in the fund.` : 'Trades opened, closed and expiring in the fund. You are all caught up.'}
        actions={unreadCount > 0 && (<Button variant="secondary" onClick={handleMarkAllRead} loading={markingAll}>
            <CheckCheck className="w-4 h-4"/>Mark all read
          </Button>)}
      />

      {isError && <div className="mb-6"><ErrorAlert message={error?.message || 'Failed to load notifications.'} onRetry={() => refetch()}/></div>}

      {isLoading ? (<div className="bg-white border border-line divide-y divide-line/70">
          {Array.from({ length: 6 }).map((_, i) => (<div key={i} className="p-6 space-y-2">
              <Skeleton variant="text" width="45%" height={16}/>
              <Skeleton variant="text" width="70%" height={14}/>
            </div>))}
        </div>) : notifications.length === 0 ? (<div className="bg-white border border-line">
          <EmptyState icon={Bell} title="No notifications" description="You're all caught up."/>
        </div>) : (<ol className="bg-white border border-line divide-y divide-line/70">
          {notifications.map((notif) => {
                const typeConfig = NOTIFICATION_TYPE[notif.type];
                const unread = !notif.is_read;
                return (<li key={notif.id} className={`group grid grid-cols-[14px_minmax(0,1fr)] sm:grid-cols-[14px_112px_minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-5 sm:px-6 py-5 transition-colors hover:bg-[#FAF8F4] ${unread ? '' : 'opacity-75'}`}>
                <span className="pt-[7px]" aria-hidden>
                  <span className={`block w-[7px] h-[7px] rounded-full ${unread ? 'bg-accent' : 'bg-transparent'}`}/>
                </span>
                <time className="hidden sm:block pt-px text-[12.5px] text-muted tabular-nums" dateTime={notif.created_at}>{formatTimestamp(notif.created_at)}</time>
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h3 className={`text-[14.5px] ${unread ? 'font-medium text-ink' : 'text-ink/80'}`}>{notif.title}</h3>
                    {typeConfig && <span className="text-[10.5px] uppercase tracking-[0.1em] text-muted">{typeConfig.label}</span>}
                  </div>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{notif.message}</p>
                  <time className="sm:hidden mt-1.5 block text-[12px] text-muted/80">{formatTimestamp(notif.created_at)}</time>
                </div>
                {unread ? (<button onClick={() => handleMarkRead(notif.id)} disabled={markingId === notif.id} className="col-start-2 sm:col-start-auto justify-self-start sm:justify-self-end self-start text-[12.5px] text-muted hover:text-ink underline-offset-4 hover:underline transition-colors disabled:opacity-50">
                    {markingId === notif.id ? 'Marking…' : 'Mark read'}
                  </button>) : <span className="hidden sm:block"/>}
              </li>);
            })}
        </ol>)}

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (<div className="flex items-center justify-between mt-5">
          <p className="text-[13px] text-muted">
            Page {pagination.page} of {pagination.pages} ({pagination.total} total)
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => setPage((p) => p - 1)} >
              <ChevronLeft className="w-4 h-4"/>
            </Button>
            <Button variant="outline" size="sm" disabled={pagination.page >= pagination.pages} onClick={() => setPage((p) => p + 1)} >
              <ChevronRight className="w-4 h-4"/>
            </Button>
          </div>
        </div>)}
    </div>);
}
