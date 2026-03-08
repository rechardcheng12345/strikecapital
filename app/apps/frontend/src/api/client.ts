import { API_BASE_URL } from '../lib/constants';
import { useAuthStore } from '../stores/authStore';

interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
}

// Flag to prevent multiple simultaneous refresh attempts
let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

// Refresh the access token using the httpOnly refresh cookie
async function refreshAccessToken(): Promise<boolean> {
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
        } else {
          localStorage.setItem('token', data.token);
        }
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// Wrapper to ensure only one refresh happens at a time
export async function tryRefreshToken(): Promise<boolean> {
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

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  isRetry = false
): Promise<ApiResponse<T>> {
  const token = localStorage.getItem('token');

  const headers: HeadersInit = {
    ...options.headers,
  };

  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  // Don't set Content-Type for FormData
  if (!(options.body instanceof FormData)) {
    (headers as Record<string, string>)['Content-Type'] = 'application/json';
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
        return apiRequest<T>(endpoint, options, true);
      } else {
        forceLogout();
        return { error: 'Session expired. Please log in again.' };
      }
    }

    const data = await response.json();

    if (!response.ok) {
      if (data.errors && Array.isArray(data.errors)) {
        const errorMessages = data.errors
          .map((err: { field?: string; message: string }) =>
            err.field ? `${err.field}: ${err.message}` : err.message
          )
          .join('\n');
        return { error: errorMessages || data.message || 'Validation error' };
      }
      return { error: data.message || 'An error occurred' };
    }

    return { data };
  } catch (error) {
    return { error: 'Network error. Please try again.' };
  }
}

export const api = {
  get: <T>(endpoint: string) => apiRequest<T>(endpoint, { method: 'GET' }),

  post: <T>(endpoint: string, body?: unknown) =>
    apiRequest<T>(endpoint, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),

  put: <T>(endpoint: string, body?: unknown) =>
    apiRequest<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  delete: <T>(endpoint: string) => apiRequest<T>(endpoint, { method: 'DELETE' }),
};

// ─── Auth API ─────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ user: User; token: string }>('/auth/login', { email, password }),

  forgotPassword: (email: string) =>
    api.post<{ message: string }>('/auth/forgot-password', { email }),

  resetPassword: (token: string, password: string) =>
    api.post<{ message: string }>('/auth/reset-password', { token, password }),
};

// ─── User API ─────────────────────────────────────────
export const userApi = {
  getProfile: () => api.get<User>('/users/me'),

  updateProfile: (data: { full_name?: string; phone?: string }) =>
    api.put<User>('/users/me', data),

  changePassword: (data: { current_password: string; new_password: string }) =>
    api.put<{ message: string }>('/users/me/password', data),
};

// ─── Positions API ────────────────────────────────────
export const positionApi = {
  list: (page = 1, limit = 20, status?: string, positionType?: string) =>
    api.get<PositionsResponse>(
      `/positions?page=${page}&limit=${limit}${status ? `&status=${status}` : ''}${positionType ? `&position_type=${positionType}` : ''}`
    ),

  get: (id: number) => api.get<Position>(`/positions/${id}`),

  create: (data: CreatePositionData) =>
    api.post<Position>('/positions', data),

  update: (id: number, data: Partial<CreatePositionData>) =>
    api.put<Position>(`/positions/${id}`, data),

  delete: (id: number) =>
    api.delete<{ message: string }>(`/positions/${id}`),

  resolve: (id: number, data: ResolvePositionData) =>
    api.post<{ message: string }>(`/positions/${id}/resolve`, data),

  roll: (id: number, data: CreatePositionData) =>
    api.post<{ message: string; new_position: Position }>(`/positions/${id}/roll`, data),

  refreshPrices: () =>
    api.post<{ message: string }>('/positions/refresh-prices'),
};

// ─── Fund API ─────────────────────────────────────────
export const fundApi = {
  getSettings: () => api.get<FundSettings>('/fund/settings'),

  updateSettings: (data: Partial<FundSettings>) =>
    api.put<FundSettings>('/fund/settings', data),

  getCapacity: () => api.get<FundCapacity>('/fund/capacity'),
};

// ─── Admin API ────────────────────────────────────────
export const adminApi = {
  getDashboardStats: () =>
    api.get<AdminDashboardStats>('/admin/dashboard/stats'),

  // Investors
  getInvestors: (page = 1, limit = 20, search?: string) =>
    api.get<InvestorsResponse>(
      `/admin/investors?page=${page}&limit=${limit}${search ? `&search=${encodeURIComponent(search)}` : ''}`
    ),

  getInvestor: (id: number) => api.get<InvestorDetail>(`/admin/investors/${id}`),

  createInvestor: (data: CreateInvestorData) =>
    api.post<{ user: User; temporary_password: string; message: string }>('/admin/investors', data),

  updateInvestor: (id: number, data: Partial<CreateInvestorData>) =>
    api.put<User>(`/admin/investors/${id}`, data),

  deleteInvestor: (id: number) =>
    api.delete<{ message: string }>(`/admin/investors/${id}`),

  // P&L
  getPnl: (period = 'all') =>
    api.get<PnlOverview>(`/admin/pnl?period=${period}`),

  createPnlRecord: (data: CreatePnlRecordData) =>
    api.post<PnlRecord>('/admin/pnl', data),

  // Announcements
  getAnnouncements: (page = 1, limit = 20) =>
    api.get<AnnouncementsResponse>(`/admin/announcements?page=${page}&limit=${limit}`),

  createAnnouncement: (data: { title: string; content: string; is_active?: boolean }) =>
    api.post<Announcement>('/admin/announcements', data),

  updateAnnouncement: (id: number, data: { title?: string; content?: string; is_active?: boolean }) =>
    api.put<Announcement>(`/admin/announcements/${id}`, data),

  deleteAnnouncement: (id: number) =>
    api.delete<{ message: string }>(`/admin/announcements/${id}`),

  // Risk
  getRiskDashboard: () =>
    api.get<RiskDashboard>('/admin/risk/dashboard'),

  // Audit
  getAuditTrail: (page = 1, limit = 50, action?: string, userId?: number, startDate?: string, endDate?: string) =>
    api.get<AuditTrailResponse>(
      `/admin/audit?page=${page}&limit=${limit}${action ? `&action=${action}` : ''}${userId ? `&user_id=${userId}` : ''}${startDate ? `&start_date=${startDate}` : ''}${endDate ? `&end_date=${endDate}` : ''}`
    ),

  // Export
  exportPositions: (status?: string) => {
    const token = localStorage.getItem('token');
    window.open(
      `${API_BASE_URL}/admin/export/positions?token=${encodeURIComponent(token || '')}${status ? `&status=${status}` : ''}`,
      '_blank'
    );
  },
};

// ─── Investor API (read-only) ─────────────────────────
export const investorApi = {
  getDashboard: () =>
    api.get<InvestorDashboard>('/investor/dashboard'),

  getPositions: (page = 1, limit = 20, status?: string) =>
    api.get<PositionsResponse>(
      `/investor/positions?page=${page}&limit=${limit}${status ? `&status=${status}` : ''}`
    ),

  getPosition: (id: number) =>
    api.get<Position>(`/investor/positions/${id}`),

  getPnl: (period = 'all') =>
    api.get<InvestorPnl>(`/investor/pnl?period=${period}`),

  getHistory: (page = 1, limit = 20) =>
    api.get<PositionHistoryResponse>(`/investor/history?page=${page}&limit=${limit}`),

  getAnnouncements: () =>
    api.get<{ announcements: Announcement[] }>('/investor/announcements'),

  getNotifications: (page = 1, limit = 20) =>
    api.get<NotificationsResponse>(`/investor/notifications?page=${page}&limit=${limit}`),

  markNotificationRead: (id: number) =>
    api.put<{ message: string }>(`/investor/notifications/${id}/read`),

  markAllNotificationsRead: () =>
    api.put<{ message: string }>('/investor/notifications/read-all'),
};

// ─── Types ────────────────────────────────────────────

export interface User {
  id: number;
  email: string;
  full_name: string;
  phone?: string;
  role: 'investor' | 'admin';
  is_active: boolean;
  created_at: string;
}

export interface Position {
  id: number;
  ticker: string;
  position_type: 'option' | 'stock';
  strike_price: number;
  premium_received: number;
  contracts: number;
  expiration_date: string | null;
  status: 'OPEN' | 'MONITORING' | 'ROLLING' | 'EXPIRY' | 'RESOLVED';
  current_price?: number;
  collateral: number;
  break_even: number;
  max_profit: number;
  distance_to_strike?: number;
  notes?: string;
  resolution_type?: 'expired_worthless' | 'rolled' | 'assigned' | 'bought_to_close' | 'sold';
  resolution_date?: string;
  realized_pnl?: number;
  rolled_from_id?: number;
  rolled_to_id?: number;
  shares?: number;
  cost_basis?: number;
  assigned_from_id?: number;
  assigned_to_id?: number;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface FundSettings {
  id: number;
  fund_name: string;
  total_fund_capital: number;
  max_capital_per_position: number;
  max_positions: number;
  default_alert_threshold: number;
  created_at: string;
  updated_at: string;
}

export interface FundCapacity {
  total_capital: number;
  deployed_capital: number;
  available_capital: number;
  utilization_pct: number;
  open_positions: number;
  max_positions: number;
}

export interface InvestorAllocation {
  id: number;
  user_id: number;
  allocation_amount: number;
  allocation_pct: number;
  start_date: string;
  end_date?: string;
  is_active: boolean;
}

export interface PnlRecord {
  id: number;
  position_id: number;
  record_type: 'premium' | 'assignment_loss' | 'buyback_cost' | 'dividend' | 'adjustment';
  amount: number;
  description?: string;
  record_date: string;
  created_by: number;
}

export interface Announcement {
  id: number;
  title: string;
  content: string;
  is_active: boolean;
  created_by: number;
  created_at: string;
}

export interface Notification {
  id: number;
  user_id: number;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface AuditLog {
  id: number;
  user_id: number;
  user_name?: string;
  action: string;
  entity_type: string;
  entity_id?: number;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

// ─── Response Types ───────────────────────────────────

export interface PositionsResponse {
  positions: Position[];
  pagination: Pagination;
}

export interface InvestorsResponse {
  investors: User[];
  pagination: Pagination;
}

export interface InvestorDetail extends User {
  allocation?: InvestorAllocation;
  total_pnl?: number;
}

export interface AnnouncementsResponse {
  announcements: Announcement[];
  pagination: Pagination;
}

export interface NotificationsResponse {
  notifications: Notification[];
  pagination: Pagination;
  unread_count: number;
}

export interface AuditTrailResponse {
  logs: AuditLog[];
  pagination: Pagination;
}

export interface AdminDashboardStats {
  total_positions: number;
  open_positions: number;
  total_premium: number;
  total_collateral: number;
  total_investors: number;
  total_realized_pnl: number;
  capital_utilization: number;
  positions_expiring_soon: number;
}

export interface PnlOverview {
  total_premium: number;
  total_realized_pnl: number;
  records: PnlRecord[];
  positions: Position[];
}

export interface RiskDashboard {
  capital_utilization: {
    total_capital: number;
    deployed_capital: number;
    utilization_pct: number;
  };
  ticker_concentration: {
    ticker: string;
    collateral: number;
    pct: number;
  }[];
  distance_distribution: {
    range: string;
    count: number;
  }[];
}

export interface InvestorDashboard {
  allocation: InvestorAllocation;
  total_pnl_share: number;
  win_rate: number;
  unread_notifications: number;
  active_positions: number;
}

export interface InvestorPnl {
  total_pnl_share: number;
  allocation_pct: number;
  records: {
    position_id: number;
    ticker: string;
    pnl_share: number;
    record_date: string;
  }[];
}

export interface PositionHistoryResponse {
  positions: Position[];
  stats: {
    total_resolved: number;
    win_rate: number;
    total_realized_pnl: number;
  };
  pagination: Pagination;
}

export interface CreatePositionData {
  ticker: string;
  position_type?: 'option' | 'stock';
  strike_price: number;
  premium_received: number;
  contracts: number;
  expiration_date?: string;
  notes?: string;
  shares?: number;
  cost_basis?: number;
  assigned_from_id?: number;
}

export interface ResolvePositionData {
  resolution_type: 'expired_worthless' | 'assigned' | 'bought_to_close' | 'sold';
  realized_pnl?: number;
  notes?: string;
}

export interface CreateInvestorData {
  email: string;
  full_name: string;
  phone?: string;
  allocation_amount?: number;
}

export interface CreatePnlRecordData {
  position_id: number;
  record_type: 'premium' | 'assignment_loss' | 'buyback_cost' | 'dividend' | 'adjustment';
  amount: number;
  description?: string;
  record_date?: string;
}
