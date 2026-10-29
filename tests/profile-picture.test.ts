/**
 * Private profile-picture URL rules.
 *
 * These are security tests as much as rendering tests: the authenticated avatar
 * proxy attaches the Blob store token to its upstream request, so these helpers
 * decide which stored URLs may ever receive it.
 */

import { describe, it, expect } from './harness';
import {
  isOwnedPrivateAvatarUrl,
  isPrivateVercelBlobUrl,
  isVercelBlobUrl,
} from '@/lib/blob-url';
import { profilePictureSrc } from '@/lib/profile-picture';

const USER_ID = 'cmo3i0ece0000jx04s5a74xl0';
const privateAvatar = `https://store.private.blob.vercel-storage.com/avatars/${USER_ID}/1700000000000-me.jpg`;

describe('blob URL detection', () => {
  it('recognises private and public Blob hosts', () => {
    expect(isVercelBlobUrl(privateAvatar)).toBe(true);
    expect(isVercelBlobUrl('https://store.public.blob.vercel-storage.com/resumes/x.pdf')).toBe(true);
    expect(isPrivateVercelBlobUrl(privateAvatar)).toBe(true);
    expect(isPrivateVercelBlobUrl('https://store.public.blob.vercel-storage.com/avatars/x.jpg')).toBe(false);
  });

  it('does not accept a lookalike host that merely contains the Blob domain', () => {
    const attacker = `https://evil.example/avatars/${USER_ID}/x.jpg?.private.blob.vercel-storage.com`;
    expect(isVercelBlobUrl(attacker)).toBe(false);
    expect(isPrivateVercelBlobUrl(attacker)).toBe(false);
    expect(isOwnedPrivateAvatarUrl(attacker, USER_ID)).toBe(false);

    const suffixAttack = `https://store.private.blob.vercel-storage.com.evil.example/avatars/${USER_ID}/x.jpg`;
    expect(isPrivateVercelBlobUrl(suffixAttack)).toBe(false);
  });

  it('accepts only a private avatar under the caller own prefix', () => {
    expect(isOwnedPrivateAvatarUrl(privateAvatar, USER_ID)).toBe(true);
    expect(isOwnedPrivateAvatarUrl(privateAvatar, 'someone-else')).toBe(false);

    const publicAvatar = `https://store.public.blob.vercel-storage.com/avatars/${USER_ID}/x.jpg`;
    expect(isOwnedPrivateAvatarUrl(publicAvatar, USER_ID)).toBe(false);
  });
});

describe('profilePictureSrc', () => {
  it('proxies private avatars with a cache-busting version', () => {
    expect(profilePictureSrc(privateAvatar)).toBe(
      '/api/profile/picture/file?v=1700000000000-me.jpg',
    );
  });

  it('leaves browser-readable URLs untouched', () => {
    expect(profilePictureSrc('https://media.licdn.com/photo.jpg')).toBe(
      'https://media.licdn.com/photo.jpg',
    );
    expect(profilePictureSrc('/uploads/avatars/local.jpg')).toBe('/uploads/avatars/local.jpg');
    expect(
      profilePictureSrc('https://store.public.blob.vercel-storage.com/avatars/legacy.jpg'),
    ).toBe('https://store.public.blob.vercel-storage.com/avatars/legacy.jpg');
  });

  it('returns an empty string for missing values', () => {
    expect(profilePictureSrc(null)).toBe('');
    expect(profilePictureSrc(undefined)).toBe('');
    expect(profilePictureSrc('   ')).toBe('');
  });
});
