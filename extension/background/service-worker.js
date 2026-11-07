const DEFAULT_APP_URL = 'https://techiadigital.com';
const STORAGE_KEYS = {
  appUrl: 'techia_app_url',
  apiToken: 'techia_api_token',
  stats: 'techia_stats',
};

async function getAppUrl() {
  const { [STORAGE_KEYS.appUrl]: url } = await chrome.storage.sync.get(STORAGE_KEYS.appUrl);
  return (url || DEFAULT_APP_URL).replace(/\/$/, '');
}

async function getApiToken() {
  const { [STORAGE_KEYS.apiToken]: token } = await chrome.storage.sync.get(STORAGE_KEYS.apiToken);
  return token || '';
}

async function apiFetch(path, options = {}) {
  const appUrl = await getAppUrl();
  const token = await getApiToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${appUrl}${path}`, { ...options, headers });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json().catch(() => ({}));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'SAVE_JOB': {
          const result = await apiFetch('/api/jobs', {
            method: 'POST',
            body: JSON.stringify(message.payload || {}),
          }).catch(() => ({ ok: false, queued: true }));
          await chrome.storage.local.set({ lastSavedJob: { ...message.payload, at: Date.now(), result } });
          sendResponse({ ok: true, result });
          break;
        }
        case 'GET_STATS': {
          const cached = await chrome.storage.local.get(STORAGE_KEYS.stats);
          sendResponse({ ok: true, stats: cached[STORAGE_KEYS.stats] || { streak: 0, activeApplications: 0 } });
          // refresh in background
          apiFetch('/api/bootstrap').then((data) => {
            const stats = {
              streak: data?.streakCount ?? data?.streak?.streakCount ?? 0,
              activeApplications: data?.stats?.activeApplications ?? data?.activeApplications ?? 0,
            };
            chrome.storage.local.set({ [STORAGE_KEYS.stats]: stats });
            chrome.runtime.sendMessage({ type: 'STATS_UPDATED', stats }).catch(() => {});
          }).catch(() => {});
          break;
        }
        case 'AUTOFILL_REQUEST': {
          // Delegate to content script; background just acknowledges.
          sendResponse({ ok: true });
          break;
        }
        case 'SET_APP_URL': {
          await chrome.storage.sync.set({ [STORAGE_KEYS.appUrl]: message.appUrl });
          sendResponse({ ok: true });
          break;
        }
        case 'SET_API_TOKEN': {
          await chrome.storage.sync.set({ [STORAGE_KEYS.apiToken]: message.token });
          sendResponse({ ok: true });
          break;
        }
        case 'AI_SCREENING_ANSWER': {
          const appUrl = await getAppUrl();
          try {
            const res = await fetch(`${appUrl}/api/extension/screening-answer`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify(message.payload || {}),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error?.message || `API ${res.status}`);
            sendResponse({ ok: true, answer: data?.data?.answer || data?.answer });
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          break;
        }
        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true;
});

// Periodic stats refresh
chrome.alarms?.create('stats-refresh', { periodInMinutes: 30 });
chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm.name === 'stats-refresh') {
    chrome.runtime.sendMessage({ type: 'GET_STATS' }).catch(() => {});
  }
});
