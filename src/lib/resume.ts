type ExtractedResumeProfile = {
  fullName?: string;
  headline?: string;
  portfolioUrl?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  suggestedJobTitles: string[];
  suggestedSkills: string[];
  suggestedSummary?: string;
};

function normalizeWhitespace(input: string) {
  return input.replace(/\s+/g, ' ').trim();
}

function extractUrls(text: string) {
  const matches = text.match(/https?:\/\/[^\s)]+/g) ?? [];
  return Array.from(new Set(matches));
}

function guessTitles(text: string) {
  const lower = text.toLowerCase();
  const known = [
    'software engineer',
    'full-stack developer',
    'backend engineer',
    'frontend engineer',
    'product manager',
    'content writer',
    'marketing manager',
    'sales development representative',
  ];

  return known.filter((title) => lower.includes(title));
}

function guessSkills(text: string) {
  const lower = text.toLowerCase();
  const skills = [
    'typescript',
    'javascript',
    'react',
    'next.js',
    'node.js',
    'nestjs',
    'postgresql',
    'docker',
    'git',
    'github',
    'aws',
    'gcp',
  ];

  return skills.filter((skill) => lower.includes(skill));
}

async function extractTextFromResume(file: File) {
  const text = await file.text();
  return normalizeWhitespace(text);
}

export async function extractResumeProfile(file: File): Promise<ExtractedResumeProfile> {
  const text = await extractTextFromResume(file);
  const urls = extractUrls(text);

  const linkedinUrl = urls.find((url) => url.includes('linkedin.com'));
  const githubUrl = urls.find((url) => url.includes('github.com'));
  const portfolioUrl = urls.find(
    (url) => !url.includes('linkedin.com') && !url.includes('github.com')
  );

  return {
    headline: text.slice(0, 160),
    linkedinUrl,
    githubUrl,
    portfolioUrl,
    suggestedJobTitles: guessTitles(text),
    suggestedSkills: guessSkills(text),
    suggestedSummary: text.slice(0, 500),
  };
}
