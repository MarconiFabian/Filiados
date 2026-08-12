(() => {
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.source !== 'ml-shopee-page' || message?.type !== 'ML_SHOPEE_PDP_CAPTURED') return;
    chrome.runtime.sendMessage({
      type: 'ML_SHOPEE_PDP_CAPTURED',
      payload: message.payload,
    }).catch(() => {});
  });
})();
