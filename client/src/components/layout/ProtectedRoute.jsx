import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
export function ProtectedRoute({ children, requireAdmin = false }) {
    const { isAuthenticated, user } = useAuthStore();
    const location = useLocation();
    if (!isAuthenticated) {
        return <Navigate to="/login" state={{ from: location }} replace/>;
    }
    if (requireAdmin && user?.role !== 'admin') {
        return <Navigate to="/" replace/>;
    }
    return <>{children}</>;
}
