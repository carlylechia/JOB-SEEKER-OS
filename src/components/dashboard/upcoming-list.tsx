export function UpcomingList({ title, items }: { title: string; items: { label: string; meta: string }[] }) {
  return (
    <div className="card-pad">
      <h3 className="text-lg font-semibold">{title}</h3>
      <div className="mt-4 space-y-3">
        {items.length ? items.map((item) => (
          <div key={`${item.label}-${item.meta}`} className="rounded-xl border border-line p-3">
            <div className="font-medium">{item.label}</div>
            <div className="muted mt-1">{item.meta}</div>
          </div>
        )) : <div className="muted">Nothing due yet.</div>}
      </div>
    </div>
  );
}
