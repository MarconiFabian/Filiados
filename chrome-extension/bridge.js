const SOURCE = 'ml-afiliados-pro';

function postExtensionMessage(type, requestId, result) {
  window.postMessage({
    source: 'ml-afiliados-extension',
    type,
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

async function forwardRequest(message, extensionType, responseType) {
  try {
    const response = await sendToExtension({ type: extensionType, requestId: message.requestId });
    postExtensionMessage(responseType, message.requestId, response || { ok: false, error: 'A extensão não respondeu.' });
  } catch (error) {
    postExtensionMessage(responseType, message.requestId, {
      ok: false,
      error: error?.message || 'Falha de comunicação com a extensão. Recarregue a página.'
    });
  }
}

window.addEventListener('message', async (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = event.data;
  if (message?.source !== SOURCE) return;

  if (message.type === 'ML_DIAGNOSTIC_REQUEST') {
    await forwardRequest(message, 'ML_GET_DIAGNOSTICS', 'ML_DIAGNOSTIC_ACK');
    return;
  }
  if (message.type === 'ML_HISTORY_REQUEST') {
    await forwardRequest(message, 'ML_GET_SEND_HISTORY', 'ML_HISTORY_ACK');
    return;
  }
  if (message.type === 'ML_HISTORY_CLEAR') {
    await forwardRequest(message, 'ML_CLEAR_SEND_HISTORY', 'ML_HISTORY_CLEAR_ACK');
    return;
  }

  if (message.type === 'ML_SHOPEE_CAPTURE') {
    postExtensionMessage('ML_SHOPEE_CAPTURE_STARTED', message.requestId, {});
    try {
      const response = await sendToExtension({
        type: 'ML_CAPTURE_SHOPEE_PRODUCT',
        requestId: message.requestId,
        url: message.url
      });
      postExtensionMessage('ML_SHOPEE_CAPTURE_ACK', message.requestId, response || { ok: false, error: 'A extensão não respondeu.' });
    } catch (error) {
      postExtensionMessage('ML_SHOPEE_CAPTURE_ACK', message.requestId, {
        ok: false,
        error: error?.message || 'Falha ao capturar o preço da Shopee.'
      });
    }
    return;
  }

  if (message.type !== 'ML_QUEUE_TO_EXTENSION') return;

  const receivedItems = Array.isArray(message.items)
    ? message.items.filter((item) => item && typeof item.text === 'string').slice(0, 100)
    : [];
  const seenItems = new Set();
  const items = receivedItems.filter((item) => {
    const key = `${String(item.image || '').trim()}\n${item.text.trim()}`;
    if (!item.text.trim() || seenItems.has(key)) return false;
    seenItems.add(key);
    return true;
  });

  if (!items.length) {
    postExtensionMessage('ML_EXTENSION_ACK', message.requestId, { ok: false, error: 'Fila vazia.' });
    return;
  }

  try {
    const response = await sendToExtension({
      type: 'ML_STORE_QUEUE',
      requestId: message.requestId,
      items,
      delaySeconds: message.delaySeconds
    });
    postExtensionMessage('ML_EXTENSION_ACK', message.requestId, response?.ok
      ? { ok: true, count: response.count }
      : { ok: false, error: response?.error || 'A extensão não conseguiu salvar a fila.' });
  } catch (error) {
    postExtensionMessage('ML_EXTENSION_ACK', message.requestId, {
      ok: false,
      error: error?.message || 'Falha de comunicação com a extensão. Recarregue a página.'
    });
  }
});

window.postMessage({
  source: 'ml-afiliados-extension',
  type: 'ML_EXTENSION_READY',
  version: chrome.runtime?.getManifest?.().version || ''
}, location.origin);
