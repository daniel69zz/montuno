// Carga datos de DEMOSTRACIÓN a través de la API real (no toca la BD directamente).
// Uso: node scripts/demo/seed-demo.mjs [http://localhost:3000]
// Solo para entornos locales/DEMO: usa el OTP simulado y una wallet de prueba sin valor.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url + '/../../apps/api/');
const { Keypair } = require('@stellar/stellar-sdk');

const BASE = (process.argv[2] ?? 'http://localhost:3000') + '/api/v1';
const call = async (method, path, token, body) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j)}`);
  return j;
};
const otpLogin = async (email) => {
  const o = await call('POST', '/auth/otp/request', null, { email });
  return (await call('POST', '/auth/session', null, { provider: 'mock-email-otp', email, code: o.devCode })).accessToken;
};
const sign = (kp, msg) => Buffer.from(kp.signMessage(msg)).toString('base64');

const admin = await otpLogin('admin@example.local');
const impKp = Keypair.random();
const ch = await call('POST', '/auth/wallet/challenge', null, { address: impKp.publicKey() });
const imp = (await call('POST', '/auth/session', null, { provider: 'stellar-wallet', walletProvider: 'cli-test', challengeId: ch.challengeId, signature: sign(impKp, ch.message) })).accessToken;
const me = await call('GET', '/me', imp);
const importer = await call('POST', '/importers', imp, { publicName: 'Andes Import' });
await call('POST', `/admin/importers/${importer.id}/verify`, admin);
await call('PATCH', `/admin/importers/${importer.id}/limits`, admin, { maxOrderAmountAtomic: '50000000000', maxAdvanceBps: 7500, allowedModes: ['FULL_ESCROW', 'PARTIAL_ADVANCE'] });
await call('POST', '/importers/me/wallet/verify', imp, { walletId: me.wallets[0].id });

const items = [
  ['MacBook Air 13" M4 16GB', 'tecnologia', 'Desde Apple Store US. Sellada, garantía internacional de Apple.', '8352.00', 'https://www.apple.com/shop/buy-mac/macbook-air', 20],
  ['iPhone 16 Pro 256GB', 'telefonia', 'Liberado de fábrica, versión eSIM + nano-SIM. Sellado.', '9800.00', 'https://www.apple.com/shop/buy-iphone/iphone-16-pro', 18],
  ['Sony WH-1000XM6', 'audio', 'Audífonos con cancelación de ruido. Desde Amazon US.', '2900.00', 'https://www.amazon.com/dp/B0EXAMPLE', 15],
  ['PlayStation 5 Pro', 'tecnologia', 'Consola con 2TB. Comprada en tienda oficial de EE. UU.', '6100.00', 'https://www.playstation.com/ps5/ps5-pro/', 21],
  ['Taladro DeWalt 20V MAX', 'herramientas', 'Kit con dos baterías y cargador, voltaje compatible.', '1650.00', 'https://www.dewalt.com/', 25],
];
for (const [title, category, description, price, url, days] of items)
  await call('POST', '/importers/me/catalog', imp, { title, category, description, referencePriceFiat: price, fiatCurrency: 'BOB', referenceUrl: url, deliveryEstimateDays: days });

const in6h = new Date(Date.now() + 6 * 3600e3).toISOString();
const quote = (mode, advance) => ({
  productUrl: 'https://www.apple.com/shop/buy-mac/macbook-air', productName: 'MacBook Air 13" M4', productVariant: '16GB · Medianoche', quantity: 1,
  destinationCity: 'La Paz', deliveryEstimateDays: 20, purchaseTerms: 'Compra en Apple Store US; envío por courier a La Paz; entrega en mano.',
  fiatPrice: '8352.00', fiatCurrency: 'BOB', amountAtomic: '12000000000', serviceFeeAtomic: '200000000',
  fx: { rate: '6.96', spreadBps: 50, source: 'demo', expiresAt: in6h }, escrowMode: mode, advanceAmountAtomic: advance,
  expiresAt: in6h, fulfillmentDeadline: new Date(Date.now() + 30 * 86400e3).toISOString(),
});
const links = [];
for (const [mode, adv] of [['FULL_ESCROW', '0'], ['PARTIAL_ADVANCE', '9000000000']]) {
  const q = await call('POST', '/quotes', imp, quote(mode, adv));
  const p = await call('POST', `/quotes/${q.id}/publish`, imp);
  links.push([mode, p.checkout.token]);
}
console.log('\nDatos DEMO cargados (Andes Import, 5 productos, 2 cotizaciones).');
for (const [m, t] of links) console.log(`  Checkout ${m}: http://localhost:5173/c/${t}`);
console.log(`\nImportadora (wallet de prueba, sin valor): pega esta clave en "Wallet de prueba" para entrar como Andes Import:\n  ${impKp.secret()}`);
console.log('Admin (OTP simulado): admin@example.local');
