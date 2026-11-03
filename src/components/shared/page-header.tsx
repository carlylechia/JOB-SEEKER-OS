export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="title break-words">{title}</h1>
        {subtitle ? <p className="mt-1 muted break-words">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
