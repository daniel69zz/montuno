// Textos de consentimiento versionados. El hash del texto se guarda junto a la aceptación.
import { sha256Hex } from './terms';

export interface Disclosure {
  version: string;
  text: string;
}

export const RISK_DISCLOSURES: Record<string, Disclosure> = {
  'full/v1': {
    version: 'full/v1',
    text:
      'Pagas el 100% del monto indicado en USDC de prueba. Los fondos quedan retenidos en un contrato ' +
      'inteligente y solo se liberan a la importadora cuando confirmes la entrega, o según la resolución ' +
      'de un árbitro si abres una disputa. El tracking del courier no se considera prueba definitiva de entrega.',
  },
  'partial/v1': {
    version: 'partial/v1',
    text:
      'Pagas el 100% del monto indicado. La importadora puede recibir un ANTICIPO FIJO de {advance} ' +
      '({advancePct}) ANTES de comprar el producto. Ese anticipo, una vez pagado, NO puede ser recuperado ' +
      'por el contrato inteligente. Si la importadora incumple, la protección on-chain se limita al saldo ' +
      'que siga retenido ({protected}). No existe otra garantía salvo que se indique por separado.',
  },
};

export function disclosureFor(mode: string): Disclosure {
  return mode === 'PARTIAL_ADVANCE' ? RISK_DISCLOSURES['partial/v1'] : RISK_DISCLOSURES['full/v1'];
}

export function renderDisclosure(d: Disclosure, vars: Record<string, string>): string {
  return d.text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

export function disclosureHash(renderedText: string, version: string): string {
  return sha256Hex(`import-escrow/disclosure/${version}\n${renderedText}`);
}
