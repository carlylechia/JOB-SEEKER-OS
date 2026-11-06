const $ = (id) => document.getElementById(id);
const status = (text) => { $('status').textContent = text || ''; };

async function loadSettings() {
  chrome.storage.sync.get(['techia_app_url', 'techia_api_token'], (res) => {
    $('app-url').value = res.techia_app_url || '';
    $('api-token').value = res.techia_api_token || '';
  });
}

function refreshStats() {
  chrome.runtime.sendMessage({ type: 'GET_STATS' }, (res) => {
    if (res?.ok) {
      $('streak-value').textContent = res.stats?.streak ?? 0;
      $('apps-value').textContent = res.stats?.activeApplications ?? 0;
      $('stats-badge').textContent = `${res.stats?.streak ?? 0}d streak`;
    }
  });
}

$('save-job').addEventListener('click', () => {
  status('Scraping current tab…');
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_CURRENT' }, (res) => {
      if (!res?.ok || !res.data) {
        status('Could not scrape this page.');
        return;
      }
      chrome.runtime.sendMessage({ type: 'SAVE_JOB', payload: res.data }, (saveRes) => {
        status(saveRes?.ok ? 'Job saved to teChia Jobs.' : 'Save failed.');
      });
    });
  });
});

$('autofill').addEventListener('click', () => {
  status('Auto-filling form…');
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    chrome.tabs.sendMessage(tab.id, { type: 'RUN_AUTOFILL' }, (res) => {
      status(res?.ok ? 'Form filled. Review highlighted fields.' : 'Auto-fill failed.');
    });
  });
});

$('save-settings').addEventListener('click', () => {
  const appUrl = $('app-url').value.trim();
  const token = $('api-token').value.trim();
  chrome.runtime.sendMessage({ type: 'SET_APP_URL', appUrl }, () => {
    chrome.runtime.sendMessage({ type: 'SET_API_TOKEN', token }, () => {
      status('Settings saved.');
    });
  });
});

loadSettings();
refreshStats();
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'STATS_UPDATED') {
    $('streak-value').textContent = msg.stats?.streak ?? 0;
    $('apps-value').textContent = msg.stats?.activeApplications ?? 0;
  }
});
