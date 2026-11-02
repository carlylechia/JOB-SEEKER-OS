/**
 * Unit tests for the shared redirect and network-safety helpers.
 */

import { describe, it, expect } from './harness';
import { safeInternalPath } from '@/lib/safe-redirect';
import { isPublicIpAddress, isUnsafeHostname } from '@/lib/network-safety';

describe('safeInternalPath', () => {
  it('keeps internal app paths', () => {
    expect(safeInternalPath('/dashboard')).toBe('/dashboard');
    expect(safeInternalPath('/jobs/abc-123')).toBe('/jobs/abc-123');
    expect(safeInternalPath('/dashboard?tab=jobs')).toBe('/dashboard?tab=jobs');
  });

  it('falls back for anything not a same-origin internal path', () => {
    expect(safeInternalPath('https://evil.example')).toBe('/dashboard');
    expect(safeInternalPath('javascript:alert(1)')).toBe('/dashboard');
    expect(safeInternalPath('//evil.example')).toBe('/dashboard');
    expect(safeInternalPath('/\\evil.example')).toBe('/dashboard');
    expect(safeInternalPath('')).toBe('/dashboard');
    expect(safeInternalPath(null)).toBe('/dashboard');
  });
});

describe('host safety', () => {
  it('rejects private, loopback and metadata hosts', () => {
    expect(isUnsafeHostname('localhost')).toBe(true);
    expect(isUnsafeHostname('127.0.0.1')).toBe(true);
    expect(isUnsafeHostname('10.0.0.5')).toBe(true);
    expect(isUnsafeHostname('192.168.1.10')).toBe(true);
    expect(isUnsafeHostname('169.254.169.254')).toBe(true);
    expect(isUnsafeHostname('fd00::1')).toBe(true);
    expect(isUnsafeHostname('fe80::1')).toBe(true);
    expect(isUnsafeHostname('metadata.google.internal')).toBe(true);
    expect(isUnsafeHostname('evil.example')).toBe(false);
  });

  it('classifies public IPv4 addresses correctly', () => {
    expect(isPublicIpAddress('8.8.8.8')).toBe(true);
    expect(isPublicIpAddress('127.0.0.1')).toBe(false);
    expect(isPublicIpAddress('10.0.0.5')).toBe(false);
    expect(isPublicIpAddress('192.168.1.5')).toBe(false);
    expect(isPublicIpAddress('169.254.169.254')).toBe(false);
  });
});
