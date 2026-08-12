async function refresh() {
  const s = await chrome.storage.local.get(['mlQueue', 'mlQueueIndex', 'mlLastStatus', 'mlLastError', 'mlLastStatusAt', 'mlSentHistoryV2', 'mlInFlightSendV2', 'mlDeliveryLogV3']);
  const total = Array.isArray(s.mlQueue) ? s.mlQueue.length : 0;
  const protectedCount = s.mlSentHistoryV2 && typeof s.mlSentHistoryV2 === 'object' ? Object.keys(s.mlSentHistoryV2).length : 0;
  const historyCount = Array.isArray(s.mlDeliveryLogV3) ? s.mlDeliveryLogV3.length : 0;
  document.getElementById('status').textContent = total
    ? `${total} oferta(s) na fila. Posição: ${Number(s.mlQueueIndex) || 0}/${total}. Protegidas: ${protectedCount}. Histórico: ${historyCount}.`
    : `Nenhuma oferta na fila. Protegidas contra repetição: ${protectedCount}. Histórico: ${historyCount}.`;
  const diagnostic = document.getElementById('diagnostic');
  const time = s.mlLastStatusAt ? new Date(s.mlLastStatusAt).toLocaleTimeString('pt-BR') : '';
  diagnostic.textContent = s.mlLastError ? `Erro ${time}: ${s.mlLastError}` : (s.mlLastStatus ? `${time}: ${s.mlLastStatus}` : 'Aguardando o primeiro envio.');
  diagnostic.className = s.mlLastError ? 'error' : '';
}
document.getElementById('open').onclick = () => chrome.runtime.sendMessage({ type: 'ML_OPEN_WHATSAPP' });
document.getElementById('clear').onclick = async () => {
  await chrome.storage.local.remove(['mlQueue', 'mlQueueIndex', 'mlDelaySeconds', 'mlQueueCreatedAt', 'mlLastError', 'mlLastStatus', 'mlLastStatusAt']);
  refresh();
};
document.getElementById('clearHistory').onclick = async () => {
  const active = await chrome.storage.local.get(['mlInFlightSendV2', 'mlRunState']);
  if (active.mlInFlightSendV2 || active.mlRunState?.status === 'running') {
    alert('Pare a fila e aguarde a confirmação do envio atual antes de limpar o histórico.');
    return;
  }
  if (!confirm('Liberar anúncios enviados nos últimos 7 dias? Eles poderão ser enviados novamente.')) return;
  await chrome.storage.local.remove(['mlSentHistoryV2', 'mlDeliveryLogV3']);
  await chrome.storage.local.set({ mlLastStatus: 'Histórico de proteção liberado manualmente.', mlLastStatusAt: Date.now(), mlLastError: '' });
  refresh();
};
chrome.storage.onChanged.addListener(refresh);
refresh();