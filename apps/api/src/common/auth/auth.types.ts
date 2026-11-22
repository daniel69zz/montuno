import type { Role } from '@montuno/shared';

export interface ImporterMembershipCtx {
  importerId: string;
  role: 'OWNER' | 'OPERATOR';
}

/** Contexto de autorización recalculado desde la BD en CADA request (no confiamos en claims). */
export interface AuthUser {
  id: string;
  email: string | null;
  roles: Set<Role>;
  memberships: ImporterMembershipCtx[];
  verifiedWallets: string[];
}

export interface AuthedRequest {
  user?: AuthUser;
  correlationId?: string;
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}
