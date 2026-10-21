import axios from 'axios';

const TOKEN_KEY = 'llm_learn_token';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      if (location.pathname !== '/') location.href = '/';
    }
    return Promise.reject(err);
  },
);

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}
export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
