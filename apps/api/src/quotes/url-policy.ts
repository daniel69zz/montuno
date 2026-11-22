import { invalid } from '../common/errors';

/**
 * Política de URL de producto (anti-SSRF): el servidor NUNCA descarga esta URL (sin scraping en el MVP),
 * pero igualmente se restringe a https y hostnames públicos para no almacenar destinos internos.
 */
export function assertSafeProductUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw invalid('INVALID_PRODUCT_URL', 'URL inválida');
  }
  const host = u.hostname.toLowerCase();
  const isIp = /^[0-9.]+$/.test(host) || host.includes(':') || host.startsWith('[');
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.port ||
    isIp ||
    !host.includes('.') ||
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  )
    throw invalid('INVALID_PRODUCT_URL', 'Solo URLs https con dominio público');
  return u.toString();
}
