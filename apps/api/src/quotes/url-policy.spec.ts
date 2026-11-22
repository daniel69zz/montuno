import { assertSafeProductUrl } from './url-policy';

describe('política de URL de producto', () => {
  it.each([
    'https://www.amazon.com/dp/X',
    'https://www.ebay.com/itm/1?x=1',
    'https://www.apple.com/shop',
  ])('acepta %s', (u) => {
    expect(() => assertSafeProductUrl(u)).not.toThrow();
  });
  it.each([
    'http://amazon.com',
    'https://127.0.0.1/x',
    'https://localhost/x',
    'https://[::1]/',
    'file:///etc/passwd',
    'https://user:pw@amazon.com',
    'https://amazon.com:8443/',
    'https://metadata.internal/',
    'javascript:alert(1)',
  ])('rechaza %s', (u) => {
    expect(() => assertSafeProductUrl(u)).toThrow();
  });
});
