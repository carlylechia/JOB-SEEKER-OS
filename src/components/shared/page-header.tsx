export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="title">{title}</h1>
        {subtitle ? <p className="mt-1 muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
