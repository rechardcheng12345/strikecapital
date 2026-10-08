import { LayoutDashboard, TrendingUp, BarChart3, History, Bell, User } from 'lucide-react';
import { AppShell } from './AppShell';

const investorNavItems = [
    { section: 'My account' },
    { path: '/', icon: LayoutDashboard, label: 'Overview', exact: true },
    { path: '/positions', icon: TrendingUp, label: 'Positions' },
    { path: '/pnl', icon: BarChart3, label: 'P&L' },
    { path: '/history', icon: History, label: 'History' },
    { section: 'Inbox' },
    { path: '/notifications', icon: Bell, label: 'Notifications' },
    { path: '/profile', icon: User, label: 'Profile' },
];

export function InvestorLayout() {
    return <AppShell items={investorNavItems} homePath="/" roleLabel="Investor"/>;
}
