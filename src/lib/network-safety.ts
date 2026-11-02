/**
 * Host and URL safety checks for server-side fetches.
 *
 * User-supplied URLs (job postings, research pages, recommendation links) must
 * never be allowed to reach loopback, private, link-local, CGNAT, multicast or
 * cloud-metadata addresses. The checks are deliberately fail-closed: a value
 * that cannot be parsed as a public address is treated as unsafe.
 *
 * `isPublicIpAddress` is synchronous and used by response normalisation.
 * `assertPublicHttpUrl` additionally resolves DNS, so it catches hostnames
 * that point at a private address even when the literal string looks public.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class UnsafeUrlError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
    this.code = code;
  }
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  return octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? octets
    : null;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  if (a === 0) return true; // "this" network
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF / documentation
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // documentation
  if (a === 203 && b === 0 && c === 113) return true; // documentation
  if (a >= 224) return true; // multicast / reserved / broadcast
  return false;
}

/** Expand an IPv6 address into eight 16-bit groups, or null if malformed. */
function expandIpv6(raw: string): number[] | null {
  let address = raw.toLowerCase().split('%')[0];
  if (address.startsWith('[') && address.endsWith(']')) address = address.slice(1, -1);
  if (!address.includes(':') || !/^[0-9a-f:.]+$/.test(address)) return null;

  // Convert a trailing dotted-quad (::ffff:127.0.0.1) into two hex groups.
  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':');
    if (lastColon === -1) return null;
    const ipv4 = parseIpv4(address.slice(lastColon + 1));
    if (!ipv4) return null;
    const high = ((ipv4[0] << 8) | ipv4[1]).toString(16);
    const low = ((ipv4[2] << 8) | ipv4[3]).toString(16);
    address = `${address.slice(0, lastColon)}:${high}:${low}`;
  }

  const halves = address.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const hasGap = halves.length === 2;
  const missing = 8 - head.length - tail.length;

  if (hasGap ? missing < 0 : head.length !== 8) return null;

  const groups = [
    ...head,
    ...Array.from({ length: hasGap ? missing : 0 }, () => '0'),
    ...tail,
  ];

  if (groups.length !== 8) return null;
  const parsed = groups.map((group) =>
    /^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN,
  );
  return parsed.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? parsed
    : null;
}

function isPrivateIpv6(raw: string): boolean {
  const groups = expandIpv6(raw);
  if (!groups) return true; // fail closed on malformed addresses

  const [first] = groups;
  // ::, ::1, and IPv4-compatible addresses (::a.b.c.d).
  if (groups.slice(0, 6).every((group) => group === 0)) return true;
  if ((first & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((first & 0xff00) === 0xff00) return true; // multicast ff00::/8

  // IPv4-mapped address (::ffff:a.b.c.d).
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return isPrivateIpv4([
      groups[6] >> 8,
      groups[6] & 0xff,
      groups[7] >> 8,
      groups[7] & 0xff,
    ]);
  }

  return false;
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = parseIpv4(address);
    return octets ? !isPrivateIpv4(octets) : false;
  }
  if (family === 6) return !isPrivateIpv6(address);
  return false;
}

function bareHostname(hostname: string): string {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/**
 * True when a hostname is obviously internal and must not be fetched.
 * Literal IP addresses are checked directly; DNS names are checked again
 * after resolution by `assertPublicHttpUrl`.
 */
export function isUnsafeHostname(hostname: string): boolean {
  const host = bareHostname(hostname);
  if (!host) return true;

  if (isIP(host)) return !isPublicIpAddress(host);
  if (parseIpv4(host)) return true; // non-canonical dotted form: fail closed

  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === 'metadata' || host === 'metadata.google.internal') return true;
  if (host.endsWith('.home.arpa')) return true;

  return false;
}

const DNS_TIMEOUT_MS = 3_000;

/**
 * Validate an already-parsed http(s) URL, including resolving its hostname.
 *
 * Throws `UnsafeUrlError` when the URL is not a public web URL. The caller is
 * still responsible for re-validating every redirect target.
 */
export async function assertPublicHttpUrl(url: URL): Promise<URL> {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new UnsafeUrlError('UNSAFE_PROTOCOL', 'Only public http and https pages can be read.');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('UNSAFE_CREDENTIALS', 'URLs containing credentials cannot be read.');
  }
  if (url.port && !['80', '443'].includes(url.port)) {
    throw new UnsafeUrlError('UNSAFE_PORT', 'Only standard web ports can be read.');
  }

  const host = bareHostname(url.hostname);
  if (!host || isUnsafeHostname(host)) {
    throw new UnsafeUrlError('UNSAFE_HOST', 'Private or internal addresses cannot be read.');
  }

  // Literal IP addresses have already been checked; only DNS names need lookup.
  if (isIP(host)) return url;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let addresses: Array<{ address: string }>;
  try {
    addresses = await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new UnsafeUrlError('DNS_TIMEOUT', 'That hostname could not be resolved.')),
          DNS_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof UnsafeUrlError) throw error;
    throw new UnsafeUrlError('DNS_FAILED', 'That hostname could not be resolved.');
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!addresses.length || addresses.some((entry) => !isPublicIpAddress(entry.address))) {
    throw new UnsafeUrlError('UNSAFE_HOST', 'Private or internal addresses cannot be read.');
  }

  return url;
}
