import { AlertTriangle, CheckCircle2, CircleHelp, Quote, ShieldCheck } from 'lucide-react';
import type {
  CompanyClaim,
  PackDetail,
  PrepContent,
  ResearchSource,
} from './types';
import {
  BasisPill,
  Bullets,
  Card,
  EmptyState,
  EvidencePill,
  Pill,
  PriorityPill,
  SectionHeading,
  SourceRefs,
  Stat,
  formatLongDate,
  formatShortDate,
} from './ui';
import { InterviewTypeSummary } from './interview-type-picker';

const RESEARCH_LABELS: Record<string, string> = {
  NOT_STARTED: 'Research not started',
  COMPLETED: 'Research complete',
  PARTIAL: 'Partial research',
  NOT_AVAILABLE: 'No research sources supplied',
  FAILED: 'Research unavailable',
};

const RESEARCH_TONES: Record<string, 'neutral' | 'success' | 'warn' | 'danger'> = {
  NOT_STARTED: 'neutral',
  COMPLETED: 'success',
  PARTIAL: 'warn',
  NOT_AVAILABLE: 'neutral',
  FAILED: 'danger',
};

function ClaimCard({
  claim,
  sources,
}: {
  claim: CompanyClaim;
  sources: ResearchSource[];
}) {
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-ink">{claim.claim}</p>
        <BasisPill basis={claim.basis} />
      </div>
      {claim.whyItMatters ? <p className="muted mt-2 text-xs">{claim.whyItMatters}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <SourceRefs indexes={claim.sourceIndexes} sources={sources} />
      </div>
    </div>
  );
}

function ClaimGroup({
  title,
  claims,
  sources,
}: {
  title: string;
  claims: CompanyClaim[];
  sources: ResearchSource[];
}) {
  if (claims.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="grid gap-2 lg:grid-cols-2">
        {claims.map((claim, index) => (
          <ClaimCard key={`${claim.claim}-${index}`} claim={claim} sources={sources} />
        ))}
      </div>
    </div>
  );
}

export function ReadinessPanel({ detail }: { detail: PackDetail }) {
  const readiness = detail.readiness;
  const percent = readiness.preparationCoverage.percent;
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeading
          title="Readiness snapshot"
          description="Based on the work you have actually completed in this pack — not a prediction of the interview outcome."
        />
        <Pill tone={readiness.level === 'WELL_PREPARED' ? 'success' : readiness.level === 'STARTING' ? 'warn' : 'info'}>
          {readiness.levelLabel}
        </Pill>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Stat
          label="Preparation plan"
          value={percent === null ? 'Not generated' : `${percent}%`}
          hint={readiness.preparationCoverage.label}
          tone={percent !== null && percent >= 60 ? 'success' : percent !== null && percent > 0 ? 'warn' : 'neutral'}
        />
        <Stat
          label="Practice evidence"
          value={`${readiness.practiceEvidence.questionsAttempted}/${readiness.practiceEvidence.questionCount}`}
          hint={readiness.practiceEvidence.label}
        />
        <Stat
          label="Company research"
          value={readiness.researchCompleteness.sourcesAvailable}
          hint={readiness.researchCompleteness.label}
          tone={readiness.researchCompleteness.status === 'COMPLETED' ? 'success' : researchTone(readiness.researchCompleteness.status)}
        />
      </div>

      {readiness.outstandingHighPriority.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold">Outstanding high-priority work</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {readiness.outstandingHighPriority.slice(0, 4).map((task) => (
              <li key={task.id} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-danger" aria-hidden />
                <span>
                  {task.title} <span className="text-muted">· {task.estimatedMinutes} min</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {readiness.unresolvedGaps.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold">Open evidence gaps</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {readiness.unresolvedGaps.slice(0, 4).map((gap, index) => (
              <li key={`${gap.gap}-${index}`} className="flex items-start gap-2">
                <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn-text" aria-hidden />
                <span>
                  {gap.gap} <span className="text-muted">→ {gap.action}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {readiness.limitations.length > 0 ? (
        <p className="rounded-lg bg-surface-sunken p-3 text-xs text-muted">
          {readiness.limitations.join(' ')}
        </p>
      ) : null}
    </Card>
  );
}

function researchTone(status: string): 'neutral' | 'success' | 'warn' | 'danger' {
  return RESEARCH_TONES[status] ?? 'neutral';
}

export function BriefingSection({ detail }: { detail: PackDetail }) {
  const content = detail.data.content;
  if (!content) {
    return (
      <EmptyState
        title="The briefing is not ready yet"
        description="Generate or regenerate the pack to build the employer briefing, role analysis and preparation plan."
      />
    );
  }
  const briefing = content.briefing;

  return (
    <div className="space-y-4">
      <InterviewTypeSummary context={detail.data.context} />
      <Card className="space-y-3">
        <SectionHeading
          title="The short version"
          description="What matters most for this interview, based only on the job posting, your evidence and the sources you supplied."
        />
        <p className="text-sm leading-6 text-ink">{briefing.summary}</p>
        <div className="rounded-xl border border-accent/25 bg-accent/[0.06] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-accent-text">Do this next</p>
          <p className="mt-1 text-sm text-ink">{briefing.nextAction}</p>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">Top priorities</h3>
          {briefing.topPriorities.length === 0 ? (
            <p className="muted text-sm">No priorities were identified from the available material.</p>
          ) : (
            <ol className="space-y-3">
              {briefing.topPriorities.map((priority, index) => (
                <li key={`${priority.title}-${index}`} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-medium">{priority.title}</p>
                    <PriorityPill priority={priority.priority} />
                  </div>
                  <p className="muted mt-1 text-xs">{priority.why}</p>
                  <p className="mt-2 text-[11px] uppercase tracking-wide text-muted">
                    Basis: {priority.basis.replaceAll('_', ' ').toLowerCase()}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">Strongest evidence you already have</h3>
          {briefing.strongestEvidence.length === 0 ? (
            <p className="muted text-sm">
              Nothing in your profile was clear enough to highlight. Adding specific projects and outcomes
              will make the pack more personal.
            </p>
          ) : (
            <ul className="space-y-3">
              {briefing.strongestEvidence.map((item, index) => (
                <li key={`${item.theme}-${index}`} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{item.theme}</p>
                    <VerificationPill verification={item.verification} />
                  </div>
                  {item.evidenceQuote ? (
                    <blockquote className="mt-2 border-l-2 border-accent/40 pl-3 text-xs italic text-muted">
                      “{item.evidenceQuote}”
                    </blockquote>
                  ) : null}
                  <p className="muted mt-2 text-xs">{item.explanation}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">Evidence gaps to prepare around</h3>
          {briefing.gaps.length === 0 ? (
            <p className="muted text-sm">No material gaps were identified from the job description.</p>
          ) : (
            <ul className="space-y-3">
              {briefing.gaps.map((gap, index) => (
                <li key={`${gap.gap}-${index}`} className="rounded-xl border border-warn/25 bg-warn/[0.04] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{gap.gap}</p>
                    <EvidencePill status={gap.evidenceStatus} />
                  </div>
                  <p className="muted mt-1 text-xs">{gap.preparationAction}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">Company facts worth knowing</h3>
          {briefing.keyCompanyFacts.length === 0 ? (
            <p className="muted text-sm">
              No company-specific facts were included. Supply official company pages to improve this section.
            </p>
          ) : (
            <ul className="space-y-2">
              {briefing.keyCompanyFacts.map((fact, index) => (
                <li key={`${fact.fact}-${index}`} className="rounded-xl border border-line p-3 text-sm">
                  {fact.fact}
                  <div className="mt-2">
                    <SourceRefs indexes={fact.sourceIndexes} sources={detail.sources} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {detail.data.preparationGuidance ? (
        <Card>
          <h3 className="text-sm font-semibold">Preparation guidance</h3>
          <p className="muted mt-2 text-sm leading-6">{detail.data.preparationGuidance}</p>
        </Card>
      ) : null}

      <ReadinessPanel detail={detail} />
    </div>
  );
}

function VerificationPill({ verification }: { verification: string }) {
  if (verification === 'CONFIRMED_PROFILE') {
    return <Pill tone="success">Confirmed in your profile</Pill>;
  }
  if (verification === 'UNCONFIRMED_PROFILE') {
    return <Pill tone="warn">Needs your confirmation</Pill>;
  }
  return <Pill tone="neutral">Add your own details</Pill>;
}

export function CompanySection({ detail }: { detail: PackDetail }) {
  const content = detail.data.content;
  if (!content) {
    return (
      <EmptyState
        title="Company research is not ready"
        description="Generate the pack to build a research dossier. Without supplied sources, it will rely on the job description and will say so."
      />
    );
  }

  const company = content.company;
  const groups: Array<{ title: string; claims: CompanyClaim[] }> = [
    { title: 'Overview', claims: company.overview ? [company.overview] : [] },
    { title: 'Products and services', claims: company.products },
    { title: 'Customers', claims: company.customers ? [company.customers] : [] },
    { title: 'Mission and purpose', claims: company.mission ? [company.mission] : [] },
    { title: 'Values', claims: company.values },
    { title: 'Culture notes', claims: company.cultureNotes },
  ];

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            title="Company research"
            description="Claims marked source-backed are tied to a page you supplied. Everything else is an inference and should be verified before you rely on it."
          />
          <Pill tone={researchTone(company.researchStatus)}>
            {RESEARCH_LABELS[company.researchStatus] ?? company.researchStatus}
          </Pill>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label="Sources supplied" value={company.sourceCount} />
          <Stat label="Sources read" value={company.fetchedSourceCount} tone={company.fetchedSourceCount > 0 ? 'success' : 'neutral'} />
          <Stat
            label="Research status"
            value={RESEARCH_LABELS[company.researchStatus] ?? company.researchStatus}
            tone={researchTone(company.researchStatus)}
          />
        </div>
        {company.researchLimitations.length > 0 ? (
          <ul className="space-y-1 rounded-xl bg-surface-sunken p-3 text-xs text-muted">
            {company.researchLimitations.map((limitation, index) => (
              <li key={`${limitation}-${index}`}>• {limitation}</li>
            ))}
          </ul>
        ) : null}
      </Card>

      {groups.map((group) => (
        <ClaimGroup key={group.title} title={group.title} claims={group.claims} sources={detail.sources} />
      ))}

      {company.recentDevelopments.length > 0 ? (
        <Card className="space-y-2">
          <h3 className="text-sm font-semibold">Recent developments</h3>
          <div className="grid gap-2 lg:grid-cols-2">
            {company.recentDevelopments.map((item, index) => (
              <div key={`${item.title}-${index}`} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-medium">{item.title}</p>
                  <BasisPill basis={item.basis} />
                </div>
                {item.date ? <p className="mt-1 text-xs text-muted">{item.date}</p> : null}
                <p className="muted mt-1 text-xs">{item.summary}</p>
                <div className="mt-2">
                  <SourceRefs indexes={item.sourceIndexes} sources={detail.sources} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {company.roleContext.length > 0 ? (
        <Card>
          <h3 className="text-sm font-semibold">How this role fits the company</h3>
          <Bullets items={company.roleContext} className="mt-2" />
        </Card>
      ) : null}

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-accent-text" aria-hidden />
          <h3 className="text-sm font-semibold">Draft: “Why this company?”</h3>
        </div>
        <p className="muted text-sm">
          This is a scaffold, not a script. The bracketed parts are for your own experience; do not repeat
          the draft verbatim.
        </p>
        <p className="whitespace-pre-wrap rounded-xl border border-line bg-surface-sunken/40 p-3 text-sm">
          {company.whyThisCompanyDraft || 'No draft was generated from the available material.'}
        </p>
        {company.whyThisCompanyPlaceholders.length > 0 ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Personal details to add</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {company.whyThisCompanyPlaceholders.map((placeholder, index) => (
                <span key={`${placeholder}-${index}`} className="badge bg-accent/10 text-accent-text">
                  {placeholder}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export function RoleSection({ detail }: { detail: PackDetail }) {
  const content = detail.data.content;
  if (!content) {
    return (
      <EmptyState
        title="Role analysis is not ready"
        description="Generate the pack to analyse the job requirements, your evidence and the likely challenges."
      />
    );
  }
  const role = content.role;

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading title="What the role actually asks for" description={role.summary} />
          <Pill tone="neutral">{role.occupationalFamily}</Pill>
        </div>
        {role.responsibilities.length > 0 ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold">Responsibilities</h3>
            <Bullets items={role.responsibilities} />
          </div>
        ) : null}
        {role.likelyChallenges.length > 0 ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold">Likely challenges</h3>
            <Bullets items={role.likelyChallenges} />
          </div>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <h3 className="text-sm font-semibold">Requirements and your evidence</h3>
        <p className="muted text-sm">
          Evidence is only marked “demonstrated” when a quote from your profile or resume supports it.
          Missing evidence is a preparation task, not a rejection.
        </p>
        <div className="space-y-3">
          {role.requirements.map((requirement, index) => (
            <div key={`${requirement.requirement}-${index}`} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-medium">{requirement.requirement}</p>
                <div className="flex flex-wrap gap-1">
                  <Pill tone={requirement.importance === 'CRITICAL' ? 'danger' : requirement.importance === 'IMPORTANT' ? 'warn' : 'neutral'}>
                    {requirement.importance.toLowerCase()}
                  </Pill>
                  <Pill tone={requirement.requirementType === 'EXPLICIT' ? 'info' : 'neutral'}>
                    {requirement.requirementType.toLowerCase()}
                  </Pill>
                  <EvidencePill status={requirement.evidenceStatus} />
                </div>
              </div>

              {requirement.sourceQuote ? (
                <p className="mt-2 flex gap-2 text-xs text-muted">
                  <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>Job posting: “{requirement.sourceQuote}”</span>
                </p>
              ) : null}
              {requirement.evidenceQuote ? (
                <p className="mt-2 rounded-lg bg-success/[0.06] p-2 text-xs text-ink">
                  Your evidence ({requirement.evidenceSource?.toLowerCase().replace('_', ' ')}): “
                  {requirement.evidenceQuote}”
                </p>
              ) : requirement.evidenceExplanation ? (
                <p className="muted mt-2 text-xs">{requirement.evidenceExplanation}</p>
              ) : null}
              {requirement.gap ? <p className="mt-2 text-xs text-warn-text">Gap: {requirement.gap}</p> : null}
              <p className="mt-2 text-xs">
                <span className="font-medium">Preparation: </span>
                {requirement.preparationAction}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {role.competencies.length > 0 ? (
        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">Competencies the interview is likely to test</h3>
          <div className="grid gap-2 lg:grid-cols-2">
            {role.competencies.map((competency, index) => (
              <div key={`${competency.name}-${index}`} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-medium">{competency.name}</p>
                  <Pill tone="neutral">{competency.evidenceBasis.replaceAll('_', ' ').toLowerCase()}</Pill>
                </div>
                <p className="muted mt-1 text-xs">{competency.why}</p>
                {competency.evidenceQuote ? (
                  <p className="mt-2 text-xs">Your evidence: “{competency.evidenceQuote}”</p>
                ) : null}
                {competency.strongAnswerShows ? (
                  <p className="mt-2 text-xs">
                    <span className="font-medium">A strong answer shows: </span>
                    {competency.strongAnswerShows}
                  </p>
                ) : null}
                {competency.practiceAdvice ? (
                  <p className="muted mt-1 text-xs">{competency.practiceAdvice}</p>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export function EvidenceSection({ detail }: { detail: PackDetail }) {
  const content = detail.data.content;
  if (!content) {
    return (
      <EmptyState
        title="Evidence bank is not ready"
        description="Generate the pack to map your existing projects and experience to this role."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeading
          title="Evidence bank"
          description="Concrete material from your profile and resume that can support answers. We do not invent stories, metrics or outcomes — anything missing is listed for you to complete."
        />
      </Card>

      {content.evidenceBank.length === 0 ? (
        <EmptyState
          title="No usable evidence was found"
          description="Add projects, roles and outcomes to your career profile or resume, then regenerate the pack."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {content.evidenceBank.map((item, index) => (
            <Card key={`${item.title}-${index}`} className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">{item.theme}</p>
                  <h3 className="text-sm font-semibold">{item.title}</h3>
                </div>
                <VerificationPill verification={item.verification} />
              </div>
              {item.evidenceQuote ? (
                <blockquote className="border-l-2 border-accent/40 pl-3 text-xs italic text-muted">
                  “{item.evidenceQuote}”
                </blockquote>
              ) : null}
              <p className="text-sm">{item.evidenceNote}</p>
              <p className="muted text-xs">{item.whatItSupports}</p>
              {item.evidenceQuote ? (
                <p className="text-xs text-muted">
                  <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-success-text" aria-hidden />
                  {item.sourceLabel}
                </p>
              ) : (
                <p className="text-xs text-muted">
                  <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-warn-text" aria-hidden />
                  Source: {item.sourceLabel}
                </p>
              )}
              {item.missingDetails.length > 0 ? (
                <div className="rounded-lg bg-surface-sunken p-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Details to add yourself
                  </p>
                  <Bullets items={item.missingDetails} className="mt-1 text-xs" />
                </div>
              ) : null}
              {item.competencies.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {item.competencies.map((competency) => (
                    <Pill key={competency} tone="neutral">
                      {competency}
                    </Pill>
                  ))}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <Card className="space-y-3">
        <h3 className="text-sm font-semibold">Questions to ask the employer</h3>
        {content.employerQuestions.length === 0 ? (
          <p className="muted text-sm">No employer questions were generated from the available material.</p>
        ) : (
          <ul className="space-y-2">
            {content.employerQuestions.map((question, index) => (
              <li key={`${question.question}-${index}`} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-medium">{question.question}</p>
                  <Pill tone="neutral">{question.category.toLowerCase()}</Pill>
                </div>
                <p className="muted mt-1 text-xs">{question.why}</p>
                <div className="mt-2">
                  <SourceRefs indexes={question.sourceIndexes} sources={detail.sources} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {content.logistics.length > 0 ? (
        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">Logistics and practical preparation</h3>
          <div className="grid gap-2 lg:grid-cols-2">
            {content.logistics.map((item, index) => (
              <div key={`${item.topic}-${index}`} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{item.topic}</p>
                  <Pill tone="neutral">{item.basis.replaceAll('_', ' ').toLowerCase()}</Pill>
                </div>
                <p className="muted mt-1 text-xs">{item.guidance}</p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export function SourcesSection({ detail }: { detail: PackDetail }) {
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <SectionHeading
          title="Sources and provenance"
          description="Every source we attempted is listed, including failures. Company claims are only marked source-backed when one of these pages supports them."
        />
        <p className="rounded-xl bg-surface-sunken p-3 text-xs text-muted">
          There is no web search in this product. We fetch only URLs you supply, over public http(s), with
          private-network, redirect, size and timeout protections. A failed fetch is shown here rather than
          silently replaced with invented research.
        </p>
      </Card>

      {detail.sources.length === 0 ? (
        <EmptyState
          title="No research sources were supplied"
          description="The pack was generated from the job description and your profile. Add official company pages and regenerate for a research-backed briefing."
        />
      ) : (
        <div className="space-y-2">
          {detail.sources.map((source, index) => (
            <Card key={source.id} className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">
                    Source {index + 1} · {source.kind.replaceAll('_', ' ').toLowerCase()}
                  </p>
                  <p className="text-sm font-semibold">{source.title}</p>
                  {source.publisher ? <p className="text-xs text-muted">{source.publisher}</p> : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Pill tone={source.fetchStatus === 'FETCHED' ? 'success' : source.fetchStatus === 'FAILED' ? 'danger' : 'info'}>
                    {source.fetchStatus.replaceAll('_', ' ').toLowerCase()}
                  </Pill>
                  <Pill tone={source.verification === 'SOURCE_BACKED' ? 'success' : 'neutral'}>
                    {source.verification.replaceAll('_', ' ').toLowerCase()}
                  </Pill>
                </div>
              </div>
              {source.url ? (
                <a
                  className="block break-all text-xs text-accent-text underline decoration-accent/40 underline-offset-2"
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {source.canonicalUrl ?? source.url}
                </a>
              ) : null}
              {source.excerpt ? <p className="text-xs leading-5 text-muted">{source.excerpt}</p> : null}
              {source.errorCode ? (
                <p className="text-xs text-danger-text">Could not use this source: {source.errorCode}</p>
              ) : null}
              <p className="text-[11px] text-muted">
                {source.retrievedAt ? `Retrieved ${formatShortDate(source.retrievedAt)}` : 'Not retrieved'}
                {source.publishedAt ? ` · Published ${formatShortDate(source.publishedAt)}` : ''}
              </p>
            </Card>
          ))}
        </div>
      )}

      {detail.data.limitations.length > 0 ? (
        <Card>
          <h3 className="text-sm font-semibold">Pack limitations</h3>
          <Bullets items={detail.data.limitations} className="mt-2" />
        </Card>
      ) : null}
    </div>
  );
}

export function PreparationDetails({ content }: { content: PrepContent | null }) {
  if (!content) return null;
  return (
    <div className="space-y-4">
      <ReadinessPanelShell content={content} />
    </div>
  );
}

function ReadinessPanelShell({ content }: { content: PrepContent }) {
  return (
    <Card className="space-y-2">
      <h3 className="text-sm font-semibold">Interview logistics</h3>
      {content.logistics.length === 0 ? (
        <p className="muted text-sm">No logistics guidance was generated.</p>
      ) : (
        <Bullets items={content.logistics.map((item) => `${item.topic}: ${item.guidance}`)} />
      )}
    </Card>
  );
}

export function headerSubtitle(detail: PackDetail): string {
  const parts = [detail.data.company, detail.data.roleTitle];
  if (detail.data.location) parts.push(detail.data.location);
  const interview = formatLongDate(detail.data.interviewAt);
  if (interview) parts.push(`Interview ${interview}`);
  return parts.filter(Boolean).join(' · ');
}
