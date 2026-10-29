'use client';

import { Printer } from 'lucide-react';
import type { PackDetail } from './types';
import { Card, EmptyState, SectionHeading, formatLongDate } from './ui';

export function CheatSheetTab({ detail }: { detail: PackDetail }) {
  const content = detail.data.content;
  if (!content) {
    return (
      <EmptyState
        title="Cheat sheet not ready"
        description="Generate the pack to build a one-page summary you can print or keep open before the interview."
      />
    );
  }

  const sheet = content.cheatSheet;
  const interviewDate = formatLongDate(sheet.interviewAt);

  function printSheet() {
    window.print();
  }

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .interview-cheat-print, .interview-cheat-print * { visibility: visible !important; }
          .interview-cheat-print {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            background: #fff !important;
            color: #111 !important;
            padding: 28px !important;
            border: 0 !important;
            box-shadow: none !important;
          }
          .interview-cheat-print .cheat-muted { color: #555 !important; }
          .interview-cheat-print .cheat-line { border-color: #ddd !important; }
        }
      `}</style>

      <Card className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <SectionHeading
          title="One-page cheat sheet"
          description="Print it or keep it open in another window. Everything here is derived from this pack and is deliberately short."
        />
        <button type="button" className="btn-primary text-sm" onClick={printSheet}>
          <Printer className="mr-1 inline h-4 w-4" aria-hidden />
          Print cheat sheet
        </button>
      </Card>

      <div className="interview-cheat-print card-pad space-y-5">
        <header className="border-b cheat-line pb-3">
          <p className="text-xs font-semibold uppercase tracking-widest cheat-muted">Interview cheat sheet</p>
          <h2 className="mt-1 text-2xl font-bold">
            {sheet.companyName} — {sheet.roleTitle}
          </h2>
          {interviewDate ? <p className="mt-1 text-sm cheat-muted">{interviewDate}</p> : null}
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <SheetSection title="Company facts">
            {sheet.companyFacts.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {sheet.companyFacts.map((fact, index) => (
                  <li key={`${fact}-${index}`}>{fact}</li>
                ))}
              </ul>
            ) : (
              <p className="cheat-muted text-sm">No sourced company facts. Confirm the basics yourself.</p>
            )}
          </SheetSection>

          <SheetSection title="Competencies to demonstrate">
            {sheet.topCompetencies.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {sheet.topCompetencies.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="cheat-muted text-sm">No competencies were extracted.</p>
            )}
          </SheetSection>

          <SheetSection title="Examples to use">
            {sheet.strongestExamples.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {sheet.strongestExamples.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="cheat-muted text-sm">Add evidence to your profile, then regenerate.</p>
            )}
          </SheetSection>

          <SheetSection title="Questions to ask">
            {sheet.questionsToAsk.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {sheet.questionsToAsk.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="cheat-muted text-sm">No questions were generated.</p>
            )}
          </SheetSection>

          <SheetSection title="Logistics">
            {sheet.logistics.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {sheet.logistics.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="cheat-muted text-sm">No logistics notes.</p>
            )}
          </SheetSection>

          <SheetSection title="Reminders">
            {sheet.reminders.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {sheet.reminders.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="cheat-muted text-sm">No reminders.</p>
            )}
          </SheetSection>
        </div>

        {sheet.unknowns.length > 0 ? (
          <SheetSection title="Still unknown — confirm before the interview">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {sheet.unknowns.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          </SheetSection>
        ) : null}

        <footer className="border-t cheat-line pt-3">
          <p className="text-[11px] cheat-muted">{sheet.generatedNote}</p>
          {detail.data.limitations.length > 0 ? (
            <p className="mt-1 text-[11px] cheat-muted">{detail.data.limitations.join(' ')}</p>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

function SheetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-widest cheat-muted">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}
