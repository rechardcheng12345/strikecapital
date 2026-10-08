import { Fragment, useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Transition } from '@headlessui/react';
import { Menu, X, LogOut, ChevronDown } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';

/** The wordmark: bold "Strike", light "Capital". */
export function Wordmark({ size = 'md', light = true }) {
    const text = size === 'lg' ? 'text-[34px]' : size === 'sm' ? 'text-[19px]' : 'text-[22px]';
    return (<span className={`${text} leading-none tracking-[-0.02em] ${light ? 'text-white' : 'text-ink'}`}>
      <span className="font-sans font-semibold">Strike</span>
      <span className="font-display !font-light tracking-[-0.02em]">Capital</span>
    </span>);
}

/**
 * Sidebar + mobile drawer + page frame shared by the admin and investor areas.
 * items: [{ section: 'Fund' } | { path, icon, label, exact } | { label, icon, children: [...] }]
 */
export function AppShell({ items, homePath, roleLabel }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, logout } = useAuthStore();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [openGroups, setOpenGroups] = useState({});
    useEffect(() => {
        setMobileOpen(false);
        // Open the group holding the current page (e.g. arriving on /admin/scanner from a link)
        for (const item of items) {
            if (item.children?.some((c) => location.pathname.startsWith(c.path))) {
                setOpenGroups((g) => (g[item.label] ? g : { ...g, [item.label]: true }));
            }
        }
    }, [location.pathname, items]);
    const isActive = (path, exact) => (exact ? location.pathname === path : location.pathname.startsWith(path));
    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const linkClass = (active, nested = false) => `group relative flex items-center gap-3 ${nested ? 'pl-11 pr-4 py-[7px]' : 'px-4 py-[9px]'} text-[13.5px] transition-colors duration-150 ${active
        ? 'text-white bg-white/[0.07]'
        : 'text-white/60 hover:text-white hover:bg-white/[0.04]'}`;
    const activeBar = <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] bg-accent" aria-hidden/>;

    const sidebar = (<>
      <div className="px-5 pt-6 pb-5">
        <Link to={homePath} className="flex items-center gap-3">
          <img src="/logo2.png" alt="" className="w-8 h-8"/>
          <Wordmark size="sm"/>
        </Link>
        {roleLabel && <p className="mt-3 text-[10px] uppercase tracking-eyebrow text-white/35">{roleLabel}</p>}
      </div>

      <nav className="flex-1 overflow-y-auto pb-4">
        {items.map((item, idx) => {
            if (item.section) {
                return <p key={`s-${item.section}`} className={`px-5 ${idx ? 'pt-6' : 'pt-1'} pb-2 text-[10px] uppercase tracking-eyebrow text-white/30`}>{item.section}</p>;
            }
            if (!item.children) {
                const active = isActive(item.path, item.exact);
                return (<Link key={item.path} to={item.path} className={linkClass(active)} aria-current={active ? 'page' : undefined}>
                  {active && activeBar}
                  <item.icon className="w-[17px] h-[17px] shrink-0" strokeWidth={1.6}/>
                  <span className="font-medium">{item.label}</span>
                </Link>);
            }
            const open = !!openGroups[item.label];
            const childActive = item.children.some((c) => isActive(c.path));
            return (<div key={item.label}>
              <button type="button" onClick={() => setOpenGroups((g) => ({ ...g, [item.label]: !open }))} aria-expanded={open} className={`${linkClass(childActive && !open)} w-full`}>
                {childActive && !open && activeBar}
                <item.icon className="w-[17px] h-[17px] shrink-0" strokeWidth={1.6}/>
                <span className="font-medium flex-1 text-left">{item.label}</span>
                <ChevronDown className={`w-3.5 h-3.5 opacity-60 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}/>
              </button>
              <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <div className="overflow-hidden">
                  {item.children.map((c) => {
                    const active = isActive(c.path, c.exact);
                    return (<Link key={c.path} to={c.path} tabIndex={open ? 0 : -1} className={linkClass(active, true)} aria-current={active ? 'page' : undefined}>
                      {active && activeBar}
                      <span className="font-medium">{c.label}</span>
                    </Link>);
                  })}
                </div>
              </div>
            </div>);
        })}
      </nav>

      <div className="border-t border-white/[0.08] px-5 py-4 flex items-center gap-3">
        <div className="w-8 h-8 shrink-0 bg-white/10 ring-1 ring-white/15 flex items-center justify-center">
          <span className="font-display text-[17px] leading-none text-white">{user?.full_name?.[0]?.toUpperCase() || 'A'}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-white truncate">{user?.full_name}</p>
          <p className="text-[11px] text-white/40 truncate">{user?.email}</p>
        </div>
        <button onClick={handleLogout} className="p-2 -mr-2 text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors" title="Sign out" aria-label="Sign out">
          <LogOut className="w-4 h-4"/>
        </button>
      </div>
    </>);

    return (<div className="min-h-screen bg-paper flex">
      <aside className="hidden md:flex md:flex-col w-[248px] bg-ink-900 fixed left-0 top-0 bottom-0 z-20">
        {sidebar}
      </aside>

      {/* Mobile bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-ink-900/95 backdrop-blur px-3 flex items-center justify-between z-30 border-b border-white/[0.06]">
        <button onClick={() => setMobileOpen(true)} className="p-2 text-white/80 hover:text-white" aria-label="Open menu">
          <Menu className="w-5 h-5"/>
        </button>
        <Link to={homePath} className="flex items-center gap-2">
          <img src="/logo2.png" alt="" className="w-6 h-6"/>
          <Wordmark size="sm"/>
        </Link>
        <div className="w-9"/>
      </div>

      <Transition show={mobileOpen} as={Fragment}>
        <div className="md:hidden">
          <Transition.Child as={Fragment} enter="transition-opacity ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100" leave="transition-opacity ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-ink-950/50 backdrop-blur-[2px] z-40" onClick={() => setMobileOpen(false)}/>
          </Transition.Child>
          <Transition.Child as={Fragment} enter="transition-transform ease-out duration-300" enterFrom="-translate-x-full" enterTo="translate-x-0" leave="transition-transform ease-in duration-200" leaveFrom="translate-x-0" leaveTo="-translate-x-full">
            <aside className="fixed inset-y-0 left-0 w-[272px] bg-ink-900 z-50 flex flex-col shadow-float">
              <button onClick={() => setMobileOpen(false)} className="absolute top-5 right-3 p-2 text-white/50 hover:text-white" aria-label="Close menu">
                <X className="w-5 h-5"/>
              </button>
              {sidebar}
            </aside>
          </Transition.Child>
        </div>
      </Transition>

      <main className="flex-1 md:ml-[248px] mt-14 md:mt-0 min-w-0 px-4 py-6 sm:px-6 md:px-10 md:py-10 lg:px-12">
        <div key={location.pathname} className="mx-auto w-full max-w-[1400px] animate-rise">
          <Outlet />
        </div>
      </main>
    </div>);
}
