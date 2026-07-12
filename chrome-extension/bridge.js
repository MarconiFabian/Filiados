const SOURCE = 'ml-afiliados-pro';

window.addEventListener('message', async (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = event.data;
  if (message?.source !== SOURCE || message?.type !== 'ML_QUEUE_TO_EXTENSION') return;

  const items = Array.isArray(message.items)
    ? message.items.filter((item) => item && typeof item.text === 'string').slice(0, 100)
    : [];

  if (!items.length) {
    window.postMessage({ source: 'ml-afiliados-extension', type: 'ML_EXTENSION_ACK', requestId: message.requestId, ok: false, error: 'Fila vazia.' }, location.origin);
    return;
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

  chrome.runtime.sendMessage({ type: 'ML_OPEN_WHATSAPP' });
  window.postMessage({ source: 'ml-afiliados-extension', type: 'ML_EXTENSION_ACK', requestId: message.requestId, ok: true, count: items.length }, location.origin);
});

window.postMessage({ source: 'ml-afiliados-extension', type: 'ML_EXTENSION_READY' }, location.origin);
