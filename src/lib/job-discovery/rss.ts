import { decodeHtmlEntities } from './html';

/**
 * Small, dependency-free RSS reader for the two public feeds we ingest.
 *
 * A full XML parser would be more general, but these feeds are stable RSS 2.0
 * documents and the alternative is a new runtime dependency in a security
 * sensitive ingestion path. The parser is intentionally forgiving: a malformed
 * item is skipped, never allowed to abort the whole feed.
 */

export type RssItem = {
  title: string;
  link: string;
  guid: string;
  description: string;
  content: string;
  pubDate: string;
  category: string;
  region: string;
  creator: string;
};

function tagPattern(tag: string) {
  return new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
}

function stripCdata(value: string) {
  return value.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/i, '$1');
}

function readTag(block: string, tag: string): string {
  const match = block.match(tagPattern(tag));
  if (!match) return '';
  return decodeHtmlEntities(stripCdata(match[1])).trim();
}

export function parseRssItems(xml: string): RssItem[] {
  if (!xml || typeof xml !== 'string') return [];
  const items: RssItem[] = [];

  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const title = readTag(block, 'title');
    const link = readTag(block, 'link');
    const guid = readTag(block, 'guid');
    if (!title || !(link || guid)) continue;

    items.push({
      title,
      link,
      guid,
      description: readTag(block, 'description'),
      content: readTag(block, 'content:encoded'),
      pubDate: readTag(block, 'pubDate'),
      category: readTag(block, 'category'),
      region: readTag(block, 'region'),
      creator: readTag(block, 'dc:creator'),
    });
  }

  return items;
}

export function parseRssDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Feed titles often encode the employer as "Company: Role". Split only when a
 * colon is present and both sides look meaningful, so a role like
 * "Engineer: Platform" is not mistaken for a company name.
 */
export function splitCompanyFromTitle(title: string): { company: string; title: string } {
  const match = title.match(/^([^:]{2,80}):\s*(.{2,180})$/);
  if (!match) return { company: '', title };
  const left = match[1].trim();
  const right = match[2].trim();
  // "Engineer: Platform" is a role with a focus area, not "Engineer" the
  // employer. Avoid turning a generic role noun into a company name.
  if (/^(engineer|developer|designer|manager|analyst|scientist|architect|consultant|specialist|director|lead|intern|administrator)$/i.test(left)) {
    return { company: '', title };
  }
  return { company: left, title: right };
}

/** Jobspresso puts the employer and location in the RSS creator field. */
export function splitCreator(value: string): { company: string; location: string } {
  const cleaned = value
    .replace(/<br\s*\/?>/gi, '|')
    .replace(/\u2692|\u26B2|\u2316/g, '|');
  const [companyPart, ...rest] = cleaned.split('|');
  return {
    company: (companyPart ?? '').trim(),
    location: rest.join(' ').replace(/\s+/g, ' ').trim(),
  };
}
