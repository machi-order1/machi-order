(function (global) {
  'use strict';

  const VERSION = '71.0.0';
  const API_ORIGIN = 'https://tejglrlkaqolbghoagqj.supabase.co/functions/v1';
  const DEFAULT_STORE = Object.freeze({ id: 1, code: 'nagahama', name: '長浜店' });
  const TOKEN_KEYS = Object.freeze([
    'machi_access_token',
    'mo_staff_token',
    'access_token',
    'sb_access_token'
  ]);

  function toPositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  function readStore() {
    const params = new URLSearchParams(global.location?.search || '');
    const saved = global.localStorage?.getItem('machi_store_id');
    const id = toPositiveInt(params.get('store_id'), toPositiveInt(saved, DEFAULT_STORE.id));
    if (global.localStorage) global.localStorage.setItem('machi_store_id', String(id));
    return Object.freeze({
      id,
      code: id === 1 ? DEFAULT_STORE.code : `store-${id}`,
      name: id === 1 ? DEFAULT_STORE.name : `店舗 ${id}`
    });
  }

  function getToken() {
    if (!global.localStorage) return '';
    for (const key of TOKEN_KEYS) {
      const value = global.localStorage.getItem(key);
      if (value) return value;
    }
    return '';
  }

  function setToken(value) {
    if (!global.localStorage) return;
    const token = String(value || '').trim();
    TOKEN_KEYS.forEach((key) => global.localStorage.removeItem(key));
    if (token) global.localStorage.setItem(TOKEN_KEYS[0], token);
  }

  function apiUrl(name, params) {
    const url = new URL(`${API_ORIGIN}/${name}`);
    url.searchParams.set('store_id', String(readStore().id));
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });
    return url.toString();
  }

  async function api(name, options) {
    const opts = options || {};
    const headers = new Headers(opts.headers || {});
    const token = opts.token === undefined ? getToken() : opts.token;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (opts.body !== undefined && !(opts.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(apiUrl(name, opts.params), {
      method: opts.method || 'GET',
      headers,
      body: opts.body === undefined
        ? undefined
        : opts.body instanceof FormData
          ? opts.body
          : JSON.stringify(opts.body),
      signal: opts.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || data.message || `通信エラー (${response.status})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function yen(value) {
    return `¥${Number(value || 0).toLocaleString('ja-JP')}`;
  }

  function createId(prefix) {
    const id = global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix || 'mo'}-${id}`;
  }

  function registerServiceWorker() {
    if ('serviceWorker' in global.navigator) {
      global.navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  global.Machi = Object.freeze({
    VERSION,
    API_ORIGIN,
    DEFAULT_STORE,
    TOKEN_KEYS,
    store: readStore,
    getToken,
    setToken,
    apiUrl,
    api,
    escapeHtml,
    yen,
    createId,
    registerServiceWorker
  });
})(window);
