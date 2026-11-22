import { Logger, Provider } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { ENV, Env } from '../config/env';
import { ESCROW_GATEWAY } from './escrow-gateway';
import { SimulatedEscrowGateway } from './simulated.gateway';
import { SorobanEscrowGateway } from './soroban.gateway';

export const escrowGatewayProvider: Provider = {
  provide: ESCROW_GATEWAY,
  inject: [ENV],
  useFactory: (env: Env) => {
    if (env.ESCROW_GATEWAY === 'soroban') return new SorobanEscrowGateway(env);
    const arbiter = env.STELLAR_ARBITER_ADDRESS || Keypair.random().publicKey();
    new Logger('Stellar').warn(
      JSON.stringify({
        msg: 'ESCROW_GATEWAY=simulated: ledger en memoria, órdenes marcadas SIMULATED',
        arbiter,
      }),
    );
    return new SimulatedEscrowGateway(arbiter, env.STELLAR_MAX_ADVANCE_BPS);
  },
};
