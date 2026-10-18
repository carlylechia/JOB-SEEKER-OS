'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'techia-theme';

/**
 * Blocking script injected in the document <head>. It is the only thing running
 * before React hydrates, so it is what prevents a flash of the wrong theme. It
 * deliberately duplicates the resolution order in `readStoredTheme` /
 * `systemTheme` below — keep the two in sync. Every branch sets `data-theme`,
 * including when storage is unavailable.
 */
export const themeInitScript = `(function(){var d=document.documentElement;var t='light';try{
var s=localStorage.getItem('${STORAGE_KEY}');
if(s==='light'||s==='dark'){t=s;}
else{t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
}catch(e){
try{t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}catch(e2){}
}
d.setAttribute('data-theme',t);})();`;

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  /** False until the client has read the persisted preference. */
  mounted: boolean;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
  toggleTheme: () => {},
  mounted: false,
});

function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  // Keeps the mobile browser chrome in step with the page.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#08111f' : '#FAFAF7';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);

  // Adopt whatever the pre-hydration script already decided, so the first
  // client render matches the DOM and React never reports a mismatch.
  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' || current === 'light' ? current : (readStoredTheme() ?? systemTheme());
    setThemeState(next);
    applyTheme(next);
    setMounted(true);
  }, []);

  // Follow the OS only while the user has not made an explicit choice.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => {
      if (readStoredTheme()) return;
      const next: Theme = event.matches ? 'dark' : 'light';
      setThemeState(next);
      applyTheme(next);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // Keep multiple tabs/windows consistent.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const next = readStoredTheme() ?? systemTheme();
      setThemeState(next);
      applyTheme(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    const root = document.documentElement;
    // Animate the swap once, then release so hover transitions stay snappy.
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), 260);
    setThemeState(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode — the theme still applies for this session */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme, mounted }),
    [theme, setTheme, toggleTheme, mounted],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}