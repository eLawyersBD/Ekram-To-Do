export type UserRole = 'admin' | 'user';

export interface AppUser {
  id: string;
  username: string;
  fullName: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

/**
 * Computes a SHA-256 hex digest using Web Crypto API, with a deterministic
 * fallback for restricted environments where crypto.subtle is unavailable.
 */
export async function hashPassword(plain: string): Promise<string> {
  const input = `el-task-ledger::${plain}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(input);
    const buffer = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Fallback non-cryptographic hash only when SubtleCrypto is unavailable
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

export const DEFAULT_ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD = 'admin123';

export async function createDefaultAdminUser(): Promise<AppUser> {
  const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD);
  return {
    id: 'default-admin-account',
    username: DEFAULT_ADMIN_USERNAME,
    fullName: 'Administrator',
    passwordHash,
    role: 'admin',
    isActive: true,
    createdAt: new Date().toISOString(),
  };
}
