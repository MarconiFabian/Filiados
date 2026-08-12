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

async function captureShopeeProduct(url) {
  if (!isAllowedShopeeUrl(url)) throw new Error('Link da Shopee inválido.');
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    if (!tabId) throw new Error('Não foi possível abrir a página da Shopee.');
    await waitForTabComplete(tabId);
    await sleep(1_200);

    for (let attempt = 0; attempt < 24; attempt++) {
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

          if (price === null && titleNode) {
            const pricePattern = /R\$\s*[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}/;
            const titleRect = titleNode.getBoundingClientRect();
            const candidates = [];

            for (const node of document.querySelectorAll('span, div')) {
              const ownText = String(node.textContent || '').replace(/\s+/g, ' ').trim();
              if (ownText.length > 70 || !pricePattern.test(ownText)) continue;
              if ([...node.children].some((child) => pricePattern.test(String(child.textContent || '')))) continue;

              const candidate = parsePrice(ownText);
              if (candidate === null) continue;

              const nearContext = [
                node.getAttribute?.('aria-label') || '',
                node.parentElement?.innerText || '',
              ].join(' ').replace(/\s+/g, ' ').trim();

              // Frete, parcelas e entrega não são o preço principal do produto.
              if (/(?:frete|envio|entrega|parcela|\d+\s*x\s*R\$)/i.test(nearContext) && nearContext.length < 260) continue;

              const style = getComputedStyle(node);
              const struck = /line-through/i.test(`${style.textDecorationLine} ${style.textDecoration}`);
              const fontSize = Number.parseFloat(style.fontSize) || 0;
              const rect = node.getBoundingClientRect();
              if (!rect.width || !rect.height) continue;

              const verticalDistance = Math.abs(rect.top - titleRect.bottom);
              const score = (struck ? -1000 : 0) + (fontSize * 20) - Math.min(verticalDistance, 3000) / 100;
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
            for (const script of document.scripts) {
              const source = script.textContent || '';
              const match = source.match(/"price"\s*:\s*([0-9]{5,})/);
              if (!match) continue;
              const raw = Number(match[1]);
              const candidate = raw / 100000;
              if (Number.isFinite(candidate) && candidate > 0) {
                price = candidate;
                const oldMatch = source.match(/"price_before_discount"\s*:\s*([0-9]{5,})/);
                if (oldMatch) {
                  const oldCandidate = Number(oldMatch[1]) / 100000;
                  if (oldCandidate > candidate) originalPrice = oldCandidate;
                }
                break;
              }
            }
          }

          if (price === null) {
            for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
              try {
                const data = JSON.parse(script.textContent || 'null');
                const nodes = Array.isArray(data) ? data : [data];
                for (const node of nodes) {
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
      await sleep(650);
    }
    throw new Error('O preço não apareceu na página da Shopee.');
  } finally {
    if (tabId) {
      try { await chrome.tabs.remove(tabId); } catch {}
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
