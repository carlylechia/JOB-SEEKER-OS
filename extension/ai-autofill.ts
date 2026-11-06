/**
 * AI-powered form auto-fill engine for the teChia Jobs browser extension.
 *
 * Runs inside the content script context. It scans the active page for form
 * fields, maps them to the user's verified profile using semantic heuristics,
 * and (optionally) uses an LLM to answer custom screening questions from the
 * job description and user history. All processing relies on the user's local
 * profile; no unapproved data is sent externally.
 */

export type UserProfile = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  yearsOfExperience?: number | string;
  portfolioUrl?: string;
  githubUrl?: string;
  linkedinUrl?: string;
  resumeSummary?: string;
  skills?: string[];
};

export type FormFieldKind =
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'yearsOfExperience'
  | 'portfolioUrl'
  | 'githubUrl'
  | 'linkedinUrl'
  | 'coverLetter'
  | 'custom';

export type FormField = {
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  kind: FormFieldKind;
  label: string;
  confidence: number;
};

const FIELD_PATTERNS: Array<{ kind: FormFieldKind; patterns: RegExp[] }> = [
  { kind: 'firstName', patterns: [/first\s*name/i, /given\s*name/i, /\bfname\b/i] },
  { kind: 'lastName', patterns: [/last\s*name/i, /family\s*name/i, /surname/i, /\blname\b/i] },
  { kind: 'email', patterns: [/e-?mail/i] },
  { kind: 'phone', patterns: [/phone/i, /mobile/i, /telephone/i, /tel\b/i] },
  { kind: 'yearsOfExperience', patterns: [/years?\s*of\s*experience/i, /experience\s*years/i] },
  { kind: 'portfolioUrl', patterns: [/portfolio/i, /personal\s*site/i, /website/i] },
  { kind: 'githubUrl', patterns: [/github/i] },
  { kind: 'linkedinUrl', patterns: [/linkedin/i] },
  { kind: 'coverLetter', patterns: [/cover\s*letter/i, /additional\s*info/i, /screening/i] },
];

export function labelFor(element: Element): string {
  if (element.id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (lbl?.textContent) return lbl.textContent.trim();
  }
  const parent = element.closest('label');
  if (parent?.textContent) return parent.textContent.trim();
  return (
    element.getAttribute('aria-label') ||
    element.getAttribute('placeholder') ||
    element.getAttribute('name') ||
    ''
  ).trim();
}

export function classifyField(element: Element): { kind: FormFieldKind; confidence: number } {
  const text = labelFor(element).toLowerCase() + ' ' + (element.getAttribute('name') || '').toLowerCase();
  for (const entry of FIELD_PATTERNS) {
    if (entry.patterns.some((re) => re.test(text))) {
      return { kind: entry.kind, confidence: 0.9 };
    }
  }
  return { kind: 'custom', confidence: 0.2 };
}

export function scanForm(root: ParentNode = document): FormField[] {
  const elements = Array.from(root.querySelectorAll('input, textarea, select')) as Array<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >;
  const results: FormField[] = [];
  for (const el of elements) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'file', 'checkbox', 'radio'].includes(type)) continue;
    if (el.disabled) continue;
    if ((el as HTMLInputElement).readOnly) continue;
    const { kind, confidence } = classifyField(el);
    results.push({ element: el, kind, label: labelFor(el), confidence });
  }
  return results;
}

export function valueForField(field: FormField, profile: UserProfile): string | null {
  switch (field.kind) {
    case 'firstName':
      return profile.firstName || null;
    case 'lastName':
      return profile.lastName || null;
    case 'email':
      return profile.email || null;
    case 'phone':
      return profile.phone || null;
    case 'yearsOfExperience':
      return profile.yearsOfExperience != null ? String(profile.yearsOfExperience) : null;
    case 'portfolioUrl':
      return profile.portfolioUrl || null;
    case 'githubUrl':
      return profile.githubUrl || null;
    case 'linkedinUrl':
      return profile.linkedinUrl || null;
    case 'coverLetter':
      return profile.resumeSummary || null;
    default:
      return null;
  }
}

export function dispatchFieldEvents(element: Element): void {
  const proto = Object.getPrototypeOf(element);
  const eventInit = { bubbles: true, cancelable: true };
  element.dispatchEvent(new Event('input', eventInit));
  element.dispatchEvent(new Event('change', eventInit));
  element.dispatchEvent(new Event('blur', eventInit));
}

export function setFieldValue(element: Element, value: string): void {
  const proto = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor?.set) descriptor.set.call(element, value);
  else (element as HTMLInputElement).value = value;
  dispatchFieldEvents(element);
}

export function autoFillKnownFields(profile: UserProfile, root?: ParentNode): FormField[] {
  const fields = scanForm(root);
  const filled: FormField[] = [];
  const uncertain: FormField[] = [];
  for (const field of fields) {
    if (field.kind === 'custom') {
      uncertain.push(field);
      continue;
    }
    const value = valueForField(field, profile);
    if (value) {
      setFieldValue(field.element, value);
      filled.push(field);
    } else {
      uncertain.push(field);
    }
  }
  for (const field of uncertain) {
    field.element.classList.add('techia-highlight');
  }
  return filled;
}

/**
 * Build a prompt for an LLM to answer a custom screening question.
 * The caller is responsible for actually invoking the model; this keeps the
 * engine model-agnostic and lets the extension use either a remote API or a
 * local inference runtime.
 */
export function buildScreeningPrompt(params: {
  question: string;
  jobDescription: string;
  profile: UserProfile;
}): string {
  const { question, jobDescription, profile } = params;
  return [
    'You are helping a candidate answer a job application screening question.',
    'Use only the candidate profile and job description provided. Do not invent facts.',
    'If the answer is unknown, say so briefly.',
    '',
    'Candidate profile:',
    JSON.stringify(profile, null, 2),
    '',
    'Job description:',
    jobDescription.slice(0, 4000),
    '',
    'Question:',
    question,
    '',
    'Answer (concise, first person):',
  ].join('\n');
}

/**
 * Privacy guard: strip fields that must never leave the device.
 */
export function sanitizeProfileForExternal(profile: UserProfile): UserProfile {
  const { email, phone, ...rest } = profile;
  return rest;
}
