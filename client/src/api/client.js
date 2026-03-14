import { API_BASE_URL } from '../lib/constants';
import { useAuthStore } from '../stores/authStore';
// Flag to prevent multiple simultaneous refresh attempts
let isRefreshing = false;
let refreshPromise = null;
// Refresh the access token using the httpOnly refresh cookie
async function refreshAccessToken() {
    try {
        const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
        });
        if (response.ok) {
            const data = await response.json();
            if (data.token) {
                if (data.user) {
                    useAuthStore.getState().setAuth(data.user, data.token);
                }
                else {
                    localStorage.setItem('token', data.token);
                }
                return true;
            }
        }
        return false;
    }
    catch {
        return false;
    }
}
// Wrapper to ensure only one refresh happens at a time
export async function tryRefreshToken() {
    if (isRefreshing && refreshPromise) {
        return refreshPromise;
    }
    isRefreshing = true;
    refreshPromise = refreshAccessToken().finally(() => {
        isRefreshing = false;
        refreshPromise = null;
    });
    return refreshPromise;
}
// Force logout and redirect to login
function forceLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('auth-storage');
    window.location.href = '/login';
}
async function apiRequest(endpoint, options = {}, isRetry = false) {
    const token = localStorage.getItem('token');
    const headers = {
        ...options.headers,
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    // Don't set Content-Type for FormData
    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers,
            credentials: 'include',
        });
        // Handle 401 Unauthorized - try to refresh token
        if (response.status === 401 && !isRetry && !endpoint.includes('/auth/')) {
            const refreshed = await tryRefreshToken();
            if (refreshed) {
                return apiRequest(endpoint, options, true);
            }
            else {
                forceLogout();
                return { error: 'Session expired. Please log in again.' };
            }
        }
        const data = await response.json();
        if (!response.ok) {
            if (data.errors && Array.isArray(data.errors)) {
                const errorMessages = data.errors
                    .map((err) => err.field ? `${err.field}: ${err.message}` : err.message)
                    .join('\n');
                return { error: errorMessages || data.message || 'Validation error' };
            }
            return { error: data.message || 'An error occurred' };
        }
        return { data };
    }
    catch (error) {
        return { error: 'Network error. Please try again.' };
    }
}
export const api = {
    get: (endpoint) => apiRequest(endpoint, { method: 'GET' }),
    post: (endpoint, body) => apiRequest(endpoint, {
        method: 'POST',
        body: body instanceof FormData ? body : JSON.stringify(body),
    }),
    put: (endpoint, body) => apiRequest(endpoint, {
        method: 'PUT',
        body: JSON.stringify(body),
    }),
    delete: (endpoint) => apiRequest(endpoint, { method: 'DELETE' }),
};
// ─── Auth API ─────────────────────────────────────────
export const authApi = {
    login: (email, password) => api.post('/auth/login', { email, password }),
    forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
    resetPassword: (token, password) => api.post('/auth/reset-password', { token, password }),
};
// ─── User API ─────────────────────────────────────────
export const userApi = {
    getProfile: () => api.get('/users/me'),
    updateProfile: (data) => api.put('/users/me', data),
    changePassword: (data) => api.put('/users/me/password', data),
};
// ─── Positions API ────────────────────────────────────
export const positionApi = {
    list: (page = 1, limit = 20, status, positionType) => api.get(`/positions?page=${page}&limit=${limit}${status ? `&status=${status}` : ''}${positionType ? `&position_type=${positionType}` : ''}`),
    get: (id) => api.get(`/positions/${id}`),
    create: (data) => api.post('/positions', data),
    update: (id, data) => api.put(`/positions/${id}`, data),
    delete: (id) => api.delete(`/positions/${id}`),
    resolve: (id, data) => api.post(`/positions/${id}/resolve`, data),
    roll: (id, data) => api.post(`/positions/${id}/roll`, data),
    refreshPrices: () => api.post('/positions/refresh-prices'),
};
// ─── Fund API ─────────────────────────────────────────
export const fundApi = {
    getSettings: () => api.get('/fund/settings'),
    updateSettings: (data) => api.put('/fund/settings', data),
    getCapacity: () => api.get('/fund/capacity'),
};
// ─── Admin API ────────────────────────────────────────
export const adminApi = {
    getDashboardStats: () => api.get('/admin/dashboard/stats'),
    getInvestorView: () => api.get('/admin/dashboard/investor-view'),
    // Moomoo
    getMoomooFunds: () => api.get('/admin/moomoo/funds'),
    getMoomooAccounts: () => api.get('/admin/moomoo/accounts'),
    // Investors
    getInvestors: (page = 1, limit = 20, search) => api.get(`/admin/investors?page=${page}&limit=${limit}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    getInvestor: (id) => api.get(`/admin/investors/${id}`),
    createInvestor: (data) => api.post('/admin/investors', data),
    updateInvestor: (id, data) => api.put(`/admin/investors/${id}`, data),
    deleteInvestor: (id) => api.delete(`/admin/investors/${id}`),
    getFundSummary: () => api.get('/admin/investors/fund-summary'),
    resetInvestorPassword: (id, password) => api.post(`/admin/investors/${id}/reset-password`, { password }),
    // P&L
    getPnl: (period = 'all') => api.get(`/admin/pnl?period=${period}`),
    createPnlRecord: (data) => api.post('/admin/pnl', data),
    // Announcements
    getAnnouncements: (page = 1, limit = 20) => api.get(`/admin/announcements?page=${page}&limit=${limit}`),
    createAnnouncement: (data) => api.post('/admin/announcements', data),
    updateAnnouncement: (id, data) => api.put(`/admin/announcements/${id}`, data),
    deleteAnnouncement: (id) => api.delete(`/admin/announcements/${id}`),
    // Risk
    getRiskDashboard: () => api.get('/admin/risk/dashboard'),
    // Audit
    getAuditTrail: (page = 1, limit = 50, action, userId, startDate, endDate) => api.get(`/admin/audit?page=${page}&limit=${limit}${action ? `&action=${action}` : ''}${userId ? `&user_id=${userId}` : ''}${startDate ? `&start_date=${startDate}` : ''}${endDate ? `&end_date=${endDate}` : ''}`),
    // Export
    exportPositions: (status) => {
        const token = localStorage.getItem('token');
        window.open(`${API_BASE_URL}/admin/export/positions?token=${encodeURIComponent(token || '')}${status ? `&status=${status}` : ''}`, '_blank');
    },
};
// ─── Investor API (read-only) ─────────────────────────
export const investorApi = {
    getDashboard: () => api.get('/investor/dashboard'),
    getPositions: (page = 1, limit = 20, status) => api.get(`/investor/positions?page=${page}&limit=${limit}${status ? `&status=${status}` : ''}`),
    getPosition: (id) => api.get(`/investor/positions/${id}`),
    getPnl: (period = 'all') => api.get(`/investor/pnl?period=${period}`),
    getHistory: (page = 1, limit = 20) => api.get(`/investor/history?page=${page}&limit=${limit}`),
    getAnnouncements: () => api.get('/investor/announcements'),
    getNotifications: (page = 1, limit = 20) => api.get(`/investor/notifications?page=${page}&limit=${limit}`),
    markNotificationRead: (id) => api.put(`/investor/notifications/${id}/read`),
    markAllNotificationsRead: () => api.put('/investor/notifications/read-all'),
};
