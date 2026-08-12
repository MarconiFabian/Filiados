function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function isAllowedAppPage(sender) {
  try {
    const url = new URL(sender?.tab?.url || sender?.url || '');
    return (
      url.origin === 'https://ml-afiliados-pro.vercel.app' ||
      url.origin === 'https://filiados-phi.vercel.app' ||
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1'
    );
  } catch {
    return false;
  }
}

function openWhatsApp(sendResponse) {
  chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
    if (tabs.length) {
      chrome.tabs.update(tabs[0].id, { active: true });
      sendResponse?.({ ok: true, reused: true });
      return;
    }
    chrome.tabs.create({ url: 'https://web.whatsapp.com/' }, () => sendResponse?.({ ok: true }));
  });
}

function isAllowedShopeeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'shopee.com.br' || url.hostname.endsWith('.shopee.com.br'));
  } catch {
    return false;
  }
}

function shopeeIdsFromUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const path = decodeURIComponent(url.pathname);
    const route = path.match(/\/(?:product|opaanlp)\/(\d+)\/(\d+)(?:\/|$)/i);
    const slug = path.match(/(?:^|[-/])i\.(\d+)\.(\d+)(?:\/|$)/i);
    const shopId = route?.[1] || slug?.[1] || url.searchParams.get('shop_id') || url.searchParams.get('shopid') || '';
    const itemId = route?.[2] || slug?.[2] || url.searchParams.get('item_id') || url.searchParams.get('itemid') || '';
    return /^\d+$/.test(shopId) && /^\d+$/.test(itemId) ? { shopId, itemId } : null;
  } catch {
    return null;
  }
}

function isAllowedShopeePage(sender) {
  return Boolean(sender?.tab?.id && isAllowedShopeeUrl(sender?.tab?.url || sender?.url || ''));
}

const shopeePageCaptures = new Map();

function sanitizeShopeePageCapture(message, sender) {
  if (!isAllowedShopeePage(sender)) throw new Error('Origem Shopee não autorizada.');
  const payload = message?.payload;
  if (!payload || payload.source !== 'shopee-page-response') throw new Error('Resposta Shopee inválida.');
  const pageIds = shopeeIdsFromUrl(sender.tab.url);
  const shopId = String(payload.shopId || '');
  const itemId = String(payload.itemId || '');
  if (!pageIds || pageIds.shopId !== shopId || pageIds.itemId !== itemId) {
    throw new Error('A resposta recebida não pertence ao produto aberto.');
  }
  const price = Number(payload.price);
  const priceMax = Number(payload.priceMax);
  const originalPrice = Number(payload.originalPrice);
  if (!Number.isFinite(price) || price <= 0 || price > 1000000) throw new Error('Preço Shopee inválido.');

  return {
    ok: true,
    source: 'shopee-page-response',
    confidence: 'high',
    shopId,
    itemId,
    modelId: payload.modelId ? String(payload.modelId).slice(0, 40) : null,
    price,
    priceMax: Number.isFinite(priceMax) && priceMax >= price && priceMax <= 1000000 ? priceMax : null,
    originalPrice: Number.isFinite(originalPrice) && originalPrice > price && originalPrice <= 1000000 ? originalPrice : null,
    title: String(payload.title || '').trim().slice(0, 300),
    image: String(payload.image || '').trim().slice(0, 2000),
    capturedAt: Number(payload.capturedAt) || Date.now(),
  };
}

async function waitForShopeePageCapture(tabId, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cached = shopeePageCaptures.get(tabId);
    if (cached && cached.expiresAt > Date.now()) return cached.product;
    await sleep(100);
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SENT_HISTORY_KEY = 'mlSentHistoryV2';
const IN_FLIGHT_KEY = 'mlInFlightSendV2';
const SEND_HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IN_FLIGHT_TTL_MS = 10 * 60 * 1000;
const RUN_STATE_TTL_MS = 6 * 60 * 60 * 1000;
const SEND_HISTORY_LIMIT = 500;
const DELIVERY_LOG_KEY = 'mlDeliveryLogV3';
const DELIVERY_LOG_LIMIT = 300;
const DELIVERY_LOG_TTL_MS = 30 * 24 * 60 * 60 * 1000;
let sendGuardMutex = Promise.resolve();
let deliveryLogMutex = Promise.resolve();

function isAllowedWhatsAppPage(sender) {
  try {
    const url = new URL(sender?.tab?.url || sender?.url || '');
    return url.protocol === 'https:' && url.hostname === 'web.whatsapp.com';
  } catch {
    return false;
  }
}

function withSendGuardLock(operation) {
  const task = sendGuardMutex.then(operation, operation);
  sendGuardMutex = task.catch(() => {});
  return task;
}

async function readSendGuardState() {
  const state = await chrome.storage.local.get([SENT_HISTORY_KEY, IN_FLIGHT_KEY]);
  const now = Date.now();
  const rawHistory = state[SENT_HISTORY_KEY] && typeof state[SENT_HISTORY_KEY] === 'object'
    ? state[SENT_HISTORY_KEY]
    : {};
  const history = Object.fromEntries(
    Object.entries(rawHistory)
      .filter(([, entry]) => Number(entry?.sentAt) > now - SEND_HISTORY_TTL_MS)
      .sort((left, right) => Number(right[1]?.sentAt) - Number(left[1]?.sentAt))
      .slice(0, SEND_HISTORY_LIMIT)
  );
  const rawInFlight = state[IN_FLIGHT_KEY];
  const inFlight = rawInFlight && Number(rawInFlight.reservedAt) > now - IN_FLIGHT_TTL_MS
    ? rawInFlight
    : null;
  if (Object.keys(history).length !== Object.keys(rawHistory).length || Boolean(rawInFlight) !== Boolean(inFlight)) {
    await chrome.storage.local.set({ [SENT_HISTORY_KEY]: history, [IN_FLIGHT_KEY]: inFlight });
  }
  return { history, inFlight };
}

function validFingerprint(value) {
  return typeof value === 'string' && /^v[23]-[a-f0-9-]{20,120}$/i.test(value);
}

function cleanMeta(value, maxLength = 300) {
  return String(value || '').trim().slice(0, maxLength);
}

function sanitizeQueueItem(item) {
  return {
    id: cleanMeta(item?.id, 120),
    title: cleanMeta(item?.title, 240),
    marketplace: cleanMeta(item?.marketplace, 40),
    price: cleanMeta(item?.price, 40),
    link: cleanMeta(item?.link, 800),
    image: cleanMeta(item?.image, 1200),
    text: cleanMeta(item?.text, 5000)
  };
}

function withDeliveryLogLock(operation) {
  const task = deliveryLogMutex.then(operation, operation);
  deliveryLogMutex = task.catch(() => {});
  return task;
}

async function appendDeliveryLog(message) {
  return withDeliveryLogLock(async () => {
    const state = await chrome.storage.local.get(DELIVERY_LOG_KEY);
    const now = Date.now();
    const current = Array.isArray(state[DELIVERY_LOG_KEY]) ? state[DELIVERY_LOG_KEY] : [];
    const entry = {
      id: `${now}-${cleanMeta(message.fingerprint, 90)}-${Math.random().toString(36).slice(2, 8)}`,
      fingerprint: cleanMeta(message.fingerprint, 90),
      status: ['sent', 'blocked', 'failed', 'uncertain'].includes(message.status) ? message.status : 'failed',
      mode: ['image', 'text'].includes(message.mode) ? message.mode : '',
      title: cleanMeta(message.title, 240),
      marketplace: cleanMeta(message.marketplace, 40),
      price: cleanMeta(message.price, 40),
      link: cleanMeta(message.link, 800),
      image: cleanMeta(message.image, 1200),
      queueId: cleanMeta(message.queueId, 80),
      detail: cleanMeta(message.detail, 500),
      timestamp: now
    };
    const entries = [entry, ...current]
      .filter((item) => Number(item?.timestamp) > now - DELIVERY_LOG_TTL_MS)
      .slice(0, DELIVERY_LOG_LIMIT);
    await chrome.storage.local.set({ [DELIVERY_LOG_KEY]: entries });
    return { ok: true, entry };
  });
}

async function getDiagnostics() {
  const [state, whatsAppTabs] = await Promise.all([
    chrome.storage.local.get(['mlQueue', 'mlQueueIndex', 'mlLastStatus', 'mlLastError', 'mlLastStatusAt', SENT_HISTORY_KEY, IN_FLIGHT_KEY, DELIVERY_LOG_KEY]),
    chrome.tabs.query({ url: 'https://web.whatsapp.com/*' })
  ]);
  const queue = Array.isArray(state.mlQueue) ? state.mlQueue : [];
  const history = state[SENT_HISTORY_KEY] && typeof state[SENT_HISTORY_KEY] === 'object' ? state[SENT_HISTORY_KEY] : {};
  const deliveryLog = Array.isArray(state[DELIVERY_LOG_KEY]) ? state[DELIVERY_LOG_KEY] : [];
  return {
    ok: true,
    version: chrome.runtime.getManifest().version,
    whatsAppOpen: whatsAppTabs.length > 0,
    queueCount: queue.length,
    queueIndex: Math.max(0, Number(state.mlQueueIndex) || 0),
    protectedCount: Object.keys(history).length,
    historyCount: deliveryLog.length,
    inFlight: Boolean(state[IN_FLIGHT_KEY]),
    lastStatus: cleanMeta(state.mlLastStatus, 500),
    lastError: cleanMeta(state.mlLastError, 500),
    lastStatusAt: Number(state.mlLastStatusAt) || 0,
    checkedAt: Date.now()
  };
}

async function getSendHistory() {
  const state = await chrome.storage.local.get([DELIVERY_LOG_KEY, IN_FLIGHT_KEY]);
  const now = Date.now();
  const entries = (Array.isArray(state[DELIVERY_LOG_KEY]) ? state[DELIVERY_LOG_KEY] : [])
    .filter((item) => Number(item?.timestamp) > now - DELIVERY_LOG_TTL_MS)
    .sort((left, right) => Number(right?.timestamp) - Number(left?.timestamp))
    .slice(0, DELIVERY_LOG_LIMIT);
  return { ok: true, entries, inFlight: state[IN_FLIGHT_KEY] || null };
}

async function handleSendGuard(message, sender) {
  if (!isAllowedWhatsAppPage(sender)) throw new Error('A trava só pode ser usada no WhatsApp Web.');
  if (!validFingerprint(message.fingerprint)) throw new Error('Identificador do anúncio inválido.');

  return withSendGuardLock(async () => {
    const { history, inFlight } = await readSendGuardState();
    const fingerprint = message.fingerprint;

    if (message.type === 'ML_SEND_GUARD_CHECK') {
      if (history[fingerprint]) return { ok: true, protected: true, reason: 'sent', sentAt: history[fingerprint].sentAt };
      if (inFlight?.fingerprint === fingerprint) return { ok: true, protected: true, reason: 'inflight', reservedAt: inFlight.reservedAt };
      if (inFlight) return { ok: true, protected: true, reason: 'busy', reservedAt: inFlight.reservedAt };
      return { ok: true, protected: false };
    }

    if (message.type === 'ML_SEND_GUARD_RESERVE') {
      if (history[fingerprint]) return { ok: false, duplicate: true, reason: 'sent', error: 'Anúncio já enviado; repetição bloqueada.' };
      if (inFlight) {
        return {
          ok: false,
          duplicate: inFlight.fingerprint === fingerprint,
          busy: inFlight.fingerprint !== fingerprint,
          reason: 'inflight',
          error: 'Já existe um envio em confirmação; repetição bloqueada.'
        };
      }
      await chrome.storage.local.set({
        [IN_FLIGHT_KEY]: {
          fingerprint,
          queueId: String(message.queueId || ''),
          index: Number(message.index) || 0,
          label: String(message.label || ''),
          mode: cleanMeta(message.mode, 20),
          title: cleanMeta(message.title, 240),
          marketplace: cleanMeta(message.marketplace, 40),
          price: cleanMeta(message.price, 40),
          link: cleanMeta(message.link, 800),
          image: cleanMeta(message.image, 1200),
          reservedAt: Date.now()
        }
      });
      return { ok: true, reserved: true };
    }

    if (message.type === 'ML_SEND_GUARD_COMMIT') {
      const sentAt = Date.now();
      history[fingerprint] = {
        sentAt,
        queueId: cleanMeta(message.queueId, 80),
        mode: cleanMeta(message.mode, 20),
        title: cleanMeta(message.title, 240),
        marketplace: cleanMeta(message.marketplace, 40),
        price: cleanMeta(message.price, 40),
        link: cleanMeta(message.link, 800),
        image: cleanMeta(message.image, 1200)
      };
      const trimmed = Object.fromEntries(
        Object.entries(history)
          .sort((left, right) => Number(right[1]?.sentAt) - Number(left[1]?.sentAt))
          .slice(0, SEND_HISTORY_LIMIT)
      );
      await chrome.storage.local.set({
        [SENT_HISTORY_KEY]: trimmed,
        [IN_FLIGHT_KEY]: null
      });
      return { ok: true, committed: true, sentAt };
    }

    throw new Error('Operação da trava desconhecida.');
  });
}

async function waitForTabComplete(tabId, timeoutMs = 20_000) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === 'complete') return current;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('A página da Shopee demorou para carregar.'));
    }, timeoutMs);
    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function captureShopeeApiFromTab(tabId) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async () => {
      const parseIds = (value) => {
        try {
          const url = new URL(value, location.href);
          const pathname = decodeURIComponent(url.pathname);
          const route = pathname.match(/\/(?:product|opaanlp)\/(\d+)\/(\d+)(?:\/|$)/i);
          const slug = pathname.match(/(?:^|[-/])i\.(\d+)\.(\d+)(?:\/|$)/i);
          const shopId = route?.[1] || slug?.[1] || url.searchParams.get('shop_id') || url.searchParams.get('shopid') || '';
          const itemId = route?.[2] || slug?.[2] || url.searchParams.get('item_id') || url.searchParams.get('itemid') || '';
          return /^\d+$/.test(shopId) && /^\d+$/.test(itemId) ? { shopId, itemId } : null;
        } catch {
          return null;
        }
      };
      const idCandidates = [
        location.href,
        document.querySelector('link[rel="canonical"]')?.href,
        document.querySelector('meta[property="og:url"]')?.content,
      ].filter(Boolean);
      const ids = idCandidates.map(parseIds).find(Boolean);
      if (!ids) return { ok: false, reason: 'product_ids_missing' };

      const money = (value) => {
        if (typeof value === 'string' && /[.,]/.test(value)) {
          const normalized = value.replace(/R\$\s*/gi, '').replace(/\s+/g, '').replace(/\./g, '').replace(',', '.');
          const parsed = Number(normalized);
          return Number.isFinite(parsed) && parsed > 0 && parsed <= 1000000 ? parsed : null;
        }
        const raw = Number(value);
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
        if (/^https?:\/\//i.test(image)) return image;
        return 'https://down-br.img.susercontent.com/file/' + image.replace(/^\/+/, '');
      };
      const csrfMatch = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/i);
      const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : '';
      const resourceEndpoints = performance.getEntriesByType('resource')
        .map((entry) => String(entry?.name || ''))
        .filter((value) => /\/api\/v4\/(?:pdp\/get_pc|item\/get)\?/i.test(value))
        .filter((value) => {
          const resourceIds = parseIds(value);
          return resourceIds?.shopId === ids.shopId && resourceIds?.itemId === ids.itemId;
        });
      const endpoints = [
        ...resourceEndpoints,
        '/api/v4/pdp/get_pc?item_id=' + encodeURIComponent(ids.itemId) + '&shop_id=' + encodeURIComponent(ids.shopId),
        '/api/v4/item/get?itemid=' + encodeURIComponent(ids.itemId) + '&shopid=' + encodeURIComponent(ids.shopId),
      ];

      const apiSignal = AbortSignal.timeout(8_000);
      for (const endpoint of [...new Set(endpoints)]) {
        try {
          const headers = {
            Accept: 'application/json, text/plain, */*',
            'x-api-source': 'pc',
            'x-requested-with': 'XMLHttpRequest',
          };
          if (csrfToken) headers['x-csrftoken'] = csrfToken;
          const response = await fetch(endpoint, {
            credentials: 'include',
            cache: 'no-store',
            headers,
            signal: apiSignal,
          });
          if (!response.ok || [401, 403, 418, 429].includes(response.status)) continue;
          if (!String(response.headers.get('content-type') || '').toLowerCase().includes('json')) continue;
          const payload = await response.json();
          if (payload?.error && Number(payload.error) !== 0) continue;
          const data = payload?.data || {};
          const item = data?.item && typeof data.item === 'object' ? data.item : data;
          if (!item || typeof item !== 'object') continue;

          const responseShopId = String(item.shopid ?? item.shop_id ?? item.shop?.shopid ?? item.shop?.shop_id ?? '');
          const responseItemId = String(item.itemid ?? item.item_id ?? '');
          if (responseShopId !== ids.shopId || responseItemId !== ids.itemId) continue;
          const currency = String(item.currency || data.currency || '').toUpperCase();
          if (currency && currency !== 'BRL') continue;

          const models = Array.isArray(item.models) ? item.models : [];
          const selectedModelId = String(item.selected_modelid ?? item.selected_model_id ?? data.selected_modelid ?? '');
          const selectedModel = selectedModelId
            ? models.find((model) => String(model?.modelid ?? model?.model_id ?? '') === selectedModelId)
            : null;
          const price = firstMoney([
            selectedModel?.price,
            item.price,
            item.price_min,
          ]);
          if (price === null) continue;

          const originalPriceCandidate = firstMoney([
            selectedModel?.price_before_discount,
            item.price_before_discount,
            item.price_min_before_discount,
          ]);
          const priceMax = firstMoney([item.price_max]);
          return {
            ok: true,
            source: 'shopee-api-tab',
            confidence: 'high',
            price,
            priceMax: priceMax !== null && priceMax >= price ? priceMax : null,
            originalPrice: originalPriceCandidate !== null && originalPriceCandidate > price
              ? originalPriceCandidate
              : null,
            title: String(item.name || '').trim(),
            image: imageUrl(item.image) || imageUrl(item.images),
            shopId: ids.shopId,
            itemId: ids.itemId,
            modelId: selectedModelId || null,
            capturedAt: Date.now(),
          };
        } catch {}
      }
      return { ok: false, reason: 'api_price_unavailable', shopId: ids.shopId, itemId: ids.itemId };
    }
  });
  return injection?.result || null;
}

async function captureShopeeProduct(url) {
  if (!isAllowedShopeeUrl(url)) throw new Error('Link da Shopee inválido.');
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url, active: true });
    tabId = tab.id;
    if (!tabId) throw new Error('Não foi possível abrir a página da Shopee.');
    const pageResponseProduct = await waitForShopeePageCapture(tabId, 12_000);
    if (pageResponseProduct?.price) return pageResponseProduct;

    await waitForTabComplete(tabId, 5_000).catch(() => chrome.tabs.get(tabId));
    await sleep(250);

    for (let attempt = 0; attempt < 4; attempt++) {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'ISOLATED',
        func: () => {
          const parsePrice = (value) => {
            const match = String(value || '').match(/(?:R\$\s*)?([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/);
            if (!match) return null;
            const number = Number(match[1].replace(/\./g, '').replace(',', '.'));
            return Number.isFinite(number) && number > 0 ? number : null;
          };
          const pricesFromText = (value) => {
            const matches = String(value || '').match(/R\$\s*[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}/g) || [];
            return [...new Set(matches.map(parsePrice).filter((price) => price !== null))];
          };
          const firstPrice = (selectors) => {
            for (const selector of selectors) {
              const node = document.querySelector(selector);
              const price = parsePrice(node?.textContent || node?.getAttribute?.('content'));
              if (price !== null) return price;
            }
            return null;
          };

          const titleNode = document.querySelector('[data-testid="pdp-product-title"], h1');
          const title = (titleNode?.textContent || document.querySelector('meta[property="og:title"]')?.content || '').trim();
          const image = (
            document.querySelector('meta[property="og:image"]')?.content ||
            document.querySelector('[data-testid="pdp-product-image"] img')?.src ||
            ''
          ).trim();

          let price = firstPrice([
            '[data-testid="pdp-product-price"]',
            '[itemprop="price"]',
            'meta[property="product:price:amount"]',
            '[class*="price-current"]',
          ]);
          let originalPrice = firstPrice([
            '[data-testid="pdp-product-price-before-discount"]',
            '[class*="price-before-discount"]',
          ]);

          if (price === null) {
            const pricePattern = /R\$\s*[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}/;
            const titleRect = titleNode?.getBoundingClientRect();
            const anchorTop = titleRect?.top ?? 100;
            const anchorBottom = titleRect?.bottom ?? 360;
            const candidates = [];

            for (const node of document.querySelectorAll('span, div')) {
              const ownText = String(node.textContent || '').replace(/\s+/g, ' ').trim();
              const visiblePrices = pricesFromText(ownText);
              if (ownText.length > 140 || visiblePrices.length === 0) continue;

              const candidate = visiblePrices[0];
              const parentText = String(node.parentElement?.innerText || '').replace(/\s+/g, ' ').trim();
              const previousText = String(node.previousElementSibling?.textContent || '').replace(/\s+/g, ' ').trim();
              const nextText = String(node.nextElementSibling?.textContent || '').replace(/\s+/g, ' ').trim();
              const localContext = [
                node.getAttribute?.('aria-label') || '',
                ownText,
                parentText.length <= 160 ? parentText : '',
                previousText.length <= 60 ? previousText : '',
                nextText.length <= 60 ? nextText : '',
              ].join(' ').replace(/\s+/g, ' ').trim();

              // Analisa somente o contexto local. Um ancestral grande contém também
              // o bloco de frete e fazia o preço principal ser descartado.
              if (/(?:frete|envio|entrega|parcela|cashback|cupom|\d+\s*x\s*R\$)/i.test(localContext)) continue;

              const style = getComputedStyle(node);
              const struck = /line-through/i.test(`${style.textDecorationLine} ${style.textDecoration}`);
              const fontSize = Number.parseFloat(style.fontSize) || 0;
              const rect = node.getBoundingClientRect();
              if (!rect.width || !rect.height) continue;
              if (rect.top < anchorTop - 80 || rect.top > anchorBottom + 500) continue;

              const verticalDistance = Math.abs(rect.top - anchorBottom);
              const rangeBonus = visiblePrices.length > 1 && /\s[-–]\s/.test(ownText) ? 80 : 0;
              const score = (struck ? -1000 : 0) + (fontSize * 40) + rangeBonus - Math.min(verticalDistance, 3000) / 20;
              candidates.push({ value: candidate, struck, score });
            }

            candidates.sort((left, right) => right.score - left.score);
            const current = candidates.find((candidate) => !candidate.struck);
            if (current) {
              price = current.value;
              const previous = candidates
                .filter((candidate) => candidate.struck && candidate.value > price)
                .sort((left, right) => right.value - left.value)[0];
              if (previous) originalPrice = previous.value;
            }
          }

          if (price === null) {
            for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
              try {
                const data = JSON.parse(script.textContent || 'null');
                const nodes = Array.isArray(data) ? data : [data];
                for (const node of nodes) {
                  const nodeTypes = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
                  if (!nodeTypes.some((type) => String(type).toLowerCase() === 'product')) continue;
                  const offers = node?.offers;
                  const offer = Array.isArray(offers) ? offers[0] : offers;
                  const candidate = Number(offer?.lowPrice || offer?.price);
                  if (Number.isFinite(candidate) && candidate > 0) {
                    price = candidate;
                    break;
                  }
                }
              } catch {}
              if (price !== null) break;
            }
          }

          return {
            price,
            originalPrice: originalPrice !== null && price !== null && originalPrice > price ? originalPrice : null,
            title,
            image,
          };
        }
      });
      const product = injection?.result;
      if (product?.price) return product;
      await sleep(350);
    }

    const apiProduct = await captureShopeeApiFromTab(tabId);
    if (apiProduct?.ok && apiProduct.price) return apiProduct;
    throw new Error('O preço não apareceu na página da Shopee.');
  } finally {
    if (tabId) {
      shopeePageCaptures.delete(tabId);
      try { await chrome.tabs.remove(tabId); } catch {}
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'ML_SHOPEE_PDP_CAPTURED') {
    try {
      const product = sanitizeShopeePageCapture(message, sender);
      shopeePageCaptures.set(sender.tab.id, { product, expiresAt: Date.now() + 30_000 });
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
    return;
  }

  if (message?.type === 'ML_GET_DIAGNOSTICS' || message?.type === 'ML_GET_SEND_HISTORY' || message?.type === 'ML_CLEAR_SEND_HISTORY') {
    (async () => {
      try {
        if (!isAllowedAppPage(sender)) throw new Error('Origem do aplicativo não autorizada.');
        if (message.type === 'ML_GET_DIAGNOSTICS') {
          sendResponse(await getDiagnostics());
          return;
        }
        if (message.type === 'ML_GET_SEND_HISTORY') {
          sendResponse(await getSendHistory());
          return;
        }
        const active = await chrome.storage.local.get(IN_FLIGHT_KEY);
        if (active[IN_FLIGHT_KEY]) {
          throw new Error('Existe um envio em confirmação. Pare a fila e aguarde antes de limpar o histórico.');
        }
        await chrome.storage.local.remove([SENT_HISTORY_KEY, DELIVERY_LOG_KEY]);
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (message?.type === 'ML_DELIVERY_LOG') {
    if (!isAllowedWhatsAppPage(sender)) {
      sendResponse({ ok: false, error: 'Origem do histórico não autorizada.' });
      return;
    }
    appendDeliveryLog(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (['ML_SEND_GUARD_CHECK', 'ML_SEND_GUARD_RESERVE', 'ML_SEND_GUARD_COMMIT'].includes(message?.type)) {
    handleSendGuard(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'ML_CAPTURE_SHOPEE_PRODUCT') {
    (async () => {
      try {
        if (!isAllowedAppPage(sender)) throw new Error('Origem do aplicativo não autorizada.');
        const product = await captureShopeeProduct(message.url);
        sendResponse({ ok: true, ...product });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (message?.type === 'ML_STORE_QUEUE') {
    (async () => {
      try {
        if (!isAllowedAppPage(sender)) throw new Error('Origem do aplicativo não autorizada.');

        const receivedItems = Array.isArray(message.items)
          ? message.items.filter((item) => item && typeof item.text === 'string').slice(0, 100).map(sanitizeQueueItem)
          : [];
        const seenItems = new Set();
        const items = receivedItems.filter((item) => {
          const key = `${item.image}\n${item.text}`;
          if (!item.text || seenItems.has(key)) return false;
          seenItems.add(key);
          return true;
        });
        if (!items.length) throw new Error('Fila vazia.');

        const execution = await chrome.storage.local.get(['mlRunState', IN_FLIGHT_KEY]);
        const activeRun = execution.mlRunState?.status === 'running'
          && Number(execution.mlRunState.startedAt) > Date.now() - RUN_STATE_TTL_MS;
        if (activeRun || execution[IN_FLIGHT_KEY]) {
          throw new Error('Já existe uma fila em execução ou confirmação. Pare e aguarde antes de enviar outra fila.');
        }

        await chrome.storage.local.set({
          mlQueue: items,
          mlDelaySeconds: Math.max(5, Math.min(300, Number(message.delaySeconds) || 30)),
          mlQueueCreatedAt: Date.now(),
          mlQueueIndex: 0,
          mlLastStatus: `Fila recebida: ${items.length} oferta(s).`,
          mlLastError: '',
          mlLastStatusAt: Date.now()
        });

        openWhatsApp();
        sendResponse({ ok: true, count: items.length });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (message?.type === 'ML_FETCH_IMAGE') {
    (async () => {
      try {
        const url = new URL(message.url);
        const allowedImageHost = /(^|\.)(mlstatic\.com|susercontent\.com|media-amazon\.com|ssl-images-amazon\.com|images-amazon\.com|alicdn\.com|aliexpress-media\.com)$/i.test(url.hostname);
        if (url.protocol !== 'https:' || !allowedImageHost) throw new Error('Domínio de imagem não permitido.');
        const response = await fetch(url.toString(), { credentials: 'omit', cache: 'no-store' });
        if (!response.ok) throw new Error(`Foto respondeu HTTP ${response.status}.`);
        const blob = await response.blob();
        if (!blob.type.startsWith('image/') || blob.size < 500 || blob.size > 5_000_000) throw new Error('Arquivo de imagem inválido ou maior que 5 MB.');
        const base64 = arrayBufferToBase64(await blob.arrayBuffer());
        sendResponse({ ok: true, type: blob.type, base64 });
      } catch (error) {
        chrome.storage.local.set({ mlLastError: error?.message || String(error), mlLastStatus: 'Falha ao baixar a imagem.', mlLastStatusAt: Date.now() });
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (message?.type !== 'ML_OPEN_WHATSAPP') return;
  openWhatsApp(sendResponse);
  return true;
});
