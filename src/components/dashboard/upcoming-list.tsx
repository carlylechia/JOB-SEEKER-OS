import { Calendar, Mail } from 'lucide-react';

type Item = { label: string; meta: string; urgent?: boolean };

function isToday(meta: string) {
  const lower = meta.toLowerCase();
  return lower.includes('today') || lower.includes('tomorrow');
}

export function UpcomingList({
  title,
  items,
  icon: Icon = Calendar,
  accentColor = 'text-cyan-400',
  emptyText = 'Nothing due yet.',
}: {
  title: string;
  items: Item[];
  icon?: React.ElementType;
  accentColor?: string;
  emptyText?: string;
}) {
  return (
    <div className="card-pad">
      <div className="mb-4 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${accentColor}`} />
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {items.length > 0 && (
          <span className="ml-auto text-xs font-medium text-muted">{items.length}</span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const urgent = item.urgent ?? isToday(item.meta);
            return (
              <div
                key={`${item.label}-${item.meta}`}
                className={`rounded-xl border px-3 py-2.5 ${
                  urgent
                    ? 'border-amber-500/25 bg-amber-500/[0.07]'
                    : 'border-white/[0.07] bg-white/[0.03]'
                }`}
              >
                <p className="text-sm font-medium text-ink leading-tight">{item.label}</p>
                <p className={`mt-0.5 text-xs ${urgent ? 'text-amber-300' : 'text-muted'}`}>{item.meta}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
