import axios from 'axios';
import * as cheerio from 'cheerio';
import type { VercelRequest, VercelResponse } from '../lib/vercelTypes.js';
import { enforceRateLimit, requestContext, requireApiUser } from '../lib/apiAuth.js';
import { parseImageUrl, parseMarketplaceUrl } from '../lib/security.js';
import { detectMarketplaceByHostname, type MarketplaceDefinition } from '../lib/marketplaces.js';

type CheerioRoot = ReturnType<typeof cheerio.load>;

type ProductData = {
  title: string;
  image: string;
  currentValue: number | null;
  originalValue: number | null;
  coupon: string;
  store: string;
};

function parsePrice(value: unknown): number | null {
  let normalized = String(value ?? '').replace(/[^\d.,]/g, '').trim();
  if (!normalized) return null;

  const comma = normalized.lastIndexOf(',');
  const dot = normalized.lastIndexOf('.');
  if (comma > dot) normalized = normalized.replace(/\./g, '').replace(',', '.');
  else if (dot > comma && /^\d{1,3}(\.\d{3})+$/.test(normalized)) normalized = normalized.replace(/\./g, '');
  else if (comma >= 0) normalized = normalized.replace(',', '.');

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function redirectUrl(options: Record<string, unknown>): URL {
  const protocol = String(options.protocol || 'https:');
  const hostname = String(options.hostname || '');
  const port = options.port ? ':' + String(options.port) : '';
  const path = String(options.path || '/');
  return new URL(protocol + '//' + hostname + port + path);
}

function text($: CheerioRoot, selectors: string[]): string {
  for (const selector of selectors) {
    const value = $(selector).first().text().replace(/\s+/g, ' ').trim();
    if (value) return value;
  }
  return '';
}

function attr($: CheerioRoot, selectors: string[], name: string): string {
  for (const selector of selectors) {
    const value = $(selector).first().attr(name)?.trim();
    if (value) return value;
  }
  return '';
}

function meta($: CheerioRoot, names: string[]): string {
  for (const name of names) {
    const value = $('meta[property="' + name + '"], meta[name="' + name + '"], meta[itemprop="' + name + '"]').first().attr('content')?.trim();
    if (value) return value;
  }
  return '';
}

function findProductNode(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProductNode(item);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  const type = record['@type'];
  if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return record;
  return findProductNode(record['@graph']);
}

function jsonLdProduct($: CheerioRoot): Record<string, unknown> | null {
  let product: Record<string, unknown> | null = null;
  $('script[type="application/ld+json"]').each((_index, element) => {
    if (product) return;
    try {
      product = findProductNode(JSON.parse($(element).html() || 'null'));
    } catch {
      // Alguns marketplaces publicam blocos JSON-LD incompletos; os seletores HTML continuam disponíveis.
    }
  });
  return product;
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return stringValue(value[0]);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return stringValue(record.url || record.contentUrl);
  }
  return '';
}

function offerFromProduct(product: Record<string, unknown> | null): Record<string, unknown> {
  if (!product) return {};
  const offers = product.offers;
  if (Array.isArray(offers)) return (offers[0] as Record<string, unknown>) || {};
  return offers && typeof offers === 'object' ? offers as Record<string, unknown> : {};
}

function commonProduct($: CheerioRoot, store: string): ProductData {
  const product = jsonLdProduct($);
  const offer = offerFromProduct(product);
  const image = stringValue(product?.image) || meta($, ['og:image', 'twitter:image']);
  const title = stringValue(product?.name) || meta($, ['og:title', 'twitter:title']) || $('title').text().trim();
  const currentValue = parsePrice(offer.price || offer.lowPrice || meta($, ['product:price:amount', 'price']));
  const seller = offer.seller && typeof offer.seller === 'object'
    ? stringValue((offer.seller as Record<string, unknown>).name)
    : '';

  return {
    title,
    image,
    currentValue,
    originalValue: null,
    coupon: '',
    store: seller || store,
  };
}

function extractMercadoLivre($: CheerioRoot): ProductData {
  const result = commonProduct($, 'Mercado Livre');
  result.title = text($, ['.ui-pdp-title']) || result.title;
  result.image = attr($, ['.ui-pdp-image'], 'data-zoom') || attr($, ['.ui-pdp-image'], 'src') || result.image;

  const prices: Array<{ value: number; previous: boolean }> = [];
  $('.andes-money-amount').each((_index, element) => {
    const amount = $(element);
    if (amount.closest('.ui-pdp-installments, .ui-search-installments').length > 0) return;
    const fraction = amount.find('.andes-money-amount__fraction').first().text().trim().replace(/[^0-9]/g, '');
    const cents = amount.find('.andes-money-amount__cents').first().text().trim().replace(/[^0-9]/g, '').padEnd(2, '0').slice(0, 2);
    const value = fraction ? Number(fraction + '.' + (cents || '00')) : parsePrice(amount.text());
    if (!value || !Number.isFinite(value)) return;
    prices.push({
      value,
      previous: amount.hasClass('andes-money-amount--previous') || amount.closest('.ui-pdp-price__old').length > 0,
    });
  });

  result.currentValue = prices.find((entry) => !entry.previous)?.value ?? result.currentValue;
  result.originalValue = prices.find((entry) => entry.previous)?.value ?? null;
  if (result.originalValue !== null && result.currentValue !== null && result.originalValue <= result.currentValue) {
    result.originalValue = null;
  }

  for (const selector of ['.ui-pdp-promotions-pill-label', '.ui-pdp-promotions__title', '.ui-pdp-media__title', '.ui-pdp-vpp-label']) {
    const promotion = $(selector).first().text().trim();
    if (!promotion || !/(CUPOM|USE)/i.test(promotion)) continue;
    result.coupon = promotion.match(/[A-Z0-9]{4,}/i)?.[0] || '';
    if (result.coupon) break;
  }
  return result;
}

function amazonImage($: CheerioRoot): string {
  const dynamic = attr($, ['#landingImage', '#imgBlkFront'], 'data-a-dynamic-image');
  if (dynamic) {
    try {
      const images = Object.keys(JSON.parse(dynamic));
      if (images[0]) return images[0];
    } catch {
      // Usa src ou metadados abaixo.
    }
  }
  return attr($, ['#landingImage', '#imgBlkFront'], 'src') || meta($, ['og:image']);
}

function extractAmazon($: CheerioRoot): ProductData {
  const result = commonProduct($, 'Amazon');
  result.title = text($, ['#productTitle']) || result.title;
  result.image = amazonImage($) || result.image;
  result.currentValue = parsePrice(text($, [
    '#corePrice_feature_div .a-price.priceToPay .a-offscreen',
    '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '.apexPriceToPay .a-offscreen',
  ])) || result.currentValue;
  result.originalValue = parsePrice(text($, [
    '#corePrice_feature_div .basisPrice .a-offscreen',
    '#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen',
    '.a-price.a-text-price .a-offscreen',
  ]));
  if (result.originalValue !== null && result.currentValue !== null && result.originalValue <= result.currentValue) {
    result.originalValue = null;
  }
  return result;
}

function extractAliExpress($: CheerioRoot): ProductData {
  const result = commonProduct($, 'AliExpress');
  result.title = text($, [
    '[data-pl="product-title"]',
    '.product-title-text',
    'h1',
  ]) || result.title;
  result.image = attr($, [
    '.magnifier-image',
    '.slider--img--D7MJNPZ',
    'img[class*="mainImage"]',
  ], 'src') || result.image;
  result.currentValue = parsePrice(text($, [
    '[data-pl="product-price"]',
    '.product-price-value',
    '[class*="price--currentPriceText"]',
    '[class*="price-default--current"]',
  ])) || result.currentValue;
  result.originalValue = parsePrice(text($, [
    '[class*="price--originalText"]',
    '[class*="price-default--original"]',
  ]));
  if (result.originalValue !== null && result.currentValue !== null && result.originalValue <= result.currentValue) {
    result.originalValue = null;
  }
  return result;
}

function shopeeEmbeddedPrice(html: string, key: string): number | null {
  const expression = new RegExp('"' + key + '"\\s*:\\s*([0-9]+)', 'i');
  const match = html.match(expression);
  if (!match) return null;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw >= 100000 ? raw / 100000 : raw;
}

function extractShopee($: CheerioRoot, html: string): ProductData {
  const result = commonProduct($, 'Shopee');
  result.title = text($, [
    '[data-testid="pdp-product-title"]',
    '.WBVL_7',
    'h1',
  ]) || result.title;
  result.image = attr($, [
    '[data-testid="pdp-product-image"] img',
    '.ZtlMLv img',
    'img[class*="product-image"]',
  ], 'src') || result.image;
  result.currentValue = parsePrice(text($, [
    '[data-testid="pdp-product-price"]',
    '.IZPeQz',
    '[class*="product-price"]',
  ])) || result.currentValue || shopeeEmbeddedPrice(html, 'price');
  result.originalValue = parsePrice(text($, [
    '[data-testid="pdp-product-price-before-discount"]',
    '.ZA5sW5',
    '[class*="price-before-discount"]',
  ])) || shopeeEmbeddedPrice(html, 'price_before_discount');
  if (result.originalValue !== null && result.currentValue !== null && result.originalValue <= result.currentValue) {
    result.originalValue = null;
  }
  return result;
}

export function extractProduct(marketplace: MarketplaceDefinition, $: CheerioRoot, html: string): ProductData {
  if (marketplace.id === 'mercado-livre') return extractMercadoLivre($);
  if (marketplace.id === 'amazon') return extractAmazon($);
  if (marketplace.id === 'aliexpress') return extractAliExpress($);
  return extractShopee($, html);
}

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const SHOPEE_PREVIEW_USER_AGENT = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

export function shopeeProductIds(url: URL): { shopId: string; itemId: string } | null {
  const pathname = decodeURIComponent(url.pathname);
  const routeMatch = pathname.match(/\/(?:product|opaanlp)\/(\d+)\/(\d+)(?:\/|$)/i);
  const slugMatch = pathname.match(/(?:^|[-/])i\.(\d+)\.(\d+)(?:\/|$)/i);
  const shopId = routeMatch?.[1] || slugMatch?.[1] || url.searchParams.get('shop_id') || url.searchParams.get('shopid') || '';
  const itemId = routeMatch?.[2] || slugMatch?.[2] || url.searchParams.get('item_id') || url.searchParams.get('itemid') || '';
  return /^\d+$/.test(shopId) && /^\d+$/.test(itemId) ? { shopId, itemId } : null;
}

export async function fetchMarketplaceHtml(url: URL, marketplace: MarketplaceDefinition, userAgent: string) {
  const response = await axios.get<string>(url.toString(), {
    headers: {
      'User-Agent': userAgent,
      'Accept-Language': 'pt-BR,pt;q=0.9',
    },
    timeout: 12_000,
    maxContentLength: 3_000_000,
    maxRedirects: 4,
    beforeRedirect: (options) => {
      const redirected = parseMarketplaceUrl(typeof options.href === 'string'
        ? options.href
        : redirectUrl(options as unknown as Record<string, unknown>).toString());
      if (detectMarketplaceByHostname(redirected.hostname)?.id !== marketplace.id) {
        throw new Error('O redirecionamento saiu do marketplace original.');
      }
    },
  });

  const finalUrl = response.request?.res?.responseUrl;
  if (finalUrl) {
    const redirected = parseMarketplaceUrl(finalUrl);
    if (detectMarketplaceByHostname(redirected.hostname)?.id !== marketplace.id) {
      throw new Error('O redirecionamento saiu do marketplace original.');
    }
  }
  if (typeof response.data !== 'string') throw new Error('Resposta inválida de ' + marketplace.name + '.');
  return response;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const userId = await requireApiUser(req, res);
  if (!userId || !enforceRateLimit(res, 'scrape:' + userId, 30, 60_000)) return;
  const context = requestContext(req);

  try {
    const safeUrl = parseMarketplaceUrl(req.query.url);
    const marketplace = detectMarketplaceByHostname(safeUrl.hostname);
    if (!marketplace) throw new Error('Marketplace não reconhecido.');

    let response = await fetchMarketplaceHtml(safeUrl, marketplace, BROWSER_USER_AGENT);

    if (marketplace.id === 'shopee') {
      const resolvedUrl = new URL(response.request?.res?.responseUrl || safeUrl.toString());
      const ids = shopeeProductIds(resolvedUrl);
      if (!ids) throw new Error('Não foi possível identificar o produto nesse link da Shopee.');

      const canonicalUrl = new URL(`https://shopee.com.br/product/${ids.shopId}/${ids.itemId}`);
      response = await fetchMarketplaceHtml(canonicalUrl, marketplace, SHOPEE_PREVIEW_USER_AGENT);
      console.info('shopee_product_resolved', {
        requestId: context.requestId,
        userId,
        shopId: ids.shopId,
        itemId: ids.itemId,
      });
    }

    const $ = cheerio.load(response.data);
    const product = extractProduct(marketplace, $, response.data);
    const title = product.title.replace(/\s+/g, ' ').trim();
    const rawImage = product.image.trim();

    if (title.length < 8 || !rawImage) {
      throw new Error('Produto incompleto: a loja não forneceu título ou imagem para captura automática.');
    }
    const requiresManualPrice = marketplace.id === 'shopee' && product.currentValue === null;
    if (product.currentValue === null && !requiresManualPrice) {
      throw new Error('Produto incompleto: a loja não forneceu o preço para captura automática.');
    }
    const image = parseImageUrl(rawImage).toString();

    console.info('scrape_completed', {
      requestId: context.requestId,
      userId,
      marketplace: marketplace.id,
      durationMs: Date.now() - context.startedAt,
    });
    return res.status(200).json({
      title,
      image,
      price: product.currentValue === null ? '' : formatPrice(product.currentValue),
      originalPrice: product.originalValue === null ? '' : formatPrice(product.originalValue),
      requiresManualPrice,
      coupon: product.coupon,
      store: product.store || marketplace.name,
      marketplace: marketplace.id,
      originalLink: safeUrl.toString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao capturar o produto.';
    const status = /Produto incompleto|Resposta inválida/i.test(message)
      ? 422
      : /link|HTTPS|marketplace|imagem|domínio|porta|redirecionamento/i.test(message)
        ? 400
        : 502;
    console.error('scrape_failed', {
      requestId: context.requestId,
      userId,
      durationMs: Date.now() - context.startedAt,
      status,
      error: message,
    });
    return res.status(status).json({ error: message });
  }
}