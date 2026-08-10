const SOURCE = 'ml-afiliados-pro';

function postAck(requestId, result) {
  window.postMessage({
    source: 'ml-afiliados-extension',
    type: 'ML_EXTENSION_ACK',
    requestId,
    ...result
  }, location.origin);
}

function sendToExtension(message) {
  return new Promise((resolve, reject) => {
    if (!globalThis.chrome?.runtime?.id || typeof chrome.runtime.sendMessage !== 'function') {
      reject(new Error('A extensão foi atualizada ou desconectada. Recarregue esta página e tente novamente.'));
      return;
    }

    try {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message || 'Não foi possível falar com a extensão.'));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

window.addEventListener('message', async (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = event.data;
  if (message?.source !== SOURCE || message?.type !== 'ML_QUEUE_TO_EXTENSION') return;

  const receivedItems = Array.isArray(message.items)
    ? message.items.filter((item) => item && typeof item.text === 'string').slice(0, 100)
    : [];
  const seenItems = new Set();
  const items = receivedItems.filter((item) => {
    const key = `${String(item.image || '').trim()}\n${item.text.trim()}`;
    if (seenItems.has(key)) return false;
    seenItems.add(key);
    return true;
  });

  if (!items.length) {
    postAck(message.requestId, { ok: false, error: 'Fila vazia.' });
    return;
  }

  try {
    const response = await sendToExtension({
      type: 'ML_STORE_QUEUE',
      requestId: message.requestId,
      items,
      delaySeconds: message.delaySeconds
    });
    postAck(message.requestId, response?.ok
      ? { ok: true, count: response.count }
      : { ok: false, error: response?.error || 'A extensão não conseguiu salvar a fila.' });
  } catch (error) {
    postAck(message.requestId, {
      ok: false,
      error: error?.message || 'Falha de comunicação com a extensão. Recarregue a página.'
    });
  }
});

window.postMessage({ source: 'ml-afiliados-extension', type: 'ML_EXTENSION_READY' }, location.origin);
