'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  DragStartEvent,
  DragEndEvent,
  closestCenter,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { PageHeader } from '@/components/shared/page-header';
import { ScoreBadge } from '@/components/shared/score-badge';
import { useJobs } from '@/hooks/use-job-data';
import { JobLead, JobStatus } from '@/types';

type Column = {
  key: string;
  label: string;
  statuses: JobStatus[];
  color: string;
  dropStatus: JobStatus; // the status to assign when dropping into this column
};

const COLUMNS: Column[] = [
  { key: 'saved',     label: 'Saved',     statuses: ['LEAD', 'SAVED'],           color: 'border-sky-500/40 bg-sky-500/5',      dropStatus: 'SAVED' },
  { key: 'applied',   label: 'Applied',   statuses: ['APPLYING', 'APPLIED'],     color: 'border-amber-500/40 bg-amber-500/5',  dropStatus: 'APPLIED' },
  { key: 'interview', label: 'Interview', statuses: ['INTERVIEWING'],            color: 'border-violet-500/40 bg-violet-500/5', dropStatus: 'INTERVIEWING' },
  { key: 'offer',     label: 'Offer',     statuses: ['OFFER'],                   color: 'border-emerald-500/40 bg-emerald-500/5', dropStatus: 'OFFER' },
  { key: 'rejected',  label: 'Rejected',  statuses: ['REJECTED', 'ARCHIVED'],   color: 'border-white/10 bg-white/5',          dropStatus: 'REJECTED' },
];

const ALL_STATUSES: JobStatus[] = ['LEAD', 'SAVED', 'APPLYING', 'APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED', 'ARCHIVED'];

// ─── Draggable card ───────────────────────────────────────────────────────────

function JobCard({
  job,
  onMove,
  isDragOverlay = false,
}: {
  job: JobLead;
  onMove: (id: string, status: JobStatus) => void;
  isDragOverlay?: boolean;
}) {
  const [moving, setMoving] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: job.id });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.35 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  };

  async function handleMove(e: React.ChangeEvent<HTMLSelectElement>) {
    setMoving(true);
    try {
      await onMove(job.id, e.target.value as JobStatus);
    } finally {
      setMoving(false);
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={isDragOverlay ? { cursor: 'grabbing' } : style}
      {...listeners}
      {...attributes}
      className={`rounded-xl border border-line bg-white/5 p-3 space-y-2 select-none touch-none
        ${isDragOverlay ? 'shadow-soft ring-1 ring-accent/40 rotate-1 scale-[1.02]' : 'hover:border-white/20 transition-colors'}`}
    >
      <Link
        href={`/jobs/${job.id}`}
        className="block hover:text-accent"
        onClick={(e) => e.stopPropagation()}
        // prevent drag from navigating
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="font-medium leading-tight">{job.title}</div>
        <div className="text-sm text-muted">{job.company}</div>
      </Link>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <ScoreBadge score={job.score.fitScore} tier={job.score.fitTier} />
        {/* stop drag from triggering when interacting with the select */}
        <div onPointerDown={(e) => e.stopPropagation()}>
          <select
            className="input py-0.5 px-2 text-xs h-7 w-auto"
            value={job.status}
            disabled={moving}
            onChange={handleMove}
            aria-label="Move to status"
          >
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
            ))}
          </select>
        </div>
      </div>
      {job.nextFollowUp && (
        <div className="text-xs text-muted">Follow-up: {job.nextFollowUp}</div>
      )}
    </div>
  );
}

// ─── Droppable column ─────────────────────────────────────────────────────────

function KanbanColumn({
  col,
  jobs,
  onMove,
  isOver,
}: {
  col: Column;
  jobs: JobLead[];
  onMove: (id: string, status: JobStatus) => void;
  isOver: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: col.key });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-2xl border p-3 transition-colors min-h-[120px]
        ${col.color}
        ${isOver ? 'ring-2 ring-accent/50 brightness-110' : ''}`}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">{col.label}</h3>
        <span className="text-xs text-muted bg-white/10 rounded-full px-2 py-0.5">{jobs.length}</span>
      </div>
      <div className="space-y-3">
        {jobs.length ? (
          jobs.map((job) => (
            <JobCard key={job.id} job={job} onMove={onMove} />
          ))
        ) : (
          <div className={`text-xs text-muted py-8 text-center rounded-xl border border-dashed
            ${isOver ? 'border-accent/40 text-accent/60' : 'border-white/10'}`}>
            {isOver ? 'Drop here' : 'Empty'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const { jobs, patchStatus, isLoading } = useJobs();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  if (isLoading) return <div className="card-pad">Loading pipeline…</div>;

  const activeJob = activeId ? jobs.find((j) => j.id === activeId) : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    setOverId(null);
    if (!over) return;
    const targetCol = COLUMNS.find((c) => c.key === over.id);
    if (!targetCol) return;
    const draggedJob = jobs.find((j) => j.id === active.id);
    if (!draggedJob) return;
    if (targetCol.statuses.includes(draggedJob.status as JobStatus)) return; // no change
    await patchStatus(draggedJob.id, targetCol.dropStatus);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Job Pipeline"
        subtitle="Track every job from first look to final decision. Drag cards between columns to move them."
      />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={(e) => setOverId(e.over ? (e.over.id as string) : null)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => { setActiveId(null); setOverId(null); }}
      >
        <div className="grid gap-4 lg:grid-cols-5">
          {COLUMNS.map((col) => {
            const colJobs = jobs.filter((j) => col.statuses.includes(j.status as JobStatus));
            return (
              <KanbanColumn
                key={col.key}
                col={col}
                jobs={colJobs}
                onMove={patchStatus}
                isOver={overId === col.key}
              />
            );
          })}
        </div>

        <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
          {activeJob ? (
            <JobCard job={activeJob} onMove={patchStatus} isDragOverlay />
          ) : null}
        </DragOverlay>
      </DndContext>

      <p className="text-xs text-muted text-center">Tip: drag a card to a column to update its status, or use the dropdown on the card.</p>
    </div>
  );
}

