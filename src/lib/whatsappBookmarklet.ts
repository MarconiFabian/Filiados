export interface WhatsAppQueueItem {
  image: string;
  text: string;
}

export function buildWhatsAppSenderBookmarklet(items: WhatsAppQueueItem[], delaySeconds: number): string {
  const data = JSON.stringify(items).replace(/</g, '\\u003c');
  const delay = Math.max(5, Math.min(300, Number(delaySeconds) || 30)) * 1000;

  return `javascript:(async function(){
var DATA=${data},DELAY=${delay},STOP=false,failed=0;
if(!Array.isArray(DATA)||!DATA.length){alert('Fila vazia.');return}
if(location.hostname!=='web.whatsapp.com'){alert('Abra o WhatsApp Web primeiro.');return}
var old=document.getElementById('__ml_sender_v22__');if(old)old.remove();
var box=document.createElement('div');box.id='__ml_sender_v22__';box.style.cssText='position:fixed;top:70px;right:18px;width:340px;background:#fff;color:#111;border:3px solid #00a884;border-radius:16px;padding:16px;z-index:2147483647;font:14px Arial,sans-serif;box-shadow:0 12px 48px rgba(0,0,0,.4)';
box.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;font-size:17px;font-weight:800;color:#008069"><span>Envio com fotos V22</span><button id="__ml_close__" style="border:0;background:none;font-size:24px;cursor:pointer">&times;</button></div><div id="__ml_status__" style="min-height:44px;margin:12px 0;line-height:1.45">Preparando...</div><div style="height:9px;background:#eee;border-radius:8px;overflow:hidden"><div id="__ml_progress__" style="height:100%;width:0;background:#00a884;transition:width .3s"></div></div><button id="__ml_stop__" style="width:100%;margin-top:12px;padding:10px;border:0;border-radius:9px;background:#d93025;color:#fff;font-weight:800;cursor:pointer">PARAR</button>';
document.body.appendChild(box);
var status=document.getElementById('__ml_status__'),bar=document.getElementById('__ml_progress__');
document.getElementById('__ml_close__').onclick=function(){STOP=true;box.remove()};document.getElementById('__ml_stop__').onclick=function(){STOP=true;setStatus('Envio interrompido.')};
function setStatus(t,bad){if(status){status.textContent=t;status.style.color=bad?'#b3261e':'#111'}}
function progress(n){if(bar)bar.style.width=Math.round(n/DATA.length*100)+'%'}
function sleep(ms){return new Promise(function(resolve){setTimeout(resolve,ms)})}
function composer(){return document.querySelector('#main footer [contenteditable="true"]')||document.querySelector('#main [role="textbox"][contenteditable="true"]')}
function pasteText(el,text){el.focus();var dt=new DataTransfer();dt.setData('text/plain',text);var ev=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt});el.dispatchEvent(ev);if(!(el.innerText||'').trim()){document.execCommand('insertText',false,text)}}
function sendButton(root){root=root||document;var icon=root.querySelector('[data-icon="send"],[data-icon="wds-ic-send-filled"]');return icon&&(icon.closest('button')||icon.parentElement)}
async function sendText(text){var el=composer();if(!el)throw new Error('Selecione uma conversa no WhatsApp.');pasteText(el,text);await sleep(700);var btn=sendButton(document);if(btn)btn.click();else el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));await sleep(1300)}
async function downloadImage(url){if(!url)return null;var proxy='https://ml-afiliados-pro.vercel.app/api/proxy-image?url='+encodeURIComponent(url);var response=await fetch(proxy,{mode:'cors',credentials:'omit',cache:'no-store'});if(!response.ok)throw new Error('Servidor de imagem respondeu '+response.status);var blob=await response.blob();if(!blob.type.startsWith('image/')||blob.size<500)throw new Error('Arquivo recebido não é uma imagem válida');var ext=blob.type.includes('png')?'png':blob.type.includes('webp')?'webp':'jpg';return new File([blob],'oferta.'+ext,{type:blob.type})}
function imageInput(){var inputs=Array.from(document.querySelectorAll('input[type="file"]'));return inputs.find(function(el){var accept=(el.getAttribute('accept')||'').toLowerCase();return accept.includes('image')})||null}
async function ensureImageInput(){var input=imageInput();if(input)return input;var attach=document.querySelector('button[aria-label*="nexar" i],button[title*="nexar" i],[data-icon="plus-rounded"],[data-icon="clip"]');if(attach){(attach.closest('button')||attach).click();await sleep(800)}return imageInput()}
function mediaCaption(){var dialog=document.querySelector('div[role="dialog"]');if(dialog){return dialog.querySelector('[contenteditable="true"],[data-lexical-editor="true"]')}var editors=Array.from(document.querySelectorAll('[contenteditable="true"][data-tab="10"],[data-lexical-editor="true"]'));return editors.find(function(el){return !el.closest('footer')})||null}
async function waitForMedia(){for(var i=0;i<50&&!STOP;i++){var caption=mediaCaption(),btn=sendButton(document.querySelector('div[role="dialog"]')||document);if(caption||btn)return{caption:caption,button:btn};await sleep(300)}return null}
async function attachAndSend(file,text){var input=await ensureImageInput();if(!input)throw new Error('Campo de anexar foto não encontrado');var dt=new DataTransfer();dt.items.add(file);try{input.files=dt.files}catch(e){Object.defineProperty(input,'files',{configurable:true,value:dt.files})}input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));var media=await waitForMedia();if(!media)throw new Error('A prévia da foto não abriu');if(media.caption)pasteText(media.caption,text);await sleep(900);var btn=sendButton(document.querySelector('div[role="dialog"]')||document)||media.button;if(!btn)throw new Error('Botão de enviar foto não encontrado');btn.click();await sleep(2500)}
for(var i=0;i<DATA.length&&!STOP;i++){
  progress(i);var item=DATA[i],label='['+(i+1)+'/'+DATA.length+'] ';
  try{
    while(!composer()&&!STOP){setStatus('Selecione uma conversa no WhatsApp.');await sleep(700)}
    if(STOP)break;
    if(item.image){setStatus(label+'Baixando foto...');var file=await downloadImage(item.image);setStatus(label+'Anexando foto...');await attachAndSend(file,item.text)}else{setStatus(label+'Sem foto; enviando texto...');await sendText(item.text)}
    setStatus(label+'Enviado com sucesso.');
  }catch(error){failed++;setStatus(label+'NÃO ENVIADO: '+(error&&error.message?error.message:error),true);await sleep(3500)}
  progress(i+1);
  if(i<DATA.length-1&&!STOP){for(var left=Math.ceil(DELAY/1000);left>0&&!STOP;left--){setStatus(label+'Próximo envio em '+left+'s...');await sleep(1000)}}
}
if(!STOP){progress(DATA.length);setStatus(failed?('Concluído com '+failed+' falha(s). Os itens sem foto não foram enviados.'):'Concluído: todas as ofertas foram enviadas com foto.',failed>0)}
})()`;
}
