const MARKETPLACE_HOSTS = [
  'mercadolivre.com.br',
  'mercadolivre.com',
  'meli.la',
];

const IMAGE_HOSTS = [
  'mlstatic.com',
];

function isHostAllowed(hostname: string, allowedHosts: string[]) {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return allowedHosts.some(host => normalized === host || normalized.endsWith(`.${host}`));
}

export function parseMarketplaceUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 2_000) {
    throw new Error('Link inválido.');
  }

  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Use um link HTTPS válido.');
  }
  if (!isHostAllowed(url.hostname, MARKETPLACE_HOSTS)) {
    throw new Error('No momento, somente links do Mercado Livre são aceitos.');
  }
  return url;
}

export function parseImageUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 2_000) {
    throw new Error('Endereço de imagem inválido.');
  }

  const url = new URL(value.startsWith('//') ? `https:${value}` : value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Use uma imagem HTTPS válida.');
  }
  if (!isHostAllowed(url.hostname, IMAGE_HOSTS)) {
    throw new Error('O domínio da imagem não é permitido.');
  }
  return url;
}
