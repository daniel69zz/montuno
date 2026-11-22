import { Injectable } from '@nestjs/common';
import { TrustlessWorkConfig } from './trustless-work.config';

/**
 * Cliente de la Core API v2 de Trustless Work (https://docs.trustlesswork.com, sección v2).
 * Solo endpoints SINGLE-RELEASE verificados en la documentación (2026-11-22). La API nunca firma:
 * cada escritura devuelve `unsignedXdr` + `txHash`; la wallet del usuario firma y se envía con send-transaction.
 * Montos en unidades legibles (número), según su esquema.
 */
export interface TwUnsigned {
  unsignedXdr: string;
  txHash: string;
  contractId?: string | null;
}
export interface TwSendResult {
  txHash: string;
  ledger?: number;
  code?: string;
  message?: string;
  contractId?: string;
}
export interface TwEscrow {
  contractId: string;
  amount: number | string;
  balance: number | string;
  platformFee?: number;
  trustline?: { address?: string; contractId?: string; symbol?: string };
  roles?: {
    approvers?: string[];
    serviceProviders?: string[];
    releaseSigners?: string[];
    disputeResolvers?: string[];
    receiver?: string;
    platform?: string;
    admin?: string;
  };
  milestones?: {
    description: string;
    status?: string;
    approvals?: { target?: number; approvalCount?: number; approvedBy?: string[] };
  }[];
  dispute?: { isDisputed?: boolean; reason?: string; resolved?: boolean };
  released?: boolean;
}

export class TrustlessWorkError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

@Injectable()
export class TrustlessWorkClient {
  constructor(private readonly cfg: TrustlessWorkConfig) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-api-key': this.cfg.apiKey },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new TrustlessWorkError(
        503,
        'TW_UNREACHABLE',
        `Trustless Work no responde: ${(e as Error).message}`,
      );
    }
    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const j = (json ?? {}) as { code?: string; message?: string | string[] };
      const msg = Array.isArray(j.message)
        ? j.message.join('; ')
        : (j.message ?? text.slice(0, 300));
      throw new TrustlessWorkError(
        res.status,
        j.code ?? `TW_HTTP_${res.status}`,
        `Trustless Work: ${msg}`,
      );
    }
    return json as T;
  }

  deploySingle(body: {
    signer: string;
    engagementId: string;
    title: string;
    description: string;
    roles: {
      approvers: string[];
      serviceProviders: string[];
      platform: string;
      releaseSigners: string[];
      disputeResolvers: string[];
      receiver: string;
      admin: string;
    };
    amount: number;
    platformFee: number;
    milestones: { description: string }[];
    trustline: { contractId: string };
  }) {
    return this.call<TwUnsigned>('POST', '/escrow/single-release/v2/deploy', body);
  }
  fund(body: { contractId: string; signer: string; amount: number }) {
    return this.call<TwUnsigned>('POST', '/escrow/single-release/v2/fund', body);
  }
  approveMilestones(body: { contractId: string; approver: string; milestoneIndexes: number[] }) {
    return this.call<TwUnsigned>('POST', '/escrow/single-release/v2/approve-milestones', body);
  }
  releaseFunds(body: { contractId: string; releaseSigner: string }) {
    return this.call<TwUnsigned>('POST', '/escrow/single-release/v2/release-funds', body);
  }
  dispute(body: { contractId: string; signer: string; reason: string }) {
    return this.call<TwUnsigned>('POST', '/escrow/single-release/v2/dispute', body);
  }
  resolveDispute(body: {
    contractId: string;
    disputeResolver: string;
    distributions: { address: string; amount: number }[];
  }) {
    return this.call<TwUnsigned>('POST', '/escrow/single-release/v2/resolve-dispute', body);
  }
  getEscrow(contractId: string) {
    return this.call<TwEscrow>(
      'GET',
      `/escrow/single-release/v2/${encodeURIComponent(contractId)}`,
    );
  }
  sendTransaction(signedXdr: string) {
    return this.call<TwSendResult>('POST', '/stellar/send-transaction', { signedXdr });
  }
}
