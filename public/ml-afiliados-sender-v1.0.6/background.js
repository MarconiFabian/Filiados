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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'ML_STORE_QUEUE') {
    (async () => {
      try {
        if (!isAllowedAppPage(sender)) throw new Error('Origem do aplicativo não autorizada.');

        const receivedItems = Array.isArray(message.items)
          ? message.items.filter((item) => item && typeof item.text === 'string').slice(0, 100)
          : [];
        const seenItems = new Set();
        const items = receivedItems.filter((item) => {
          const image = String(item.image || '').trim();
          const text = item.text.trim();
          const key = `${image}\n${text}`;
          if (!text || seenItems.has(key)) return false;
          seenItems.add(key);
          return true;
        });
        if (!items.length) throw new Error('Fila vazia.');

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
        if (url.protocol !== 'https:' || !/(^|\.)mlstatic\.com$/i.test(url.hostname)) throw new Error('Domínio de imagem não permitido.');
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
