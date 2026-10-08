import { LayoutDashboard, TrendingUp, Users, BarChart3, ShieldAlert, Megaphone, Settings, Wallet, Radar, TestTubes } from 'lucide-react';
import { AppShell } from './AppShell';

const adminNavItems = [
    { section: 'Fund' },
    { path: '/admin', icon: LayoutDashboard, label: 'Dashboard', exact: true },
    { path: '/admin/positions', icon: TrendingUp, label: 'Positions' },
    { path: '/admin/investors', icon: Users, label: 'Investors' },
    { path: '/admin/pnl', icon: BarChart3, label: 'P&L Analytics' },
    { path: '/admin/risk', icon: ShieldAlert, label: 'Risk' },
    { path: '/admin/funds', icon: Wallet, label: 'Account Funds' },
    { section: 'Research' },
    {
        label: 'Options Finding', icon: Radar, children: [
            { path: '/admin/scanner', label: 'Option Scanner' },
            { path: '/admin/option-alerts', label: 'Option Alerts' },
            { path: '/admin/zero-dte', label: '0DTE Spreads' },
        ],
    },
    {
        label: 'Strategy Lab', icon: TestTubes, children: [
            { path: '/admin/simulation', label: 'Simulation' },
            { path: '/admin/backtest', label: 'Backtest' },
        ],
    },
    { section: 'Workspace' },
    { path: '/admin/announcements', icon: Megaphone, label: 'Announcements' },
    {
        label: 'Settings', icon: Settings, children: [
            { path: '/admin/settings', label: 'Fund Settings' },
            { path: '/admin/profile', label: 'Profile & Notifications' },
            { path: '/admin/audit', label: 'Audit Trail' },
        ],
    },
];

export function AdminLayout() {
    return <AppShell items={adminNavItems} homePath="/admin" roleLabel="Fund manager"/>;
}
