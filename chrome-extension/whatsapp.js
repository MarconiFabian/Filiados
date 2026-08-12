(() => {
  if (window.__mlAfiliadosExtensionLoaded) return;
  window.__mlAfiliadosExtensionLoaded = true;

  let stopped = false;
  let running = false;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const SEND_GUARD_TYPES = {
    CHECK: 'ML_SEND_GUARD_CHECK',
    RESERVE: 'ML_SEND_GUARD_RESERVE',
    COMMIT: 'ML_SEND_GUARD_COMMIT'
  };

  function normalizeFingerprintPart(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function canonicalProductIdentity(item) {
    const marketplace = normalizeFingerprintPart(item?.marketplace || 'unknown');
    try {
      const url = new URL(String(item?.link || ''));
      const host = url.hostname.toLowerCase();
      const path = decodeURIComponent(url.pathname).replace(/\/+$/, '');

      const mercadoLivre = path.match(/\b(MLB-?\d{6,})\b/i);
      const amazon = path.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i);
      const aliExpress = path.match(/\/item\/(\d+)\.html/i);
      const shopee = path.match(/\/(?:product|opaanlp)\/(\d+)\/(\d+)(?:\/|$)/i)
        || path.match(/(?:^|[-/])i\.(\d+)\.(\d+)(?:\/|$)/i);

      if (mercadoLivre) return `mercado-livre:${mercadoLivre[1].replace('-', '').toUpperCase()}`;
      if (amazon) return `amazon:${amazon[1].toUpperCase()}`;
      if (aliExpress) return `aliexpress:${aliExpress[1]}`;
      if (shopee) return `shopee:${shopee[1]}:${shopee[2]}`;

      const keep = new URLSearchParams();
      for (const key of ['item_id', 'itemid', 'shop_id', 'shopid']) {
        if (url.searchParams.has(key)) keep.set(key, url.searchParams.get(key));
      }
      return `${marketplace}:${host}${path}${keep.size ? `?${keep}` : ''}`;
    } catch {
      return '';
    }
  }

  function fingerprintItem(item) {
    const identity = canonicalProductIdentity(item);
    const image = normalizeFingerprintPart(item?.image).replace(/[?#].*$/, '');
    const title = normalizeFingerprintPart(item?.title);
    const source = identity || `${image}\n${title}`;
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < source.length; index++) {
      const code = source.charCodeAt(index);
      first ^= code;
      first = Math.imul(first, 0x01000193);
      second ^= code + index;
      second = Math.imul(second, 0x85ebca6b);
    }
    return `v3-${(first >>> 0).toString(16).padStart(8, '0')}-${(second >>> 0).toString(16).padStart(8, '0')}-${source.length}`;
  }

  async function sendGuard(type, payload) {
    const result = await chrome.runtime.sendMessage({ type, ...payload });
    if (result?.ok) return result;
    const error = new Error(result?.error || 'A trava contra duplicação não respondeu.');
    error.duplicateBlocked = Boolean(result?.duplicate);
    error.guardBusy = Boolean(result?.busy);
    error.guardReason = result?.reason || '';
    throw error;
  }

  async function logDelivery(status, item, payload, detail = '', mode = '') {
    try {
      await chrome.runtime.sendMessage({
        type: 'ML_DELIVERY_LOG',
        status,
        fingerprint: payload.fingerprint,
        queueId: payload.queueId,
        title: item?.title || '',
        marketplace: item?.marketplace || '',
        price: item?.price || '',
        link: item?.link || '',
        image: item?.image || '',
        detail,
        mode
      });
    } catch {}
  }

  function outgoingMessageCount() {
    return document.querySelectorAll('#main [data-id^="true_"], #main [data-id*="true_"]').length;
  }

  async function waitForSendConfirmation(previousCount, previewRoot) {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (outgoingMessageCount() > previousCount) return true;
      if (previewRoot && !document.contains(previewRoot)) {
        await sleep(500);
        if (outgoingMessageCount() > previousCount) return true;
      }
      await sleep(200);
    }
    return false;
  }

  async function clickWithProtection(button, payload) {
    await sendGuard(SEND_GUARD_TYPES.RESERVE, payload);
    const previousCount = outgoingMessageCount();
    const previewRoot = button.closest?.('[role="dialog"]') || null;
    try {
      button.click();
    } catch (error) {
      const uncertain = new Error(`O clique de envio ficou sem confirmação: ${error?.message || error}`);
      uncertain.sendWasClicked = true;
      throw uncertain;
    }

    const confirmed = await waitForSendConfirmation(previousCount, previewRoot);
    if (!confirmed) {
      const uncertain = new Error('O WhatsApp não confirmou visualmente a nova mensagem. Confira a conversa; não haverá repetição automática.');
      uncertain.sendWasClicked = true;
      throw uncertain;
    }

    try {
      await sendGuard(SEND_GUARD_TYPES.COMMIT, payload);
    } catch (error) {
      const uncertain = new Error(`O anúncio foi confirmado na conversa, mas o registro final falhou: ${error?.message || error}`);
      uncertain.sendWasClicked = true;
      throw uncertain;
    }
  }

  function createPanel() {
    let panel = document.getElementById('ml-afiliados-extension-panel');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = 'ml-afiliados-extension-panel';
    panel.style.cssText = 'position:fixed;right:18px;top:70px;width:340px;z-index:2147483647;background:#fff;color:#17212b;border:2px solid #00a884;border-radius:16px;padding:16px;font:14px Arial,sans-serif;box-shadow:0 12px 45px rgba(0,0,0,.35)';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <strong style="font-size:17px;color:#008069">ML Afiliados Sender</strong>
        <button data-ml="close" style="border:0;background:none;font-size:24px;cursor:pointer">&times;</button>
      </div>
      <p data-ml="status" style="min-height:42px;line-height:1.4;margin:12px 0">Carregando fila...</p>
      <div style="height:9px;background:#e9edef;border-radius:8px;overflow:hidden"><div data-ml="bar" style="height:100%;width:0;background:#00a884;transition:width .25s"></div></div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button data-ml="start" style="flex:1;padding:11px;border:0;border-radius:9px;background:#00a884;color:#fff;font-weight:800;cursor:pointer">INICIAR</button>
        <button data-ml="stop" style="flex:1;padding:11px;border:0;border-radius:9px;background:#d93025;color:#fff;font-weight:800;cursor:pointer">PARAR</button>
      </div>
      <small style="display:block;margin-top:10px;color:#667781">Escolha a conversa antes de iniciar. Confira o primeiro envio.</small>`;
    document.body.appendChild(panel);
    panel.querySelector('[data-ml="close"]').onclick = () => { stopped = true; panel.remove(); };
    panel.querySelector('[data-ml="stop"]').onclick = () => { stopped = true; setStatus('Envio interrompido.'); };
    panel.querySelector('[data-ml="start"]').onclick = run;
    return panel;
  }

  function setStatus(text, error = false) {
    const panel = createPanel();
    const node = panel.querySelector('[data-ml="status"]');
    node.textContent = text;
    node.style.color = error ? '#b3261e' : '#17212b';
    chrome.storage.local.set({
      mlLastStatus: text,
      mlLastError: error ? text : '',
      mlLastStatusAt: Date.now()
    });
  }

  function setProgress(current, total) {
    const bar = createPanel().querySelector('[data-ml="bar"]');
    bar.style.width = `${total ? Math.round((current / total) * 100) : 0}%`;
  }

  function composer() {
    return document.querySelector('#main footer [contenteditable="true"]') ||
      document.querySelector('#main [role="textbox"][contenteditable="true"]');
  }

  function sendButton(root = document) {
    const icon = root.querySelector('[data-icon="send"],[data-icon="wds-ic-send-filled"]');
    return icon?.closest('button') || icon?.parentElement || null;
  }

  function pasteText(element, text) {
    element.focus();
    const transfer = new DataTransfer();
    transfer.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  }

  async function sendText(text, guardPayload) {
    const input = composer();
    if (!input) throw new Error('Campo de mensagem não encontrado.');
    pasteText(input, text);
    await sleep(900);
    const button = sendButton(document);
    if (!button) throw new Error('Botão de enviar texto não encontrado.');
    await clickWithProtection(button, { ...guardPayload, mode: 'text' });
    await sleep(1800);
  }

  async function downloadImage(url) {
    if (!url || !/^https:\/\//i.test(url)) throw new Error('URL da foto inválida.');
    const result = await chrome.runtime.sendMessage({ type: 'ML_FETCH_IMAGE', url });
    if (!result?.ok) throw new Error(result?.error || 'A extensão não conseguiu baixar a foto.');
    const type = result.type || 'image/jpeg';
    if (typeof result.base64 !== 'string' || !result.base64) throw new Error('A extensão recebeu uma foto vazia.');
    const binary = atob(result.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const extension = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    return new File([bytes], `oferta.${extension}`, { type });
  }

  async function findImageInput() {
    const pick = () => [...document.querySelectorAll('input[type="file"]')].find((input) => (input.accept || '').toLowerCase().includes('image'));
    let input = pick();
    if (input) return input;
    const icon = document.querySelector('[data-icon="plus-rounded"],[data-icon="clip"]');
    const attach = document.querySelector('button[aria-label*="nexar" i],button[title*="nexar" i]') || icon?.closest('button') || icon;
    if (attach) attach.click();
    await sleep(700);
    return pick() || null;
  }

  async function waitForPreview() {
    for (let attempt = 0; attempt < 60 && !stopped; attempt++) {
      const dialog = document.querySelector('div[role="dialog"]');
      const caption = dialog?.querySelector('[contenteditable="true"],[data-lexical-editor="true"]') ||
        [...document.querySelectorAll('[data-lexical-editor="true"]')].find((node) => !node.closest('footer'));
      const button = sendButton(dialog || document);
      if (caption || (dialog && button)) return { dialog, caption, button };
      await sleep(250);
    }
    return null;
  }

  function pasteImage(file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const target = composer() || document.body;
    target.focus?.();
    target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  }

  function dropImage(file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const target = document.querySelector('#main') || composer() || document.body;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }
  }

  async function openImagePreview(file) {
    pasteImage(file);
    let preview = await waitForPreview();
    if (preview) return preview;

    dropImage(file);
    preview = await waitForPreview();
    if (preview) return preview;

    const input = await findImageInput();
    if (!input) return null;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return waitForPreview();
  }

  async function attachAndSend(item, guardPayload) {
    const file = await downloadImage(item.image);
    const preview = await openImagePreview(file);
    if (!preview) throw new Error('A prévia da imagem não abriu.');
    if (preview.caption) pasteText(preview.caption, item.text);
    await sleep(900);
    const button = sendButton(preview.dialog || document) || preview.button;
    if (!button) throw new Error('Botão de enviar imagem não encontrado.');
    await clickWithProtection(button, { ...guardPayload, mode: 'image' });
    await sleep(2200);
  }

  async function run() {
    if (running) return;
    if (!composer()) { setStatus('Selecione primeiro a conversa ou grupo.', true); return; }

    running = true;
    stopped = false;
    const start = createPanel().querySelector('[data-ml="start"]');
    start.disabled = true;
    start.style.opacity = '.55';
    let photoSentCount = 0;
    let textFallbackCount = 0;
    let protectedCount = 0;

    try {
      const state = await chrome.storage.local.get(['mlQueue', 'mlDelaySeconds', 'mlQueueIndex', 'mlQueueCreatedAt']);
      const rawQueue = Array.isArray(state.mlQueue) ? state.mlQueue : [];
      const seenItems = new Set();
      const queue = rawQueue.filter((item) => {
        const key = fingerprintItem(item);
        if (!String(item?.text || '').trim() || seenItems.has(key)) return false;
        seenItems.add(key);
        return true;
      });
      if (queue.length !== rawQueue.length) {
        await chrome.storage.local.set({
          mlQueue: queue,
          mlLastStatus: `${rawQueue.length - queue.length} item(ns) duplicado(s) ou vazio(s) removido(s) da fila.`
        });
      }

      const delay = Math.max(5, Math.min(300, Number(state.mlDelaySeconds) || 30));
      const queueId = String(state.mlQueueCreatedAt || Date.now());
      await chrome.storage.local.set({ mlRunState: { status: 'running', queueId, startedAt: Date.now() } });
      let index = Math.max(0, Math.min(queue.length, Number(state.mlQueueIndex) || 0));
      if (!queue.length) {
        setStatus('A fila está vazia. Volte ao ML Afiliados Pro e envie novamente.', true);
        return;
      }

      const advance = async (nextIndex) => {
        const current = await chrome.storage.local.get(['mlQueueCreatedAt', 'mlRunState']);
        if (String(current.mlQueueCreatedAt || '') !== queueId || current.mlRunState?.queueId !== queueId) {
          throw new Error('A fila mudou durante o envio. Execução pausada para evitar duplicação.');
        }
        await chrome.storage.local.set({ mlQueueIndex: nextIndex });
        setProgress(nextIndex, queue.length);
      };

      for (; index < queue.length && !stopped; index++) {
        const label = `[${index + 1}/${queue.length}]`;
        const fingerprint = fingerprintItem(queue[index]);
        const guardPayload = {
          fingerprint,
          queueId,
          index,
          label,
          title: queue[index]?.title || '',
          marketplace: queue[index]?.marketplace || '',
          price: queue[index]?.price || '',
          link: queue[index]?.link || '',
          image: queue[index]?.image || ''
        };

        const protection = await sendGuard(SEND_GUARD_TYPES.CHECK, guardPayload);
        if (protection.protected) {
          if (protection.reason === 'busy') {
            setStatus(`${label} Outro envio está em confirmação. A fila foi pausada para não duplicar anúncios.`, true);
            stopped = true;
            break;
          }
          protectedCount++;
          await advance(index + 1);
          await logDelivery('blocked', queue[index], guardPayload, 'Anúncio já enviado ou em confirmação.');
          setStatus(`${label} Ignorado pela trava: este anúncio já foi enviado ou ficou em confirmação.`);
          continue;
        }

        try {
          setStatus(`${label} Baixando e anexando foto...`);
          await attachAndSend(queue[index], guardPayload);
          photoSentCount++;
          await advance(index + 1);
          await logDelivery('sent', queue[index], guardPayload, 'Enviado com foto.', 'image');
          setStatus(`${label} Enviado com foto e registrado pela trava.`);
        } catch (error) {
          if (error?.guardBusy) {
            setStatus(`${label} Outro envio está em confirmação. A fila foi pausada para evitar duplicação.`, true);
            stopped = true;
            break;
          }
          if (error?.duplicateBlocked) {
            protectedCount++;
            await advance(index + 1);
            await logDelivery('blocked', queue[index], guardPayload, 'Duplicação bloqueada antes do clique.');
            setStatus(`${label} Envio duplicado bloqueado com segurança.`);
            continue;
          }
          if (error?.sendWasClicked) {
            await logDelivery('uncertain', queue[index], guardPayload, error?.message || String(error), 'image');
            setStatus(`${label} ENVIO BLOQUEADO PARA CONFERÊNCIA: ${error?.message || error}. A extensão não repetirá este anúncio.`, true);
            stopped = true;
            break;
          }

          const imageError = error?.message || String(error);
          try {
            setStatus(`${label} Foto falhou antes do envio; enviando o anúncio uma única vez em texto...`, true);
            await sendText(queue[index].text, guardPayload);
            textFallbackCount++;
            await advance(index + 1);
            await logDelivery('sent', queue[index], guardPayload, `Enviado em texto porque a foto falhou: ${imageError}`, 'text');
            await chrome.storage.local.set({ mlLastError: `Foto não enviada: ${imageError}` });
            setStatus(`${label} Enviado uma vez em texto e registrado. Foto não enviada: ${imageError}`, true);
          } catch (textError) {
            if (textError?.guardBusy) {
              setStatus(`${label} Outro envio está em confirmação. A fila foi pausada para evitar duplicação.`, true);
              stopped = true;
              break;
            }
            if (textError?.duplicateBlocked) {
              protectedCount++;
              await advance(index + 1);
              await logDelivery('blocked', queue[index], guardPayload, 'Segunda tentativa bloqueada.');
              setStatus(`${label} Segundo envio bloqueado pela trava.`);
              continue;
            }
            if (textError?.sendWasClicked) {
              await logDelivery('uncertain', queue[index], guardPayload, textError?.message || String(textError), 'text');
              setStatus(`${label} ENVIO BLOQUEADO PARA CONFERÊNCIA: ${textError?.message || textError}. Não haverá tentativa automática.`, true);
            } else {
              await logDelivery('failed', queue[index], guardPayload, `Foto: ${imageError}; texto: ${textError?.message || textError}`);
              setStatus(`${label} NÃO ENVIADO: foto: ${imageError}; texto: ${textError?.message || textError}`, true);
            }
            stopped = true;
            break;
          }
        }

        if (index < queue.length - 1) {
          for (let left = delay; left > 0 && !stopped; left--) {
            setStatus(`${label} Próximo envio em ${left}s...`);
            await sleep(1000);
          }
        }
      }

      if (!stopped && index >= queue.length) {
        const parts = [
          photoSentCount ? `${photoSentCount} com foto` : '',
          textFallbackCount ? `${textFallbackCount} em texto` : '',
          protectedCount ? `${protectedCount} duplicado(s) bloqueado(s)` : ''
        ].filter(Boolean);
        setStatus(`Concluído: ${parts.join(', ') || 'nenhum envio necessário'}.`, textFallbackCount > 0);
        await chrome.storage.local.set({ mlQueueIndex: 0 });
      }
    } catch (error) {
      setStatus(`Falha inesperada: ${error?.message || error}`, true);
    } finally {
      running = false;
      await chrome.storage.local.set({ mlRunState: { status: 'idle', stoppedAt: Date.now() } }).catch(() => {});
      start.disabled = false;
      start.style.opacity = '1';
    }
  }
  async function refreshPanel() {
    const state = await chrome.storage.local.get(['mlQueue', 'mlQueueIndex']);
    const count = Array.isArray(state.mlQueue) ? state.mlQueue.length : 0;
    setProgress(Number(state.mlQueueIndex) || 0, count);
    setStatus(count ? `${count} oferta(s) carregada(s). Escolha o grupo e clique em INICIAR.` : 'Fila vazia. Envie ofertas pelo ML Afiliados Pro.');
  }

  createPanel();
  refreshPanel();
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.mlQueue) refreshPanel();
  });
})();
