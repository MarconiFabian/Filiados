export type MarketplaceId = 'mercado-livre' | 'amazon' | 'aliexpress' | 'shopee';

export interface MarketplaceDefinition {
  id: MarketplaceId;
  name: string;
  hosts: readonly string[];
  imageHosts: readonly string[];
  affiliatePortal: string;
}

export const MARKETPLACES: readonly MarketplaceDefinition[] = [
  {
    id: 'mercado-livre',
    name: 'Mercado Livre',
    hosts: ['mercadolivre.com.br', 'mercadolivre.com', 'meli.la'],
    imageHosts: ['mlstatic.com'],
    affiliatePortal: 'https://www.mercadolivre.com.br/afiliados/links',
  },
  {
    id: 'amazon',
    name: 'Amazon',
    hosts: ['amazon.com.br', 'amzn.to'],
    imageHosts: ['media-amazon.com', 'ssl-images-amazon.com'],
    affiliatePortal: 'https://associados.amazon.com.br/home',
  },
  {
    id: 'aliexpress',
    name: 'AliExpress',
    hosts: ['aliexpress.com'],
    imageHosts: ['alicdn.com', 'aliexpress-media.com'],
    affiliatePortal: 'https://portals.aliexpress.com/',
  },
  {
    id: 'shopee',
    name: 'Shopee',
    hosts: ['shopee.com.br', 'shope.ee'],
    imageHosts: ['susercontent.com', 'shopeesz.com', 'shopeeusercontent.com', 'shopee.com.br'],
    affiliatePortal: 'https://affiliate.shopee.com.br/',
  },
] as const;

export function isHostAllowed(hostname: string, allowedHosts: readonly string[]) {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return allowedHosts.some((host) => normalized === host || normalized.endsWith(`.${host}`));
}

export function detectMarketplaceByHostname(hostname: string): MarketplaceDefinition | null {
  return MARKETPLACES.find((marketplace) => isHostAllowed(hostname, marketplace.hosts)) ?? null;
}

export function detectMarketplaceUrl(value: string): MarketplaceDefinition | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? detectMarketplaceByHostname(url.hostname) : null;
  } catch {
    return null;
  }
}

export function getMarketplace(id: MarketplaceId | string | undefined): MarketplaceDefinition {
  return MARKETPLACES.find((marketplace) => marketplace.id === id) ?? MARKETPLACES[0];
}

export function marketplaceFromStore(store: string | undefined): MarketplaceDefinition {
  const normalized = String(store || '').toLowerCase();
  return MARKETPLACES.find((marketplace) => normalized.includes(marketplace.name.toLowerCase())) ?? MARKETPLACES[0];
}

export function isAffiliateLink(value: string, marketplaceId?: MarketplaceId | string): boolean {
  try {
    const url = new URL(value);
    const marketplace = marketplaceId ? getMarketplace(marketplaceId) : detectMarketplaceByHostname(url.hostname);
    if (!marketplace) return false;

    const host = url.hostname.toLowerCase();
    const href = url.toString().toLowerCase();
    switch (marketplace.id) {
      case 'mercado-livre':
        return host === 'meli.la' || /\/sec\/|client=affiliates|ml-social-selling|matt_tool=|matt_word=/i.test(href);
      case 'amazon':
        return host === 'amzn.to' || url.searchParams.has('tag') || url.searchParams.has('linkCode');
      case 'aliexpress':
        return /^(s\.click|a)\.aliexpress\.com$/i.test(host)
          || ['aff_fcid', 'aff_fsk', 'aff_platform', 'aff_trace_key'].some((key) => url.searchParams.has(key));
      case 'shopee':
        return host === 'shope.ee' || host === 's.shopee.com.br'
          || /\/an_redir|uls_trackid=|affiliate_id=/i.test(href);
      default:
        return false;
    }
  } catch {
    return false;
  }
}
