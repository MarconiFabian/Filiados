(() => {
  if (window.__ML_SHOPEE_PRICE_OBSERVER__) return;
  window.__ML_SHOPEE_PRICE_OBSERVER__ = true;

  const isProductEndpoint = (value) => {
    try {
      const url = new URL(String(value || ''), location.href);
      return /\/api\/v4\/(?:pdp\/get_pc|item\/get)$/i.test(url.pathname);
    } catch {
      return false;
    }
  };

  const idsFromUrl = (value) => {
    try {
      const url = new URL(String(value || ''), location.href);
      const path = decodeURIComponent(url.pathname);
      const route = path.match(/\/(?:product|opaanlp)\/(\d+)\/(\d+)(?:\/|$)/i);
      const slug = path.match(/(?:^|[-/])i\.(\d+)\.(\d+)(?:\/|$)/i);
      const shopId = route?.[1] || slug?.[1] || url.searchParams.get('shop_id') || url.searchParams.get('shopid') || '';
      const itemId = route?.[2] || slug?.[2] || url.searchParams.get('item_id') || url.searchParams.get('itemid') || '';
      return /^\d+$/.test(shopId) && /^\d+$/.test(itemId) ? { shopId, itemId } : null;
    } catch {
      return null;
    }
  };

  const unwrapMoney = (value) => {
    if (value && typeof value === 'object') {
      return value.value ?? value.amount ?? value.single_value ?? null;
    }
    return value;
  };

  const money = (value) => {
    const unwrapped = unwrapMoney(value);
    if (typeof unwrapped === 'string' && /[.,]/.test(unwrapped)) {
      const parsed = Number(unwrapped.replace(/R\$\s*/gi, '').replace(/\s+/g, '').replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(parsed) && parsed > 0 && parsed <= 1000000 ? parsed : null;
    }
    const raw = Number(unwrapped);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const parsed = Number.isInteger(raw) && raw >= 100000 ? raw / 100000 : raw;
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 1000000 ? parsed : null;
  };

  const firstMoney = (values) => {
    for (const value of values) {
      const parsed = money(value);
      if (parsed !== null) return parsed;
    }
    return null;
  };

  const imageUrl = (value) => {
    const raw = Array.isArray(value) ? value[0] : value;
    const image = String(raw || '').trim();
    if (!image) return '';
    if (/^https:\/\//i.test(image)) return image;
    return 'https://down-br.img.susercontent.com/file/' + image.replace(/^\/+/, '');
  };

  const publish = (payload, requestUrl) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.error && Number(payload.error) !== 0) return;
    const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
    const item = data.item && typeof data.item === 'object'
      ? data.item
      : (data.item_basic && typeof data.item_basic === 'object' ? data.item_basic : data);
    if (!item || typeof item !== 'object') return;

    const requestIds = idsFromUrl(requestUrl);
    const pageIds = idsFromUrl(location.href)
      || idsFromUrl(document.querySelector('link[rel="canonical"]')?.href)
      || idsFromUrl(document.querySelector('meta[property="og:url"]')?.content);
    const shopId = String(
      item.shopid ?? item.shop_id ?? data.shopid ?? data.shop_id ?? requestIds?.shopId ?? pageIds?.shopId ?? ''
    );
    const itemId = String(
      item.itemid ?? item.item_id ?? data.itemid ?? data.item_id ?? requestIds?.itemId ?? pageIds?.itemId ?? ''
    );
    if (!/^\d+$/.test(shopId) || !/^\d+$/.test(itemId)) return;
    if (pageIds && (pageIds.shopId !== shopId || pageIds.itemId !== itemId)) return;

    const currency = String(item.currency || data.currency || 'BRL').toUpperCase();
    if (currency !== 'BRL') return;

    const productPrice = data.product_price?.price
      || data.product_price
      || item.product_price?.price
      || item.product_price
      || {};
    const models = Array.isArray(item.models) ? item.models : [];
    const selectedModelId = String(item.selected_modelid ?? item.selected_model_id ?? data.selected_modelid ?? '');
    const selectedModel = selectedModelId
      ? models.find((model) => String(model?.modelid ?? model?.model_id ?? '') === selectedModelId)
      : null;

    const price = firstMoney([
      productPrice.single_value,
      productPrice.range_min,
      productPrice.price_min,
      selectedModel?.price,
      item.price_min,
      item.price,
    ]);
    if (price === null) return;

    const priceMax = firstMoney([
      productPrice.range_max,
      productPrice.price_max,
      item.price_max,
    ]);
    const originalPrice = firstMoney([
      productPrice.single_value_before_discount,
      productPrice.range_min_before_discount,
      productPrice.price_before_discount,
      selectedModel?.price_before_discount,
      item.price_min_before_discount,
      item.price_before_discount,
    ]);

    window.postMessage({
      source: 'ml-shopee-page',
      type: 'ML_SHOPEE_PDP_CAPTURED',
      payload: {
        source: 'shopee-page-response',
        confidence: 'high',
        shopId,
        itemId,
        modelId: selectedModelId || null,
        price,
        priceMax: priceMax !== null && priceMax >= price ? priceMax : null,
        originalPrice: originalPrice !== null && originalPrice > price ? originalPrice : null,
        title: String(item.name || item.title || data.name || data.title || '').trim().slice(0, 300),
        image: imageUrl(item.image) || imageUrl(item.images),
        capturedAt: Date.now(),
      },
    }, location.origin);
  };

  const inspectResponse = async (response, requestUrl) => {
    if (!isProductEndpoint(requestUrl)) return;
    try {
      const clone = response.clone();
      if (!clone.ok) return;
      publish(await clone.json(), requestUrl);
    } catch {}
  };

  const nativeFetch = window.fetch;
  window.fetch = function (...args) {
    const requestUrl = args[0] instanceof Request ? args[0].url : String(args[0] || '');
    const result = nativeFetch.apply(this, args);
    result.then((response) => inspectResponse(response, requestUrl)).catch(() => {});
    return result;
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__mlShopeeRequestUrl = String(url || '');
    return nativeOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (isProductEndpoint(this.__mlShopeeRequestUrl)) {
      this.addEventListener('load', () => {
        try {
          const payload = this.responseType === 'json' ? this.response : JSON.parse(this.responseText || 'null');
          publish(payload, this.__mlShopeeRequestUrl);
        } catch {}
      }, { once: true });
    }
    return nativeSend.apply(this, args);
  };
})();
