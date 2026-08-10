import { MARKETPLACES, detectMarketplaceByHostname, isHostAllowed } from './marketplaces.js';

const IMAGE_HOSTS = MARKETPLACES.flatMap((marketplace) => [...marketplace.imageHosts]);

export function parseMarketplaceUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 2_000) {
    throw new Error('Link inválido.');
  }

  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Use um link HTTPS válido.');
  }
  if (!detectMarketplaceByHostname(url.hostname)) {
    throw new Error('Use um link do Mercado Livre, Amazon, AliExpress ou Shopee.');
  }
  return url;
}

export function parseImageUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 2_000) {
    throw new Error('Endereço de imagem inválido.');
  }

  const url = new URL(String(value).startsWith('//') ? `https:${value}` : String(value));
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Use uma imagem HTTPS válida.');
  }
  if (!isHostAllowed(url.hostname, IMAGE_HOSTS)) {
    throw new Error('O domínio da imagem não é permitido.');
  }
  return url;
}
