import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { notificationApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Card, CardHeader, CardBody, Button } from '../../components/ui';

export function NotificationSettings() {
    const queryClient = useQueryClient();
    const preferences = useApiQuery({ queryKey: ['notification-preferences'], queryFn: notificationApi.preferences });
    const history = useApiQuery({ queryKey: ['notification-history'], queryFn: notificationApi.history, refetchInterval: 30000 });
    const [draft, setDraft] = useState(null);
    const saved = preferences.data;
    const settings = draft || saved;
    const action = useMutation({
        mutationFn: async ({ kind, data }) => {
            const response = await notificationApi[kind](data);
            if (response.error) throw new Error(response.error);
            return { kind, data: response.data };
        },
        onSuccess: ({ kind, data }) => {
            if (kind === 'savePreferences') {
                queryClient.setQueryData(['notification-preferences'], data);
                setDraft(null);
            }
            queryClient.invalidateQueries({ queryKey: ['notification-history'] });
            toast.success(data.message || 'Notification preferences saved');
        },
        onError: (error) => toast.error(error.message),
    });
    if (preferences.isPending) return <Card><CardBody>Loading notification preferences…</CardBody></Card>;
    if (preferences.isError) return <Card><CardBody><p role="alert">{preferences.error.message}</p></CardBody></Card>;
    const change = (patch) => setDraft({ ...settings, ...patch });
    return <>
        <Card>
            <CardHeader><h2 className="font-semibold text-gray-900">Push notifications with ntfy</h2></CardHeader>
            <CardBody>
                <div className="space-y-5">
                    {!saved.configured && <p className="text-sm text-orange-700">Push delivery is awaiting platform configuration. You can save your preferences now.</p>}
                    <label className="flex gap-3 items-center"><input type="checkbox" checked={settings.enabled} onChange={(e) => change({ enabled: e.target.checked })}/>Enable push notifications</label>
                    <p className="text-sm text-gray-600">Install the ntfy app on your phone, choose this server, and subscribe to your personal topic. Anyone who knows a topic on ntfy.sh can subscribe; keep yours private. Push messages contain a brief alert. Sign in here to view financial details.</p>
                    <dl className="space-y-2 text-sm">
                        <div><dt className="font-medium">Server</dt><dd className="break-all">{saved.server_url}</dd></div>
                        <div><dt className="font-medium">Your topic</dt><dd className="break-all font-mono select-all">{saved.topic}</dd></div>
                    </dl>
                    <Button variant="outline" onClick={async () => {
                        try { await navigator.clipboard.writeText(saved.topic); toast.success('Topic copied'); }
                        catch { toast.error('Select the topic above and copy it'); }
                    }}>Copy topic</Button>
                    <fieldset className="space-y-3">
                        <legend className="font-medium mb-3">Notify me about</legend>
                        {saved.available_events.map((event) => <label key={event.value} className="flex gap-3 items-center text-sm">
                            <input type="checkbox" checked={settings.events.includes(event.value)} onChange={(e) => change({ events: e.target.checked ? [...settings.events, event.value] : settings.events.filter((v) => v !== event.value) })}/>{event.label}
                        </label>)}
                    </fieldset>
                    <label className="block text-sm font-medium">Account summary schedule
                        <select className="mt-2 block w-full border border-gray-300 p-2 bg-white" value={settings.summary_frequency} onChange={(e) => change({ summary_frequency: e.target.value })}>
                            <option value="weekly">Weekly — Friday after 5 p.m. New York</option>
                            <option value="daily">Weekdays after 5 p.m. New York</option>
                            <option value="manual">Only when requested</option>
                        </select>
                    </label>
                    <p className="text-xs text-gray-500">Summaries use the latest cached prices and show when those prices were updated.</p>
                    <div className="flex flex-wrap gap-3">
                        <Button loading={action.isPending} disabled={!draft} onClick={() => action.mutate({ kind: 'savePreferences', data: { enabled: settings.enabled, events: settings.events, summary_frequency: settings.summary_frequency } })}>Save preferences</Button>
                        <Button variant="outline" disabled={!!draft || !saved.enabled || !saved.configured} loading={action.isPending} onClick={() => action.mutate({ kind: 'test' })}>Send test</Button>
                        <Button variant="outline" disabled={!!draft || !saved.enabled || !saved.configured || !saved.events.includes('account_summary')} loading={action.isPending} onClick={() => action.mutate({ kind: 'summary' })}>Get summary now</Button>
                    </div>
                    <h3 className="text-sm font-medium">Recent push deliveries</h3>
                    {history.isError && <p role="alert" className="text-sm text-red-700">{history.error.message}</p>}
                    <ul className="space-y-2 text-sm">
                        {history.data?.deliveries.map((d) => <li key={d.id} className="border-b border-gray-100 pb-2">
                            {d.event.replaceAll('_', ' ')} — {d.status}{d.last_error && <span className="block text-red-700">{d.last_error}</span>}
                        </li>)}
                    </ul>
                    {history.data?.deliveries.length === 0 && <p className="text-sm text-gray-500">No push deliveries yet.</p>}
                </div>
            </CardBody>
        </Card>
        <Card>
            <CardHeader><h2 className="font-semibold text-gray-900">Recent platform notifications</h2></CardHeader>
            <CardBody><div className="space-y-4">
                {history.data?.notifications.map((n) => <article key={n.id} className="border-b border-gray-100 pb-3">
                    <h3 className="text-sm font-medium">{n.title}</h3>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">{n.message}</p>
                    <time className="text-xs text-gray-500">{new Date(n.created_at).toLocaleString()}</time>
                    {!n.is_read && <Button variant="ghost" size="sm" className="ml-2" loading={action.isPending} onClick={() => action.mutate({ kind: 'markRead', data: n.id })}>Mark read</Button>}
                </article>)}
                {history.data?.notifications.length === 0 && <p className="text-sm text-gray-500">No notifications yet.</p>}
            </div></CardBody>
        </Card>
    </>;
}
