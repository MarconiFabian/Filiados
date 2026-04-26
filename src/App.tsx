/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { 
  Package, 
  Send, 
  Image as ImageIcon, 
  Clipboard, 
  Trash2, 
  LayoutDashboard, 
  Settings, 
  ExternalLink,
  ChevronRight,
  Plus,
  Download,
  Copy,
  Check,
  Zap,
  Info,
  Smartphone,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GoogleGenAI } from "@google/genai";
import { toast, Toaster } from 'react-hot-toast';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Product {
  id: string;
  title: string;
  image: string;
  price: string;
  originalPrice: string;
  coupon: string;
  link: string;
  groupLink: string;
  addedAt: number;
}

const STORAGE_KEY = 'ml_afiliados_v1';

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [inputUrl, setInputUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareStep, setShareStep] = useState(1); // 1: Texto, 2: Foto
  const [globalSettings, setGlobalSettings] = useState({
    groupLink: 'https://divulgador.app/sua-bio',
    defaultCoupon: '',
  });

  // Load from local storage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      setProducts(data.products || []);
      setGlobalSettings(data.settings || { groupLink: 'https://divulgador.app/sua-bio', defaultCoupon: '' });
    }
  }, []);

  // Save to local storage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ products, settings: globalSettings }));
  }, [products, globalSettings]);

  const selectedProduct = products.find(p => p.id === selectedProductId);

  const fetchProduct = async (url: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      
      if (data.error) throw new Error(data.error);

      const newProduct: Product = {
        id: Math.random().toString(36).substring(7),
        title: data.title || 'Produto sem título',
        image: data.image || '',
        price: data.price || '0,00',
        originalPrice: data.originalPrice || '',
        coupon: data.coupon || globalSettings.defaultCoupon,
        link: data.originalLink,
        groupLink: globalSettings.groupLink,
        addedAt: Date.now(),
      };

      setProducts(prev => [newProduct, ...prev]);
      setSelectedProductId(newProduct.id);
      setInputUrl('');
    } catch (err) {
      alert('Erro ao buscar produto. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  const updateProduct = (id: string, updates: Partial<Product>) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const deleteProduct = (id: string) => {
    setProducts(prev => prev.filter(p => p.id !== id));
    if (selectedProductId === id) setSelectedProductId(null);
  };

  const formatText = (p: Product) => {
    const lines = [
      `➡️ *${p.title}*`,
      `_Site Oficial Mercado Livre_`,
      ``,
      p.originalPrice ? `De: ~~R$ ${p.originalPrice}~~` : null,
      `🔥 por *R$ ${p.price}*`,
      p.coupon ? `🏷️ Cupom: *${p.coupon}*` : null,
      ``,
      `🛒 ${p.link}`,
      ``,
      `Link do grupo:`,
      `${p.groupLink}`
    ].filter(v => v !== null);

    return lines.join('\n');
  };

  const handleCopy = () => {
    if (!selectedProduct) return;
    navigator.clipboard.writeText(formatText(selectedProduct));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleShare = () => {
    if (!selectedProduct) return;
    const text = encodeURIComponent(formatText(selectedProduct));
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const shareToWhatsApp = async () => {
    if (!selectedProduct) return;
    setIsSharing(true);
    
    try {
      const text = formatText(selectedProduct);
      
      if (shareStep === 1) {
        const encodedText = encodeURIComponent(text);
        window.location.href = `whatsapp://send?text=${encodedText}`;
        toast.success("Texto enviado! Clique no Passo 2 agora.", { duration: 4000 });
        setShareStep(2);
      } else {
        toast.loading("Copiando foto...", { id: 'img-toast' });
        const proxiedUrl = `/api/proxy-image?url=${encodeURIComponent(selectedProduct.image)}`;
        const response = await fetch(proxiedUrl);
        if (!response.ok) throw new Error("Erro na imagem");
        const blob = await response.blob();

        const img = new Image();
        const imageUrl = URL.createObjectURL(blob);
        
        await new Promise((resolve, reject) => {
          img.onload = async () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              if (!ctx) throw new Error("Falha no Canvas");
              
              ctx.drawImage(img, 0, 0);
              canvas.toBlob(async (pngBlob) => {
                if (pngBlob) {
                  try {
                    await navigator.clipboard.write([
                      new ClipboardItem({ 'image/png': pngBlob })
                    ]);
                    toast.success("Foto copiada! Basta COLAR no WhatsApp.", { id: 'img-toast', duration: 5000 });
                    window.location.href = "whatsapp://";
                    setShareStep(1);
                    resolve(true);
                  } catch (clipErr) {
                    reject(clipErr);
                  }
                } else {
                  reject(new Error("Falha ao gerar blob"));
                }
              }, 'image/png');
            } catch (e) { reject(e); }
          };
          img.onerror = () => reject(new Error("Erro ao carregar imagem"));
          img.src = imageUrl;
        });
        
        URL.revokeObjectURL(imageUrl);
      }
    } catch (err) {
      console.error(err);
      toast.error("Erro no compartilhamento.", { id: 'img-toast' });
    } finally {
      setIsSharing(false);
    }
  };

  const handleDownloadImage = async () => {
    if (!selectedProduct?.image) return;
    try {
      const response = await fetch(selectedProduct.image);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `produto-${selectedProduct.id}.png`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      // If direct fetch fails due to CORS, suggest right click
      window.open(selectedProduct.image, '_blank');
    }
  };

  const improveTitleWithAI = async () => {
    if (!selectedProduct || isAiLoading) return;
    
    setIsAiLoading(true);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Você é um copywriter especialista em vendas no WhatsApp e redes sociais. 
        Reescreva o título do produto abaixo para ser muito atraente, persuasivo e use uma "chamada" vendedora no início.
        Exemplos de tom: "Olha que conjunto maravilhoso!", "Preço imbatível nesse...", "Vem garantir o seu...", "Aproveite essa oferta de...".
        Mantenha as palavras-chave principais para que o cliente saiba o que é.
        Retorne APENAS o novo título, de forma curta e direta, sem aspas ou explicações.
        
        Título original: ${selectedProduct.title}`,
      });

      const newTitle = response.text?.trim();
      if (newTitle) {
        updateProduct(selectedProduct.id, { title: newTitle });
      }
    } catch (err) {
      console.error('Erro ao melhorar título com IA:', err);
      alert('Não foi possível melhorar o título com IA no momento.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkInput, setBulkInput] = useState('');

  const handleBulkImport = () => {
    try {
      // Try to parse as JSON (from bookmarklet)
      const data = JSON.parse(bulkInput);
      if (Array.isArray(data)) {
        const newProducts = data.map((item: any) => ({
          id: Math.random().toString(36).substring(7),
          title: item.title || 'Produto sem título',
          image: item.image || '',
          price: item.price || '0,00',
          originalPrice: item.originalPrice || '',
          coupon: globalSettings.defaultCoupon,
          link: item.link || '',
          groupLink: globalSettings.groupLink,
          addedAt: Date.now(),
        }));
        setProducts(prev => [...newProducts, ...prev]);
        setIsBulkModalOpen(false);
        setBulkInput('');
      }
    } catch (e) {
      // If not JSON, try to treat as list of links
      const links = bulkInput.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));
      if (links.length > 0) {
        alert(`Importando ${links.length} links um por um...`);
        links.forEach(link => fetchProduct(link));
        setIsBulkModalOpen(false);
        setBulkInput('');
      } else {
        alert('Formato inválido. Cole o JSON do bookmarklet ou uma lista de links.');
      }
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden font-sans text-slate-800 selection:bg-yellow-400 selection:text-black">
      <Toaster position="top-center" />
      {/* Bulk Import Modal */}
      <AnimatePresence>
        {isBulkModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white border border-slate-200 rounded-2xl p-8 max-w-2xl w-full shadow-2xl space-y-6"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight">Importação em Massa</h2>
                  <p className="text-slate-500 text-sm">Cole o capturado pelo favorito ou uma lista de links.</p>
                </div>
                <button 
                  onClick={() => setIsBulkModalOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-900 transition-colors"
                >
                  <Plus className="rotate-45" size={24} />
                </button>
              </div>

              <textarea 
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                placeholder="Cole aqui o conteúdo capturado..."
                className="w-full h-64 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 transition-all resize-none custom-scrollbar"
              />

              <div className="flex gap-4">
                <button 
                   onClick={() => setIsBulkModalOpen(false)}
                   className="flex-1 py-3.5 rounded-xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleBulkImport}
                  className="flex-1 py-3.5 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 transition-all shadow-md shadow-blue-100"
                >
                  Importar Produtos
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-[#FFE600] border-b border-yellow-400 px-6 py-3 flex justify-between items-center shadow-sm relative z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm">
            <Zap className="text-blue-600 fill-blue-600" size={20} />
          </div>
          <div>
            <h1 className="text-lg font-black leading-none text-slate-900">ML Afiliados Pro</h1>
            <p className="text-[10px] uppercase tracking-wider text-slate-600 font-bold">Gerador de Anúncios Profissionais</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setIsBulkModalOpen(true)}
            className="hidden md:flex items-center gap-2 bg-white px-4 py-2 rounded-lg text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 border border-slate-200 transition-all"
          >
            <Clipboard size={14} /> Sincronizar Painel
          </button>
          <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-sm hover:bg-blue-700 transition-all flex items-center gap-2">
            <Settings size={14} /> Configurações
          </button>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-12 gap-0 overflow-hidden">
        
        {/* Left Column: Capture & List */}
        <section className="col-span-12 lg:col-span-3 border-r border-slate-200 p-4 flex flex-col bg-slate-50 overflow-hidden">
          <h2 className="text-[10px] font-black uppercase text-slate-400 mb-3 tracking-widest">1. Capturar Produtos</h2>
          
          <div className="space-y-4 flex flex-col h-full overflow-hidden">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
              <div>
                <label className="text-[10px] font-black block mb-1 text-slate-500 uppercase">Link Individual</label>
                <input 
                  type="text" 
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="Cole o link meli.la..." 
                  className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-400 outline-none transition-all"
                />
              </div>
              <button 
                onClick={() => fetchProduct(inputUrl)}
                disabled={isLoading || !inputUrl}
                className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-xs font-bold hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoading ? <div className="w-4 h-4 border-2 border-white/20 border-t-white animate-spin rounded-full" /> : <><Plus size={14} /> Adicionar Produto</>}
              </button>
            </div>

            <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-yellow-700 uppercase tracking-widest">Automação Ninja</span>
                <span className="px-2 py-0.5 bg-yellow-400 text-slate-900 rounded text-[9px] font-black uppercase">Novo Script</span>
              </div>
              
              <div className="space-y-2">
                <p className="text-[11px] text-yellow-800 font-medium leading-tight">
                  1. Arraste o botão abaixo para sua barra de favoritos:<br/>
                  2. Em uma página do ML, clique no favorito.<br/>
                  3. Volte aqui e use o "Importar em Massa".
                </p>
                
                <div 
                  draggable
                  onDragStart={(e) => {
                    const script = `javascript:(function(){
                      console.log('Iniciando captura ML Pro...');
                      const selectors = [
                        '.ui-search-result', 
                        '.ui-search-result__wrapper', 
                        '.promotion-item', 
                        '.ui-pdp-container', 
                        '.andes-card', 
                        '.poly-card',
                        '.ui-search-item__group',
                        '.ui-search-result__content'
                      ];
                      
                      const items = [];
                      document.querySelectorAll(selectors.join(',')).forEach(el => {
                        const img = el.querySelector('img')?.src;
                        const titleEl = el.querySelector('h1, h2, h3, .ui-search-item__title, .promotion-item__title, .poly-component__title, .ui-pdp-title');
                        const title = titleEl ? titleEl.innerText.trim() : null;
                        
                        /* Seletores de preço (Atual e Antigo) */
                        const allAmounts = Array.from(el.querySelectorAll('.andes-money-amount'));
                        
                        // O preço riscado sempre tem a classe andes-money-amount--previous
                        const oldAmountEl = allAmounts.find(a => a.classList.contains('andes-money-amount--previous') || a.closest('.ui-pdp-price__old') || a.closest('.ui-search-price__part--status'));
                        
                        // O preço atual NÃO pode ser o previous e NÃO pode estar em blocos de parcelamento
                        const currentAmountEl = allAmounts.find(a => 
                          !a.classList.contains('andes-money-amount--previous') && 
                          !a.closest('.ui-pdp-price__old') && 
                          !a.closest('.ui-pdp-installments') && 
                          !a.closest('.ui-search-installments') &&
                          !a.closest('.ui-search-price__part--status')
                        );
                        
                        const getPriceFromEl = (baseEl) => {
                          if (!baseEl) return null;
                          const fractionEl = baseEl.querySelector('.andes-money-amount__fraction');
                          const centsEl = baseEl.querySelector('.andes-money-amount__cents');
                          if (!fractionEl) return null;
                          const fraction = fractionEl.innerText.replace(/[^0-9]/g, '');
                          const cents = centsEl ? centsEl.innerText.replace(/[^0-9]/g, '') : '00';
                          return fraction + ',' + (cents || '00');
                        };

                        let price = getPriceFromEl(currentAmountEl);
                        let originalPrice = getPriceFromEl(oldAmountEl) || '';
                        
                        // Se por algum motivo pegou o mesmo preço, limpa o original
                        if (originalPrice === price) originalPrice = '';
                        
                        // Fallback se não achou o preço atual mas achou um preço qualquer que não seja o riscado
                        if (!price && allAmounts.length > 0) {
                          const fallbackEl = allAmounts.find(a => !a.classList.contains('andes-money-amount--previous'));
                          price = getPriceFromEl(fallbackEl);
                        }

                        /* Detecção de Cupom */
                        let coupon = '';
                        const couponEl = el.querySelector('.ui-pdp-promotions-pill-label, .ui-pdp-promotions__title, .ui-pdp-vpp-label');
                        if (couponEl) {
                          const cText = couponEl.innerText.toUpperCase();
                          const match = cText.match(/[A-Z0-9]{4,}/);
                          if (match) coupon = match[0];
                        }
                        
                        const link = el.querySelector('a')?.href;
                        
                        if (title && link && price) {
                          items.push({ 
                            title, 
                            image: img, 
                            price, 
                            originalPrice, 
                            coupon,
                            link 
                          });
                        }
                      });

                      if (items.length) {
                        /* Deduplicar por link */
                        const unique = Array.from(new Map(items.map(item => [item.link, item])).values());
                        const json = JSON.stringify(unique);
                        const copyEl = document.createElement('textarea');
                        copyEl.value = json;
                        document.body.appendChild(copyEl);
                        copyEl.select();
                        document.execCommand('copy');
                        document.body.removeChild(copyEl);
                        alert('🚀 SUCESSO! ' + unique.length + ' produtos capturados!\\n\\nAgora volte no app ML Afiliados e cole no campo \"Importar em Massa\".');
                      } else {
                        alert('⚠️ Atenção: Não encontrei produtos.\\n\\nCertifique-se de estar em uma página de pesquisa ou de um produto específico do Mercado Livre.');
                      }
                    })();`;
                    e.dataTransfer.setData('text/plain', script);
                  }}
                  className="w-full bg-slate-900 text-yellow-400 border-2 border-dashed border-yellow-400/50 py-3 rounded-lg text-[11px] font-bold flex items-center justify-center gap-2 cursor-grab active:cursor-grabbing hover:bg-black transition-all shadow-lg shadow-yellow-400/5"
                >
                  ⭐ FAVORITO DE CAPTURA
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col pt-2">
              <h3 className="text-[10px] font-black text-slate-400 uppercase mb-2 tracking-widest">Fila de Captura ({products.length})</h3>
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {products.length === 0 ? (
                  <div className="text-center py-12 opacity-50 space-y-2">
                     <Package size={32} className="mx-auto text-slate-300" />
                     <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Nenhum produto</p>
                  </div>
                ) : (
                  products.map(p => (
                    <motion.div 
                      key={p.id}
                      onClick={() => setSelectedProductId(p.id)}
                      className={cn(
                        "group flex items-center gap-3 p-2.5 rounded-xl border transition-all cursor-pointer",
                        selectedProductId === p.id 
                          ? "bg-white border-blue-200 ring-2 ring-blue-50" 
                          : "bg-white border-slate-200 hover:border-slate-300"
                      )}
                    >
                      <div className="w-10 h-10 bg-slate-50 rounded-lg border border-slate-100 flex-shrink-0 overflow-hidden">
                        <img src={p.image} className="w-full h-full object-contain" />
                      </div>
                      <div className="overflow-hidden flex-1">
                        <p className={cn("text-[11px] font-bold truncate", selectedProductId === p.id ? "text-blue-600" : "text-slate-800")}>{p.title}</p>
                        <p className="text-[10px] text-slate-500 font-medium">R$ {p.price}</p>
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); deleteProduct(p.id); }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-red-500 transition-all"
                      >
                        <Trash2 size={12} />
                      </button>
                    </motion.div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Center Column: Editor */}
        <section className="col-span-12 lg:col-span-5 bg-white border-r border-slate-200 p-8 overflow-y-auto custom-scrollbar">
          <h2 className="text-[10px] font-black uppercase text-slate-400 mb-6 tracking-widest">2. Editor de Promoção</h2>
          
          {selectedProduct ? (
            <div className="space-y-6 max-w-xl mx-auto">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tight">Título do Anúncio</label>
                  <button 
                    onClick={improveTitleWithAI}
                    disabled={isAiLoading}
                    className="flex items-center gap-1.5 px-2 py-1 bg-yellow-400 text-slate-900 rounded-lg text-[9px] font-black uppercase hover:bg-yellow-500 transition-all disabled:opacity-50"
                  >
                    {isAiLoading ? (
                      <div className="w-3 h-3 border-2 border-slate-900/20 border-t-slate-900 animate-spin rounded-full" />
                    ) : (
                      <Sparkles size={10} />
                    )}
                    Melhorar com IA
                  </button>
                </div>
                <textarea 
                  value={selectedProduct.title}
                  onChange={(e) => updateProduct(selectedProduct.id, { title: e.target.value })}
                  className="w-full text-sm p-4 border border-slate-200 rounded-xl font-bold bg-slate-50 focus:ring-1 focus:ring-blue-400 outline-none transition-all min-h-[100px] leading-tight"
                />
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tight">Preço Original (De)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-4 text-slate-400 text-sm font-bold">R$</span>
                    <input 
                      type="text" 
                      value={selectedProduct.originalPrice}
                      onChange={(e) => updateProduct(selectedProduct.id, { originalPrice: e.target.value })}
                      placeholder="Ex: 59,90"
                      className="w-full text-sm p-4 pl-12 border border-slate-200 rounded-xl font-bold text-slate-400 bg-slate-50 focus:ring-1 focus:ring-blue-400 outline-none transition-all line-through"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tight">Preço Com Desconto (Por)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-4 text-slate-400 text-sm font-bold">R$</span>
                    <input 
                      type="text" 
                      value={selectedProduct.price}
                      onChange={(e) => updateProduct(selectedProduct.id, { price: e.target.value })}
                      className="w-full text-sm p-4 pl-12 border border-slate-200 rounded-xl font-black text-green-600 bg-slate-50 focus:ring-1 focus:ring-blue-400 outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tight">Cupom Ativo</label>
                  {selectedProduct.coupon && (
                    <span className="text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-bold animate-pulse">Detectado</span>
                  )}
                </div>
                <input 
                  type="text" 
                  value={selectedProduct.coupon}
                  onChange={(e) => updateProduct(selectedProduct.id, { coupon: e.target.value })}
                  placeholder="Ex: CUPOM10"
                  className="w-full text-sm p-4 border border-orange-200 rounded-xl font-black text-orange-600 bg-orange-50/30 focus:ring-1 focus:ring-orange-400 outline-none transition-all tracking-wider uppercase"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-tight">Link do seu Grupo</label>
                <div className="relative">
                  <Smartphone className="absolute left-4 top-4 text-slate-400" size={16} />
                  <input 
                    type="text" 
                    value={selectedProduct.groupLink}
                    onChange={(e) => updateProduct(selectedProduct.id, { groupLink: e.target.value })}
                    className="w-full text-sm p-4 pl-12 border border-slate-200 rounded-xl text-blue-600 font-medium bg-slate-50 focus:ring-1 focus:ring-blue-400 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-tight">Link de Afiliado</label>
                <div className="relative">
                  <ExternalLink className="absolute left-4 top-4 text-slate-400" size={16} />
                  <input 
                    type="text" 
                    value={selectedProduct.link}
                    onChange={(e) => updateProduct(selectedProduct.id, { link: e.target.value })}
                    className="w-full text-sm p-4 pl-12 border border-slate-200 rounded-xl text-slate-500 bg-slate-50 focus:ring-1 focus:ring-blue-400 outline-none transition-all truncate"
                  />
                </div>
              </div>

              <div className="pt-6 flex gap-4 border-t border-slate-100">
                <button 
                  onClick={handleDownloadImage}
                  className="flex-1 flex flex-col items-center gap-1.5 p-4 border border-slate-200 rounded-xl hover:bg-slate-50 transition-all group"
                >
                  <ImageIcon size={20} className="text-slate-400 group-hover:text-blue-500" />
                  <span className="text-[10px] font-black uppercase text-slate-400 group-hover:text-slate-900">Baixar Imagem</span>
                </button>
                <button 
                  onClick={handleCopy}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-1.5 p-4 border rounded-xl transition-all group",
                    isCopied ? "bg-blue-50 border-blue-200" : "border-slate-200 hover:bg-slate-50"
                  )}
                >
                  {isCopied ? <Check size={20} className="text-blue-600" /> : <Copy size={20} className="text-slate-400 group-hover:text-blue-500" />}
                  <span className={cn("text-[10px] font-black uppercase", isCopied ? "text-blue-600" : "text-slate-400 group-hover:text-slate-900")}>
                    {isCopied ? "Copiado!" : "Copiar Texto"}
                  </span>
                </button>
                <button 
                  onClick={shareToWhatsApp}
                  disabled={isSharing}
                  className={cn(
                    "flex-[2] flex items-center justify-center gap-3 text-white p-4 rounded-xl shadow-lg transition-all active:scale-[0.98] disabled:opacity-50",
                    shareStep === 1 ? "bg-[#25D366] hover:brightness-105 shadow-green-100" : "bg-blue-600 hover:bg-blue-700 shadow-blue-100"
                  )}
                >
                  {isSharing ? (
                    <div className="w-5 h-5 border-2 border-white/20 border-t-white animate-spin rounded-full" />
                  ) : (
                    shareStep === 1 ? <Send size={20} className="fill-white" /> : <Smartphone size={20} />
                  )}
                  <span className="font-black text-sm uppercase tracking-tight">
                    {shareStep === 1 ? "1. POSTAR TEXTO NO WHATSAPP" : "2. COPIAR FOTO PARA COLAR"}
                  </span>
                </button>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-12 opacity-30 select-none">
              <div className="w-24 h-24 bg-slate-100 rounded-3xl flex items-center justify-center mb-6">
                <LayoutDashboard size={48} className="text-slate-300" />
              </div>
              <h3 className="text-xl font-black text-slate-900 mb-2 uppercase tracking-tight">Editor Vazio</h3>
              <p className="text-slate-500 text-sm max-w-xs font-medium">Selecione um produto da lista à esquerda para começar a editar seu anúncio.</p>
            </div>
          )}
        </section>

        {/* Right Column: Live Preview */}
        <section className="col-span-12 lg:col-span-4 bg-slate-200 p-8 flex justify-center overflow-y-auto custom-scrollbar">
          <div className="w-full max-w-[340px] bg-[#E5DDD5] rounded-[40px] border-[10px] border-slate-900 shadow-2xl relative overflow-hidden flex flex-col h-[600px] my-auto">
            {/* WhatsApp Header */}
            <div className="bg-[#075E54] p-4 pt-12 flex items-center gap-3 shrink-0">
               <div className="w-10 h-10 rounded-full bg-slate-300 overflow-hidden flex items-center justify-center text-xl">🔥</div>
               <div className="flex-1 min-w-0">
                 <p className="text-white text-sm font-bold truncate">🛒 Grupo de Promoções Pro</p>
                 <p className="text-white/60 text-[10px] font-medium">online</p>
               </div>
               <div className="flex gap-2">
                 <div className="w-1 h-1 bg-white/50 rounded-full" />
                 <div className="w-1 h-1 bg-white/50 rounded-full" />
                 <div className="w-1 h-1 bg-white/50 rounded-full" />
               </div>
            </div>
            
            {/* Chat Area */}
            <div className="flex-1 p-4 pb-12 overflow-y-auto space-y-4">
              {selectedProduct ? (
                <div className="bg-white rounded-2xl rounded-tl-none p-2 shadow-sm border-b border-black/5 animate-in fade-in slide-in-from-bottom-4 duration-300">
                  {selectedProduct.image && (
                    <div className="w-full aspect-square bg-slate-50 rounded-xl mb-3 overflow-hidden border border-slate-100 flex items-center justify-center p-2">
                       <img src={selectedProduct.image} className="w-full h-full object-contain" />
                    </div>
                  )}
                  <div className="p-1 space-y-1 text-slate-800 leading-tight">
                    <p className="text-[13px] font-bold">➡️ {selectedProduct.title}</p>
                    <p className="text-[12px] italic text-slate-400 font-serif">Site Oficial Mercado Livre</p>
                    {selectedProduct.originalPrice && (
                      <p className="text-[12px] text-slate-400 line-through">De: R$ {selectedProduct.originalPrice}</p>
                    )}
                    <div className="h-2" />
                    <p className="text-[13px]">🔥 por <span className="font-bold">R$ {selectedProduct.price}</span></p>
                    {selectedProduct.coupon && (
                      <p className="text-[13px]">🏷️ Cupom: <span className="font-bold underline decoration-yellow-400 decoration-2">{selectedProduct.coupon}</span></p>
                    )}
                    <div className="h-2" />
                    <p className="text-[13px] text-blue-600 underline truncate">{selectedProduct.link}</p>
                    <div className="h-3" />
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-tighter">Link do grupo:</p>
                    <p className="text-[11px] text-blue-600 underline truncate">{selectedProduct.groupLink}</p>
                  </div>
                  <div className="flex justify-end gap-1.5 mt-1 pr-1 items-center">
                    <span className="text-[10px] text-slate-400 font-bold">14:32</span>
                    <div className="flex text-blue-400 -space-x-1 scale-75 origin-right">
                       <Check size={14} />
                       <Check size={14} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center flex-col opacity-5 text-slate-400">
                   <Send size={64} />
                   <p className="text-xs font-black uppercase mt-4">Aguardando Mensagem</p>
                </div>
              )}
            </div>

            {/* Bottom Bar */}
            <div className="bg-slate-100 p-3 flex gap-2 items-center border-t border-slate-200 mt-auto shrink-0">
               <div className="flex-1 h-9 bg-white rounded-full border border-slate-200"></div>
               <div className="w-9 h-9 rounded-full bg-[#128C7E] flex items-center justify-center text-white">
                 <Send size={16} className="fill-white translate-x-0.5" />
               </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer / Status Bar */}
      <footer className="bg-white border-t border-slate-200 px-6 py-2.5 flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-widest relative z-50">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span> Sistema Pronto
          </span>
          <span className="hidden sm:inline">Automação: <b className="text-slate-800">Mercado Livre (Ativa)</b></span>
          <span className="hidden lg:inline">Sessão: <b className="text-blue-600">marconifabiano@gmail.com</b></span>
        </div>
        <div className="flex gap-4">
          <span>v2.8.5 (Gold Edition)</span>
        </div>
      </footer>

      {/* Global CSS for scrollbar */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #cbd5e1;
        }
      `}</style>
    </div>
  );
}

