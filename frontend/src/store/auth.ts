import { create } from 'zustand';
import { api, setToken, clearToken, getToken } from '../api/client';

export interface ProfileTags { level: string; focus: string[]; }

export interface UserInfo {
  username: string;
  nickname: string;
  phone: string;
  email: string;
  role: string;
  profileTags: ProfileTags;
}

interface AuthState {
  user: UserInfo | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (data: any) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateProfile: (data: any) => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: !!getToken(),

  login: async (username, password) => {
    const { data } = await api.post('/auth/login', { username, password });
    setToken(data.token);
    set({ user: data, loading: false });
  },

  register: async (body) => {
    const { data } = await api.post('/auth/register', body);
    setToken(data.token);
    set({ user: data, loading: false });
  },

  logout: async () => {
    try { await api.post('/auth/logout'); } catch {}
    clearToken();
    set({ user: null });
  },

  refresh: async () => {
    if (!getToken()) { set({ user: null, loading: false }); return; }
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data, loading: false });
    } catch {
      clearToken();
      set({ user: null, loading: false });
    }
  },

  updateProfile: async (body) => {
    const { data } = await api.put('/auth/profile', body);
    const current = get().user;
    if (current) {
      set({ user: { ...current, ...data } });
    }
  },
}));
