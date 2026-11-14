/**
 * Platform-aware install guidance.
 *
 * Shared by the client install highlight and the server-side welcome
 * notification so both describe the same OS-specific flow. Keep this free of
 * browser-only APIs: it must run in a Node route handler too.
 */

export type Platform = 'ios' | 'android' | 'mac' | 'windows' | 'linux' | 'unknown';

export function detectPlatform(userAgent: string | null | undefined): Platform {
  const ua = (userAgent ?? '').toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  if (/mac os x/.test(ua)) return 'mac';
  if (/windows/.test(ua)) return 'windows';
  if (/linux/.test(ua)) return 'linux';
  return 'unknown';
}

export const HOME_SCREEN_TITLE: Record<Platform, string> = {
  ios: 'Add teChia Jobs to your iPhone home screen',
  android: 'Add teChia Jobs to your Android home screen',
  mac: 'Install teChia Jobs on your Mac',
  windows: 'Install teChia Jobs on Windows',
  linux: 'Install teChia Jobs on Linux',
  unknown: 'Add teChia Jobs to your home screen',
};

export const HOME_SCREEN_STEPS: Record<Platform, string[]> = {
  ios: [
    'Open this site in Safari.',
    'Tap the Share button (the square with an arrow).',
    'Choose "Add to Home Screen", then tap Add.',
  ],
  android: [
    'Open this site in Chrome.',
    'Tap the three-dot menu.',
    'Choose "Install app" or "Add to Home screen".',
  ],
  mac: [
    'Open this site in Chrome or Edge.',
    'Click the install icon in the address bar (or use the browser menu).',
    'Confirm "Install teChia Jobs" to add it to your Dock and Launchpad.',
  ],
  windows: [
    'Open this site in Chrome or Edge.',
    'Click the install icon in the address bar.',
    'Confirm to add teChia Jobs to your Start menu and desktop.',
  ],
  linux: [
    'Open this site in Chrome or Edge.',
    'Use the browser menu and choose "Install teChia Jobs".',
    'Confirm to add a launcher to your applications menu.',
  ],
  unknown: [
    'Open this site in your browser.',
    'Use the browser menu and choose "Install" or "Add to Home Screen".',
  ],
};

/** A short, OS-aware nudge suitable for an in-app notification message. */
export function installNudgeMessage(platform: Platform): string {
  const firstStep = HOME_SCREEN_STEPS[platform][0];
  switch (platform) {
    case 'ios':
      return `For the best experience, add teChia Jobs to your home screen: ${firstStep} then tap Share → Add to Home Screen.`;
    case 'android':
      return `For the best experience, install teChia Jobs: ${firstStep} then tap the menu → Install app.`;
    default:
      return `For the best experience, install teChia Jobs from your browser: ${firstStep} then confirm the install prompt.`;
  }
}
