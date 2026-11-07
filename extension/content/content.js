(function () {
  'use strict';

  const SCRAPERS = {
    linkedin: () => {
      const title = document.querySelector('.top-card-layout__title, h1.t-24')?.textContent?.trim() || document.querySelector('h1')?.textContent?.trim() || '';
      const company = document.querySelector('.top-card-layout__company-name, .job-details-jobs-unified-top-card__company-name a')?.textContent?.trim() || '';
      const location = document.querySelector('.top-card-layout__second-subline, .job-details-jobs-unified-top-card__bullet')?.textContent?.trim() || '';
      const description = document.querySelector('.description__text, .jobs-description__content')?.innerText?.trim() || '';
      return { platform: 'linkedin', title, company, location, description, url: location.href };
    },
    greenhouse: () => {
      const title = document.querySelector('.app-title, h1')?.textContent?.trim() || '';
      const company = document.querySelector('.company-name, .logo img')?.getAttribute('alt') || document.title.split(' at ')[1] || '';
      const location = document.querySelector('.location')?.textContent?.trim() || '';
      const description = document.querySelector('#content, .content')?.innerText?.trim() || '';
      return { platform: 'greenhouse', title, company, location, description, url: location.href };
    },
    lever: () => {
      const title = document.querySelector('.posting-headline h2, h2')?.textContent?.trim() || '';
      const company = (document.title.split(' - ')[0] || '').trim();
      const location = document.querySelector('.posting-categories .location, .location')?.textContent?.trim() || '';
      const description = document.querySelector('.posting-description, .content')?.innerText?.trim() || '';
      return { platform: 'lever', title, company, location, description, url: location.href };
    },
    workday: () => {
      const title = document.querySelector('[data-automation-id="jobPostingHeader"], h1')?.textContent?.trim() || '';
      const company = document.querySelector('[data-automation-id="company"]')?.textContent?.trim() || '';
      const location = document.querySelector('[data-automation-id="locations"]')?.textContent?.trim() || '';
      const description = document.querySelector('[data-automation-id="jobPostingDescription"], .job-description')?.innerText?.trim() || '';
      return { platform: 'workday', title, company, location, description, url: location.href };
    },
  };

  function detectPlatform() {
    const host = location.hostname;
    if (host.includes('linkedin.com')) return 'linkedin';
    if (host.includes('greenhouse.io') || host.includes('boards.greenhouse')) return 'greenhouse';
    if (host.includes('lever.co')) return 'lever';
    if (host.includes('workday') || host.includes('myworkdayjobs')) return 'workday';
    return null;
  }

  function scrape() {
    const platform = detectPlatform();
    if (!platform) return null;
    try {
      return SCRAPERS[platform]();
    } catch (e) {
      return { platform, error: String(e?.message || e) };
    }
  }

  // Floating widget
  function injectWidget() {
    if (document.querySelector('.techia-widget')) return;
    const widget = document.createElement('div');
    widget.className = 'techia-widget';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save to teChia';
    saveBtn.className = 'techia-primary';
    saveBtn.addEventListener('click', async () => {
      const data = scrape();
      if (!data) return;
      saveBtn.textContent = 'Saving…';
      chrome.runtime.sendMessage({ type: 'SAVE_JOB', payload: data }, (res) => {
        saveBtn.textContent = res?.ok ? 'Saved ✓' : 'Save failed';
        setTimeout(() => (saveBtn.textContent = 'Save to teChia'), 2000);
      });
    });
    const fillBtn = document.createElement('button');
    fillBtn.textContent = 'AI Auto-Fill Form';
    fillBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'AUTOFILL_REQUEST' });
      runAutoFill();
    });
    widget.appendChild(saveBtn);
    widget.appendChild(fillBtn);
    document.body.appendChild(widget);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectWidget);
  } else {
    injectWidget();
  }

  // Expose scrape for popup via messaging
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'SCRAPE_CURRENT') {
      sendResponse({ ok: true, data: scrape() });
      return true;
    }
    if (msg?.type === 'RUN_AUTOFILL') {
      runAutoFill(msg.profile || null);
      sendResponse({ ok: true });
      return true;
    }
  });

  // Auto-fill engine (basic)
  function normalizeLabel(text) {
    return (text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  const FIELD_MAP = [
    { keys: ['firstname', 'first_name', 'fname', 'givenname'], value: (p) => p?.firstName },
    { keys: ['lastname', 'last_name', 'lname', 'surname', 'familyname'], value: (p) => p?.lastName },
    { keys: ['email', 'emailaddress'], value: (p) => p?.email },
    { keys: ['phone', 'phonenumber', 'mobile', 'telephone'], value: (p) => p?.phone },
    { keys: ['linkedin', 'linkedinurl', 'linkedinprofile'], value: (p) => p?.linkedinUrl },
    { keys: ['portfolio', 'portfoliourl', 'website', 'personalwebsite'], value: (p) => p?.portfolioUrl },
    { keys: ['github', 'githuburl'], value: (p) => p?.githubUrl },
    { keys: ['yearsofexperience', 'experienceyears', 'yearsexperience'], value: (p) => p?.yearsOfExperience },
  ];

  function findLabel(el) {
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) return lbl.textContent || '';
    }
    const parent = el.closest('label');
    if (parent) return parent.textContent || '';
    const prev = el.previousElementSibling;
    if (prev && prev.tagName === 'LABEL') return prev.textContent || '';
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder;
    return '';
  }

  function setValue(el, value) {
    if (value == null || value === '') return false;
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, String(value)); else el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function findLabelRaw(el) {
    return (typeof findLabel === 'function') ? findLabel(el) : (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || '');
  }

  async function askAI(question, profile) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'AI_SCREENING_ANSWER', payload: { question, jobDescription: (document.body?.innerText || '').slice(0, 4000), profile } },
        (res) => resolve(res?.ok ? (res.answer || '') : '')
      );
    });
  }

  async function runAutoFill(profileOverride) {
    let profile = profileOverride;
    if (!profile) {
      const stored = await new Promise((resolve) => chrome.storage.local.get('techia_profile', (r) => resolve(r.techia_profile || {})));
      profile = stored || {};
    }
    const fields = Array.from(document.querySelectorAll('input, textarea, select'));
    for (const el of fields) {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'file') continue;
      const rawLabel = findLabelRaw(el);
      const label = normalizeLabel(rawLabel + ' ' + (el.name || '') + ' ' + (el.id || ''));
      let matched = false;
      for (const entry of FIELD_MAP) {
        if (entry.keys.some((k) => label.includes(k))) {
          matched = true;
          const val = entry.value(profile);
          if (val != null && val !== '') {
            setValue(el, val);
            el.classList.remove('techia-highlight');
          }
          break;
        }
      }
      if (!matched && (el.tagName === 'TEXTAREA' || type === 'text') && !el.value) {
        // Ask AI for custom screening questions
        const answer = await askAI(rawLabel || 'this field', profile);
        if (answer) {
          setValue(el, answer);
          el.classList.remove('techia-highlight');
        } else {
          el.classList.add('techia-highlight');
        }
      }
    }
    // Highlight remaining empty text fields for review
    fields.forEach((el) => {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'file') return;
      if (!el.value && (el.tagName === 'TEXTAREA' || type === 'text')) {
        el.classList.add('techia-highlight');
      }
    });
  }
})();

