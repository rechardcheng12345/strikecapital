import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronLeft, ChevronRight, CheckCheck, Clock, } from 'lucide-react';
import { investorApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Button, Skeleton, EmptyState } from '../../components/ui';
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
        return date.toLocaleDateString();
    }
    return (<div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#0D2654] flex items-center gap-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          <Bell className="w-6 h-6 text-[#F06010]"/>
          Notifications
          {unreadCount > 0 && (<span className="ml-2 inline-flex items-center justify-center px-2.5 py-0.5 rounded-none text-xs font-bold bg-[#F06010] text-white">
              {unreadCount}
            </span>)}
        </h1>
        {unreadCount > 0 && (<Button variant="outline" size="sm" onClick={handleMarkAllRead} loading={markingAll} className="rounded-none">
            <CheckCheck className="w-4 h-4 mr-1.5"/>
            Mark All Read
          </Button>)}
      </div>

      {isError && (<div className="mb-6">
          <div className="rounded-none border-2 border-red-300 bg-red-50 p-4 text-red-700 text-sm">
            {error?.message || 'Failed to load notifications.'}
            <button onClick={() => refetch()} className="ml-2 underline font-medium">
              Retry
            </button>
          </div>
        </div>)}

      {isLoading ? (<div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (<div key={i} className="rounded-none border-2 border-gray-200 bg-white p-4 space-y-2">
              <div className="flex items-center gap-3">
                <Skeleton variant="text" width={100} height={20}/>
                <Skeleton variant="text" width="60%" height={16}/>
              </div>
              <Skeleton variant="text" width="80%" height={14}/>
              <Skeleton variant="text" width={80} height={12}/>
            </div>))}
        </div>) : notifications.length === 0 ? (<div className="bg-white rounded-none border-2 border-[#0D2654]/20">
          <EmptyState icon={Bell} title="No notifications" description="You're all caught up. No notifications to display."/>
        </div>) : (<div className="space-y-3">
          {notifications.map((notif) => {
                const typeConfig = NOTIFICATION_TYPE[notif.type];
                return (<div key={notif.id} className={`rounded-none border-2 bg-white p-4 transition-all duration-150 ${notif.is_read
                        ? 'border-[#0D2654]/10'
                        : 'border-l-[4px] border-l-[#F06010] border-t-[#0D2654]/20 border-r-[#0D2654]/20 border-b-[#0D2654]/20'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {typeConfig && (<span className={`inline-flex items-center px-2 py-0.5 rounded-none text-xs font-medium ${typeConfig.color}`}>
                          {typeConfig.label}
                        </span>)}
                      <h3 className={`text-sm font-semibold ${notif.is_read ? 'text-gray-600' : 'text-[#0D2654]'}`} style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                        {notif.title}
                      </h3>
                    </div>
                    <p className={`text-sm ${notif.is_read ? 'text-gray-400' : 'text-gray-600'}`}>
                      {notif.message}
                    </p>
                    <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                      <Clock className="w-3 h-3"/>
                      {formatTimestamp(notif.created_at)}
                    </div>
                  </div>
                  {!notif.is_read && (<button onClick={() => handleMarkRead(notif.id)} disabled={markingId === notif.id} className="shrink-0 text-xs text-[#F06010] hover:text-[#0D2654] font-medium transition-colors disabled:opacity-50">
                      {markingId === notif.id ? 'Marking...' : 'Mark read'}
                    </button>)}
                </div>
              </div>);
            })}
        </div>)}

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (<div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">
            Page {pagination.page} of {pagination.pages} ({pagination.total} total)
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-none">
              <ChevronLeft className="w-4 h-4"/>
            </Button>
            <Button variant="outline" size="sm" disabled={pagination.page >= pagination.pages} onClick={() => setPage((p) => p + 1)} className="rounded-none">
              <ChevronRight className="w-4 h-4"/>
            </Button>
          </div>
        </div>)}
    </div>);
}
