import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { API_BASE_URL } from '../lib/constants';
export const useAuthStore = create()(persist((set) => ({
    user: null,
    token: null,
    isAuthenticated: false,
    setAuth: (user, token) => {
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
