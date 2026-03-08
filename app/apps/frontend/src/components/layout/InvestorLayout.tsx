import { Fragment, useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Transition } from '@headlessui/react';
import {
  LayoutDashboard,
  TrendingUp,
  BarChart3,
  History,
  Bell,
  User,
  Menu,
  X,
  LogOut,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';

const investorNavItems = [
  { path: '/', icon: LayoutDashboard, label: 'My Dashboard', exact: true },
  { path: '/positions', icon: TrendingUp, label: 'Positions' },
  { path: '/pnl', icon: BarChart3, label: 'P&L' },
  { path: '/history', icon: History, label: 'History' },
  { path: '/notifications', icon: Bell, label: 'Notifications' },
  { path: '/profile', icon: User, label: 'Profile' },
];

export function InvestorLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navLinkClasses = (path: string, exact?: boolean) =>
    `flex items-center space-x-3 px-4 py-2.5 rounded-none transition-colors ${
      isActive(path, exact)
        ? 'bg-white/10 text-white border-l-2 border-[#F06010]'
        : 'text-gray-300 hover:bg-white/5 hover:text-white border-l-2 border-transparent'
    }`;

  const sidebarContent = (
    <>
      {/* Brand */}
      <div className="px-4 py-5 border-b border-white/10">
        <Link to="/" className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-[#F06010] rounded flex items-center justify-center">
            <span className="text-white font-bold text-sm">S</span>
          </div>
          <span className="text-white font-bold text-lg tracking-tight">StrikeCapital</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 space-y-0.5 overflow-y-auto">
        {investorNavItems.map((item) => (
          <Link key={item.path} to={item.path} className={navLinkClasses(item.path, item.exact)}>
            <item.icon className="w-5 h-5" />
            <span className="font-medium text-sm">{item.label}</span>
          </Link>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-white/10 p-4">
        <div className="flex items-center space-x-3 mb-3">
          <div className="w-8 h-8 bg-[#F06010] rounded-full flex items-center justify-center">
            <span className="text-white text-sm font-medium">
              {user?.full_name?.[0]?.toUpperCase() || 'U'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{user?.full_name}</p>
            <p className="text-xs text-gray-400 truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center space-x-2 text-gray-400 hover:text-white transition-colors text-sm w-full"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign out</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[#F5F3EF] flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col w-64 bg-[#0D2654] min-h-screen fixed left-0 top-0 bottom-0">
        {sidebarContent}
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 bg-[#0D2654] px-4 py-3 flex items-center justify-between z-30">
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="p-1 rounded hover:bg-white/10 transition-colors"
        >
          <Menu className="w-6 h-6 text-white" />
        </button>
        <span className="text-white font-bold">StrikeCapital</span>
        <div className="w-8" />
      </div>

      {/* Mobile drawer */}
      <Transition show={isMobileMenuOpen} as={Fragment}>
        <div className="md:hidden">
          <Transition.Child
            as={Fragment}
            enter="transition-opacity ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setIsMobileMenuOpen(false)} />
          </Transition.Child>
          <Transition.Child
            as={Fragment}
            enter="transition-transform ease-out duration-300"
            enterFrom="-translate-x-full"
            enterTo="translate-x-0"
            leave="transition-transform ease-in duration-200"
            leaveFrom="translate-x-0"
            leaveTo="-translate-x-full"
          >
            <aside className="fixed inset-y-0 left-0 w-64 bg-[#0D2654] z-50 flex flex-col">
              <div className="flex items-center justify-end p-2">
                <button onClick={() => setIsMobileMenuOpen(false)} className="p-1 rounded hover:bg-white/10">
                  <X className="w-6 h-6 text-white" />
                </button>
              </div>
              {sidebarContent}
            </aside>
          </Transition.Child>
        </div>
      </Transition>

      {/* Main content */}
      <main className="flex-1 md:ml-64 mt-14 md:mt-0 p-4 md:p-6 lg:p-8 max-w-full overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
