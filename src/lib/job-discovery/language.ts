import { htmlToText } from './html';

/**
 * Deterministic language gate for catalog listings.
 *
 * teChia Jobs is an English-only product, so a listing whose description is
 * clearly written in another language must never reach a shortlist. Detection
 * is deliberately conservative: it only says "non-English" when there is
 * substantial, unambiguous evidence. Short or sparse listings return `unknown`
 * and are allowed through, because a missing description is a data-quality
 * problem, not proof that the posting is not in English.
 */

export type JobLanguage = 'en' | 'non-en' | 'unknown';

export type LanguageDetection = {
  language: JobLanguage;
  /** Best non-English language code (`de`, `fr`, ...), when one was detected. */
  code: string | null;
  /** 0–1. Low confidence is expected for `unknown` results. */
  confidence: number;
};

const MIN_WORDS = 30;
const MIN_NON_ENGLISH_WORD_HITS = 5;
const MIN_NON_ENGLISH_SCORE = 7;
const MIN_NON_ENGLISH_RATIO = 0.035;
const MIN_ENGLISH_RATIO = 0.05;

/**
 * Function words are the signal. Content words ("team", "software", "job")
 * are frequently borrowed between languages, so they are intentionally absent
 * from these sets.
 */
const STOPWORDS: Record<string, Set<string>> = {
  en: new Set([
    'the', 'and', 'of', 'to', 'in', 'for', 'with', 'is', 'are', 'you', 'we', 'our', 'this', 'that',
    'will', 'have', 'has', 'from', 'or', 'be', 'your', 'on', 'at', 'by', 'an', 'not', 'they', 'their',
    'it', 'if', 'can', 'but', 'was', 'were', 'would', 'should', 'could', 'which', 'who', 'what',
    'when', 'where', 'how', 'all', 'more', 'than', 'into', 'over', 'under', 'about', 'also', 'may',
    'must', 'need', 'just', 'only', 'very', 'well', 'there', 'these', 'those', 'been', 'being',
    'does', 'did', 'so', 'up', 'out', 'other', 'such', 'each', 'both', 'few', 'most', 'some', 'any',
    'own', 'same', 'too', 'its', 'them', 'he', 'she', 'his', 'her', 'him', 'me', 'my', 'am', 'then',
    'once', 'here', 'why', 'while', 'during', 'before', 'after', 'above', 'below', 'between',
    'through', 'against', 'because', 'until', 'upon', 'within', 'without', 'across', 'including',
  ]),
  de: new Set([
    'der', 'die', 'das', 'den', 'dem', 'des', 'und', 'mit', 'für', 'wir', 'sie', 'ist', 'nicht',
    'auf', 'ein', 'eine', 'einen', 'einem', 'einer', 'als', 'bei', 'aus', 'im', 'zu', 'von', 'oder',
    'werden', 'wird', 'sind', 'haben', 'dass', 'auch', 'sich', 'uns', 'dein', 'deine', 'dich',
    'bewirb', 'bewerben', 'bewerbung', 'stellenangebot', 'stellenanzeige', 'aufgaben', 'profil',
    'kenntnisse', 'erfahrung', 'sehr', 'gerne', 'unser', 'unsere', 'mitarbeiter', 'kollegen',
    'standort', 'vollzeit', 'teilzeit', 'anforderungen', 'verantwortung', 'möglichkeit', 'zukunft',
    'unterstützen', 'gestalten', 'bieten', 'freuen', 'kontakt', 'gehalt', 'urlaub', 'weiterbildung',
  ]),
  fr: new Set([
    'les', 'des', 'une', 'nous', 'vous', 'pour', 'avec', 'dans', 'sur', 'est', 'pas', 'aux', 'du',
    'votre', 'notre', 'poste', 'recherchons', 'recherche', 'entreprise', 'candidat', 'candidate',
    'rejoindre', 'équipe', 'travail', 'expérience', 'ses', 'ce', 'cette', 'ces', 'qui', 'que',
    'dont', 'où', 'plus', 'tout', 'tous', 'toute', 'être', 'avoir', 'faites', 'offre', 'offrons',
    'missions', 'profil', 'compétences', 'avantages', 'salaire', 'contrat', 'cdi', 'cdd',
    'alternance', 'stage', 'télétravail', 'région', 'basé', 'basée',
  ]),
  es: new Set([
    'el', 'los', 'las', 'que', 'un', 'una', 'para', 'con', 'por', 'del', 'como', 'más', 'sus',
    'ser', 'nuestro', 'nuestra', 'puesto', 'buscamos', 'experiencia', 'equipo', 'empresa',
    'trabajo', 'es', 'está', 'están', 'ofrecemos', 'requisitos', 'funciones', 'salario', 'jornada',
    'personas', 'candidato', 'candidata', 'incorporar', 'contrato', 'remoto', 'modalidad',
    'conocimientos', 'valoramos', 'responsable', 'proyectos', 'desarrollo',
  ]),
  pt: new Set([
    'os', 'uma', 'para', 'com', 'por', 'do', 'da', 'dos', 'das', 'em', 'um', 'não', 'sim', 'mais',
    'nós', 'vaga', 'experiência', 'conhecimento', 'conhecimentos', 'equipe', 'empresa', 'trabalho',
    'procuramos', 'requisitos', 'atividades', 'benefícios', 'candidato', 'candidata', 'jornada',
    'salário', 'contrato', 'remoto', 'modelo', 'habilidades', 'diferenciais', 'sobre', 'você',
    'sua', 'seu', 'nosso', 'nossa', 'oferecemos', 'desafios', 'oportunidade',
  ]),
  nl: new Set([
    'het', 'een', 'van', 'voor', 'met', 'op', 'dat', 'die', 'niet', 'zijn', 'wij', 'je', 'jij',
    'jouw', 'functie', 'ervaring', 'vacature', 'bedrijf', 'werk', 'werken', 'wordt', 'worden',
    'hebben', 'heeft', 'ook', 'maar', 'bij', 'uit', 'naar', 'deze', 'ons', 'onze', 'hun', 'kunnen',
    'moet', 'minimaal', 'jaar', 'salaris', 'fulltime', 'parttime', 'thuiswerken', 'solliciteren',
    'collega', 'kandidaten', 'opleiding', 'vaardigheden', 'verantwoordelijkheden', 'bieden',
    'gezocht',
  ]),
  it: new Set([
    'il', 'lo', 'gli', 'le', 'di', 'che', 'un', 'una', 'per', 'con', 'da', 'del', 'della', 'più',
    'nostro', 'nostra', 'posizione', 'cerchiamo', 'esperienza', 'lavoro', 'azienda', 'siamo',
    'sono', 'offriamo', 'requisiti', 'attività', 'candidato', 'candidata', 'sede', 'contratto',
    'stipendio', 'competenze', 'responsabilità', 'sviluppo', 'modalità', 'remoto', 'inserimento',
    'figura', 'ricerchiamo', 'benefici',
  ]),
  pl: new Set([
    'na', 'się', 'nie', 'jest', 'że', 'oraz', 'dla', 'od', 'po', 'jak', 'lub', 'przez', 'tego',
    'tej', 'tym', 'które', 'który', 'która', 'będzie', 'musi', 'możesz', 'praca', 'pracy', 'pracę',
    'zespół', 'firma', 'stanowisko', 'wymagania', 'oferujemy', 'doświadczenie', 'umiejętności',
    'wynagrodzenie', 'aplikuj', 'aplikacje', 'benefity', 'rozwój', 'szkolenia', 'zakres',
    'obowiązki', 'kandydat', 'kandydatka', 'mile', 'widziane', 'umowa', 'pełny', 'etat', 'zdalna',
    'zdalnie', 'biuro', 'lokalizacja',
  ]),
};

/**
 * Diacritics are useful secondary evidence. They are added to the score only
 * after at least five function-word matches, so a few accented names in an
 * English posting cannot flip the result.
 */
const ACCENTS: Record<string, RegExp> = {
  de: /[äöüß]/g,
  fr: /[àâçéèêëîïôûùœ]/g,
  es: /[áíóúñ¿¡]/g,
  pt: /[ãõáâçéêíóôú]/g,
  nl: /[ëï]/g,
  it: /[àèéìòù]/g,
  pl: /[ąćęłńóśźż]/g,
};

const WORD_PATTERN = /[\p{L}]+/gu;

function clean(value: string | null | undefined) {
  if (!value) return '';
  return htmlToText(value, 24_000) ?? '';
}

function words(text: string) {
  return text.toLowerCase().match(WORD_PATTERN) ?? [];
}

function accentCount(text: string, pattern: RegExp) {
  return (text.match(pattern) ?? []).length;
}

type Evidence = {
  code: string;
  wordHits: number;
  accentHits: number;
  score: number;
  ratio: number;
};

export function detectJobLanguage(input: {
  title?: string | null;
  description?: string | null;
}): LanguageDetection {
  const text = [clean(input.title), clean(input.description)].filter(Boolean).join('\n');
  const tokens = words(text);

  if (tokens.length < MIN_WORDS) {
    return { language: 'unknown', code: null, confidence: 0 };
  }

  const evidence: Evidence[] = Object.entries(STOPWORDS).map(([code, stopwords]) => {
    let wordHits = 0;
    for (const token of tokens) {
      if (stopwords.has(token)) wordHits += 1;
    }
    const accentHits = ACCENTS[code] ? accentCount(text, ACCENTS[code]) : 0;
    const score = wordHits + (wordHits >= MIN_NON_ENGLISH_WORD_HITS ? Math.min(accentHits, 12) * 0.5 : 0);
    return { code, wordHits, accentHits, score, ratio: score / tokens.length };
  });

  const english = evidence.find((entry) => entry.code === 'en')!;
  const nonEnglish = evidence
    .filter((entry) => entry.code !== 'en')
    .sort((a, b) => b.score - a.score || b.ratio - a.ratio)[0];

  const strongNonEnglish =
    nonEnglish.wordHits >= MIN_NON_ENGLISH_WORD_HITS &&
    nonEnglish.score >= MIN_NON_ENGLISH_SCORE &&
    nonEnglish.ratio >= MIN_NON_ENGLISH_RATIO &&
    nonEnglish.ratio >= english.ratio * 1.5 + 0.01 &&
    nonEnglish.score - english.score >= 3;

  if (strongNonEnglish) {
    return {
      language: 'non-en',
      code: nonEnglish.code,
      confidence: Math.min(1, Math.round(nonEnglish.ratio * 4 * 100) / 100),
    };
  }

  if (english.ratio >= MIN_ENGLISH_RATIO) {
    return {
      language: 'en',
      code: 'en',
      confidence: Math.min(1, Math.round(english.ratio * 4 * 100) / 100),
    };
  }

  if (english.ratio >= 0.025 && english.ratio >= nonEnglish.ratio) {
    return {
      language: 'en',
      code: 'en',
      confidence: Math.min(1, Math.round(english.ratio * 4 * 100) / 100),
    };
  }

  return { language: 'unknown', code: null, confidence: 0 };
}

/** Unknown and short listings pass; only clear non-English text is rejected. */
export function isEnglishPosting(input: {
  title?: string | null;
  description?: string | null;
}): boolean {
  return detectJobLanguage(input).language !== 'non-en';
}
