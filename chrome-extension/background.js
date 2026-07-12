chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ML_FETCH_IMAGE') {
    (async () => {
      try {
        const url = new URL(message.url);
        if (url.protocol !== 'https:' || !/(^|\.)mlstatic\.com$/i.test(url.hostname)) throw new Error('Domínio de imagem não permitido.');
        const response = await fetch(url.toString(), { credentials: 'omit', cache: 'no-store' });
        if (!response.ok) throw new Error(`Foto respondeu HTTP ${response.status}.`);
        const blob = await response.blob();
        if (!blob.type.startsWith('image/') || blob.size < 500 || blob.size > 10_000_000) throw new Error('Arquivo de imagem inválido.');
        const bytes = [...new Uint8Array(await blob.arrayBuffer())];
        sendResponse({ ok: true, type: blob.type, bytes });
      } catch (error) {
        chrome.storage.local.set({ mlLastError: error?.message || String(error), mlLastStatus: 'Falha ao baixar a imagem.', mlLastStatusAt: Date.now() });
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }
  if (message?.type !== 'ML_OPEN_WHATSAPP') return;
  chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
    if (tabs.length) {
      chrome.tabs.update(tabs[0].id, { active: true });
      sendResponse({ ok: true, reused: true });
      return;
    }
    chrome.tabs.create({ url: 'https://web.whatsapp.com/' }, () => sendResponse({ ok: true }));
  });
  return true;
});
