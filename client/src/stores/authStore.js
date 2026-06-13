import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { API_BASE_URL } from '../lib/constants';
import { queryClient } from '../lib/queryClient';
export const useAuthStore = create()(persist((set, get) => ({
    user: null,
    token: null,
    isAuthenticated: false,
    setAuth: (user, token) => {
        // If the authenticated user is changing, wipe any cached query data
        // from the previous user so we don't leak it into the new session.
        const prevUserId = get().user?.id;
        if (prevUserId !== user?.id) {
            queryClient.clear();
        }
        localStorage.setItem('token', token);
        set({ user, token, isAuthenticated: true });
    },
    logout: () => {
        // Call backend to clear refresh token cookie
        fetch(`${API_BASE_URL}/auth/logout`, {
            method: 'POST',
            credentials: 'include',
        }).catch(() => {
            // Ignore errors - we're logging out anyway
        });
        queryClient.clear();
        localStorage.removeItem('token');
        set({ user: null, token: null, isAuthenticated: false });
    },
    updateUser: (userData) => {
        set((state) => ({
            user: state.user ? { ...state.user, ...userData } : null,
        }));
    },
}), {
    name: 'auth-storage',
    partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
    }),
}));
