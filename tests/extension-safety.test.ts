/**
 * Browser extension safety.
 *
 * Two concrete regressions are locked here:
 *  1. the `location` shadowing bug that made every scraped job URL undefined;
 *  2. auto-answering sensitive application questions with a model.
 *
 * The content script is an IIFE that needs a DOM, so the URL fix is verified by
 * source inspection; the sensitive guard is verified both statically and as a
 * unit because the server module is importable.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from './harness';
import { isSensitiveQuestion } from '@/lib/ai/sensitive';

const extensionDir = path.join(process.cwd(), 'extension');
const contentJs = readFileSync(path.join(extensionDir, 'content', 'content.js'), 'utf8');
const contentCss = readFileSync(path.join(extensionDir, 'content', 'content.css'), 'utf8');

describe('extension job scraper', () => {
  it('does not shadow window.location with the scraped location text', () => {
    expect(contentJs).not.toContain('const location =');
  });

  it('returns a URL from the page location', () => {
    expect(contentJs).toContain('url: location.href');
  });

  it('uses a non-shadowing variable for the scraped location text', () => {
    expect(contentJs).toContain('location: locationText');
  });
});

describe('extension sensitive-field guard', () => {
  it('lists legal, protected, compensation and payment topics', () => {
    for (const term of ['citizen', 'visa', 'salary', 'gender', 'ssn', 'password']) {
      expect(contentJs.toLowerCase()).toContain(term);
    }
  });

  it('never asks the AI about an unlabelled field', () => {
    expect(contentJs).toContain('rawLabel.trim()');
  });

  it('marks AI-filled and skipped fields distinctly', () => {
    expect(contentJs).toContain('techia-ai');
    expect(contentJs).toContain('techia-skipped');
    expect(contentCss).toContain('.techia-ai');
    expect(contentCss).toContain('.techia-skipped');
  });
});

describe('server sensitive-question guard', () => {
  for (const question of [
    'Are you a US citizen?',
    'Do you require visa sponsorship?',
    'What is your expected salary?',
    'What is your gender?',
    'What is your date of birth?',
    'Please provide your SSN.',
    'Have you ever been convicted of a crime?',
    'Do you consent to a background check?',
    'What is your age?',
    'What is your sex?',
  ]) {
    it(`refuses: ${question}`, () => {
      expect(isSensitiveQuestion(question)).toBe(true);
    });
  }

  for (const question of [
    'Describe your experience with TypeScript.',
    'Why do you want this role?',
    'Tell me about a system you designed.',
    'How would you trace a bug in distributed storage?',
    'What is your approach to code review?',
  ]) {
    it(`allows: ${question}`, () => {
      expect(isSensitiveQuestion(question)).toBe(false);
    });
  }

  it('treats an empty question as not sensitive', () => {
    expect(isSensitiveQuestion('')).toBe(false);
  });
});
