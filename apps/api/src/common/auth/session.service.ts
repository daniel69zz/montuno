import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ENV, Env } from '../../config/env';

interface SessionClaims {
  sub: string;
  idp: string;
}

/** Sesión propia de la API (JWT HS256, corta). Se emite SOLO tras una prueba verificada. */
@Injectable()
export class SessionService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  issue(userId: string, identityProvider: string) {
    const token = this.jwt.sign({ sub: userId, idp: identityProvider } satisfies SessionClaims, {
      expiresIn: this.env.SESSION_TTL_SECONDS,
      audience: 'montuno-api',
      issuer: 'montuno-api',
    });
    return { accessToken: token, tokenType: 'Bearer', expiresIn: this.env.SESSION_TTL_SECONDS };
  }

  verify(token: string): SessionClaims {
    return this.jwt.verify<SessionClaims>(token, {
      audience: 'montuno-api',
      issuer: 'montuno-api',
    });
  }
}
