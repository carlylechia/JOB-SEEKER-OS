'use client';

import { defaultTimezoneOptions } from '@/lib/preferences';

type RemotePreference = 'REMOTE' | 'HYBRID' | 'ONSITE' | 'FLEXIBLE';

type Props = {
  location: string;
  remotePreference: RemotePreference;
  timezones: string[];
  onLocationChange: (v: string) => void;
  onRemoteChange: (v: RemotePreference) => void;
  onTimezonesChange: (v: string[]) => void;
};

const REMOTE_OPTIONS: { value: RemotePreference; label: string; desc: string; icon: string }[] = [
  { value: 'REMOTE', label: 'Remote', desc: 'Work from anywhere', icon: '🌍' },
  { value: 'HYBRID', label: 'Hybrid', desc: 'Mix of home + office', icon: '🏠' },
  { value: 'ONSITE', label: 'On-site', desc: 'In-office preferred', icon: '🏢' },
  { value: 'FLEXIBLE', label: 'Flexible', desc: 'Open to any arrangement', icon: '✨' },
];

export function StepLocation({
  location,
  remotePreference,
  timezones,
  onLocationChange,
  onRemoteChange,
  onTimezonesChange,
}: Props) {
  function toggleTimezone(tz: string) {
    if (timezones.includes(tz)) {
      onTimezonesChange(timezones.filter((t) => t !== tz));
    } else if (timezones.length < 5) {
      onTimezonesChange([...timezones, tz]);
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mb-3 text-5xl">📍</div>
        <h2 className="text-2xl font-bold tracking-tight text-ink">Where are you based?</h2>
        <p className="mt-2 text-sm text-muted">
          This helps us surface roles that match your location and work style.
        </p>
      </div>

      {/* Location input */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink">Your city / region</label>
        <input
          className="input"
          type="text"
          value={location}
          onChange={(e) => onLocationChange(e.target.value)}
          placeholder="e.g. Lagos, Nigeria  ·  New York, US  ·  Berlin, Germany"
          autoComplete="off"
        />
      </div>

      {/* Remote preference cards */}
      <div>
        <label className="mb-3 block text-sm font-medium text-ink">Work preference</label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {REMOTE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onRemoteChange(opt.value)}
              className={[
                'flex flex-col items-center gap-1.5 rounded-2xl border px-3 py-4 text-center transition-all',
                remotePreference === opt.value
                  ? 'border-accent bg-accent/10 text-ink ring-1 ring-accent/30'
                  : 'border-line bg-white/5 text-muted hover:border-white/20 hover:bg-white/10',
              ].join(' ')}
            >
              <span className="text-2xl">{opt.icon}</span>
              <span className="text-sm font-semibold">{opt.label}</span>
              <span className="text-xs text-muted">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Timezone multi-select */}
      <div>
        <label className="mb-1 block text-sm font-medium text-ink">Timezone overlaps</label>
        <p className="mb-3 text-xs text-muted">Select up to 5 timezone windows that work for you.</p>
        <div className="flex flex-wrap gap-2">
          {defaultTimezoneOptions.map((tz) => {
            const selected = timezones.includes(tz);
            return (
              <button
                key={tz}
                type="button"
                onClick={() => toggleTimezone(tz)}
                className={[
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-all',
                  selected
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-line bg-white/5 text-muted hover:border-white/20 hover:bg-white/10',
                ].join(' ')}
              >
                {tz}
              </button>
            );
          })}
        </div>
        {timezones.length >= 5 && (
          <p className="mt-2 text-xs text-amber-400">Maximum of 5 timezones selected.</p>
        )}
      </div>
    </div>
  );
}
