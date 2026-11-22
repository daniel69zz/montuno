import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request & { correlationId?: string }, res: Response, next: NextFunction) {
    const incoming = req.header('x-correlation-id');
    req.correlationId = incoming && ID_RE.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-correlation-id', req.correlationId);
    next();
  }
}
