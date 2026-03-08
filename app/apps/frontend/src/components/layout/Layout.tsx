import { Outlet } from 'react-router-dom';
import { Header } from './Header';

export function Layout() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-full overflow-x-hidden md:max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 py-2">
        <Outlet />
      </main>
    </div>
  );
}
