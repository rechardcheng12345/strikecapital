import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AdminLayout, InvestorLayout, ProtectedRoute } from './components/layout';
import { LoginPage, ForgotPasswordPage, ResetPasswordPage } from './pages/auth';
import { useAuthStore } from './stores/authStore';
// Lazy load admin pages
const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage').then(m => ({ default: m.AdminDashboardPage })));
const AdminPositionsPage = lazy(() => import('./pages/admin/AdminPositionsPage').then(m => ({ default: m.AdminPositionsPage })));
const AddPositionPage = lazy(() => import('./pages/admin/AddPositionPage').then(m => ({ default: m.AddPositionPage })));
const PositionDetailPage = lazy(() => import('./pages/admin/PositionDetailPage').then(m => ({ default: m.PositionDetailPage })));
const InvestorManagementPage = lazy(() => import('./pages/admin/InvestorManagementPage').then(m => ({ default: m.InvestorManagementPage })));
const PnlAnalyticsPage = lazy(() => import('./pages/admin/PnlAnalyticsPage').then(m => ({ default: m.PnlAnalyticsPage })));
const RiskDashboardPage = lazy(() => import('./pages/admin/RiskDashboardPage').then(m => ({ default: m.RiskDashboardPage })));
const AuditTrailPage = lazy(() => import('./pages/admin/AuditTrailPage').then(m => ({ default: m.AuditTrailPage })));
const AnnouncementsPage = lazy(() => import('./pages/admin/AnnouncementsPage').then(m => ({ default: m.AnnouncementsPage })));
const AdminSettingsPage = lazy(() => import('./pages/admin/AdminSettingsPage').then(m => ({ default: m.AdminSettingsPage })));
const AccountFundsPage = lazy(() => import('./pages/admin/AccountFundsPage').then(m => ({ default: m.AccountFundsPage })));
// Lazy load investor pages
const InvestorDashboardPage = lazy(() => import('./pages/investor/InvestorDashboardPage').then(m => ({ default: m.InvestorDashboardPage })));
const InvestorPositionsPage = lazy(() => import('./pages/investor/InvestorPositionsPage').then(m => ({ default: m.InvestorPositionsPage })));
const InvestorPnlPage = lazy(() => import('./pages/investor/InvestorPnlPage').then(m => ({ default: m.InvestorPnlPage })));
const PositionHistoryPage = lazy(() => import('./pages/investor/PositionHistoryPage').then(m => ({ default: m.PositionHistoryPage })));
const NotificationsPage = lazy(() => import('./pages/investor/NotificationsPage').then(m => ({ default: m.NotificationsPage })));
const ProfilePage = lazy(() => import('./pages/profile/ProfilePage').then(m => ({ default: m.ProfilePage })));
const PageLoader = () => (<div className="flex justify-center items-center py-12">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#F06010]"></div>
  </div>);
function App() {
    const { isAuthenticated, user } = useAuthStore();
    // Determine default route based on role
    const getDefaultRoute = () => {
        if (!isAuthenticated)
            return '/login';
        return user?.role === 'admin' ? '/admin' : '/';
    };
    return (<>
      <Toaster position="top-right" richColors/>
      <Routes>
        {/* Public auth routes */}
        <Route path="/login" element={isAuthenticated ? <Navigate to={getDefaultRoute()} replace/> : <LoginPage />}/>
        <Route path="/forgot-password" element={<ForgotPasswordPage />}/>
        <Route path="/reset-password" element={<ResetPasswordPage />}/>

        {/* Admin routes */}
        <Route element={<ProtectedRoute requireAdmin>
              <AdminLayout />
            </ProtectedRoute>}>
          <Route path="/admin" element={<Suspense fallback={<PageLoader />}><AdminDashboardPage /></Suspense>}/>
          <Route path="/admin/positions" element={<Suspense fallback={<PageLoader />}><AdminPositionsPage /></Suspense>}/>
          <Route path="/admin/positions/new" element={<Suspense fallback={<PageLoader />}><AddPositionPage /></Suspense>}/>
          <Route path="/admin/positions/:id" element={<Suspense fallback={<PageLoader />}><PositionDetailPage /></Suspense>}/>
          <Route path="/admin/investors" element={<Suspense fallback={<PageLoader />}><InvestorManagementPage /></Suspense>}/>
          <Route path="/admin/pnl" element={<Suspense fallback={<PageLoader />}><PnlAnalyticsPage /></Suspense>}/>
          <Route path="/admin/risk" element={<Suspense fallback={<PageLoader />}><RiskDashboardPage /></Suspense>}/>
          <Route path="/admin/audit" element={<Suspense fallback={<PageLoader />}><AuditTrailPage /></Suspense>}/>
          <Route path="/admin/announcements" element={<Suspense fallback={<PageLoader />}><AnnouncementsPage /></Suspense>}/>
          <Route path="/admin/funds" element={<Suspense fallback={<PageLoader />}><AccountFundsPage /></Suspense>}/>
          <Route path="/admin/settings" element={<Suspense fallback={<PageLoader />}><AdminSettingsPage /></Suspense>}/>
        </Route>

        {/* Investor routes */}
        <Route element={<ProtectedRoute>
              <InvestorLayout />
            </ProtectedRoute>}>
          <Route path="/" element={<Suspense fallback={<PageLoader />}><InvestorDashboardPage /></Suspense>}/>
          <Route path="/positions" element={<Suspense fallback={<PageLoader />}><InvestorPositionsPage /></Suspense>}/>
          <Route path="/positions/:id" element={<Suspense fallback={<PageLoader />}><PositionDetailPage /></Suspense>}/>
          <Route path="/pnl" element={<Suspense fallback={<PageLoader />}><InvestorPnlPage /></Suspense>}/>
          <Route path="/history" element={<Suspense fallback={<PageLoader />}><PositionHistoryPage /></Suspense>}/>
          <Route path="/notifications" element={<Suspense fallback={<PageLoader />}><NotificationsPage /></Suspense>}/>
          <Route path="/profile" element={<Suspense fallback={<PageLoader />}><ProfilePage /></Suspense>}/>
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Routes>
    </>);
}
export default App;
