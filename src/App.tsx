/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
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
  Target,
  Info,
  Smartphone,
  Sparkles,
  MousePointerClick,
  X,
  LogOut,
  LogIn,
  Search,
  Tag,
  PartyPopper,
  Percent,
  Globe,
  HelpCircle,
  Activity,
  History,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Clock3,
  Wifi,
  ListChecks
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { toast, Toaster } from 'react-hot-toast';
import { auth, db } from './lib/firebase';
import { buildWhatsAppSenderBookmarklet } from './lib/whatsappBookmarklet';
import {
  MARKETPLACES,
  detectMarketplaceUrl,
  getMarketplace,
  isAffiliateLink,
  marketplaceFromStore,
  type MarketplaceId,
} from '../lib/marketplaces';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  getRedirectResult,
  signInWithRedirect,
  User 
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  deleteDoc, 
  updateDoc,
  serverTimestamp,
  writeBatch,
  deleteField
} from 'firebase/firestore';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function parseCurrencyValue(value: string | number): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  let normalized = String(value ?? '').replace(/R\$\s*/gi, '').replace(/\s+/g, '').trim();
  if (!normalized) return null;
  if (normalized.includes(',')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, '');
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatCurrency(value: string | number): string {
  const parsed = parseCurrencyValue(value);
  if (parsed === null) return '';
  return `R$ ${parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function productStorageId(marketplace: string, link: string): string {
  let normalized = link.trim().toLowerCase();
  try {
    const url = new URL(link);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|matt_|fbclid|gclid|ref|source|campaign)/i.test(key)) url.searchParams.delete(key);
    }
    normalized = url.toString().replace(/\/$/, '').toLowerCase();
  } catch {}

  const source = `${marketplace}:${normalized}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `product-${marketplace.replace(/[^a-z0-9-]/gi, '-')}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
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
  category: string;
  store?: string;
  marketplace?: MarketplaceId;
  addedAt: number;
  labelOriginalPrice?: string;
  labelPrice?: string;
  labelCoupon?: string;
  labelGroupLink?: string;
  isHighlight?: boolean;
  selected?: boolean;
}

function resolveProductMarketplace(product: Pick<Product, 'marketplace' | 'link' | 'store'>) {
  return getMarketplace(
    product.marketplace
      || detectMarketplaceUrl(product.link)?.id
      || marketplaceFromStore(product.store).id
  );
}

interface GlobalSettings {
  groupLink: string;
  defaultCoupon: string;
  affiliateId: string;
  labelOriginalPrice: string;
  labelPrice: string;
  labelCoupon: string;
  labelGroupLink: string;
  emojiPriceOriginal: string;
  emojiTitle: string;
  emojiPrice: string;
  emojiCoupon: string;
  emojiGroup: string;
  showEmojiPriceOriginal: boolean;
  showEmojiTitle: boolean;
  showEmojiPrice: boolean;
  showEmojiCoupon: boolean;
  showEmojiGroup: boolean;
  cardStyle: 'classic' | 'modern' | 'soft' | 'glass';
  themeColor: string;
  autoPostInterval: number;
}

interface DiagnosticSnapshot {
  ok?: boolean;
  version?: string;
  whatsAppOpen?: boolean;
  queueCount?: number;
  queueIndex?: number;
  protectedCount?: number;
  historyCount?: number;
  inFlight?: boolean;
  lastStatus?: string;
  lastError?: string;
  lastStatusAt?: number;
  checkedAt?: number;
  selectedCount: number;
  invalidSelectionCount: number;
  missingImageCount: number;
  error?: string;
}

interface DeliveryHistoryEntry {
  id: string;
  fingerprint?: string;
  status: 'sent' | 'blocked' | 'failed' | 'uncertain';
  mode?: 'image' | 'text' | '';
  title?: string;
  marketplace?: string;
  price?: string;
  link?: string;
  image?: string;
  detail?: string;
  timestamp: number;
}

const REQUIRED_EXTENSION_VERSION = '1.0.12';
const STORAGE_KEY = 'ml_afiliados_v1';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

type ShopeeExtensionCapture = {
  ok?: boolean;
  price?: string | number;
  originalPrice?: string | number;
  title?: string;
  image?: string;
  error?: string;
};

function captureShopeeWithExtension(url: string): Promise<ShopeeExtensionCapture> {
  return new Promise((resolve, reject) => {
    const requestId = `shopee-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let started = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(startupTimeout);
      clearTimeout(captureTimeout);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data;
      if (message?.source !== 'ml-afiliados-extension' || message?.requestId !== requestId) return;

      if (message.type === 'ML_SHOPEE_CAPTURE_STARTED') {
        started = true;
        clearTimeout(startupTimeout);
        return;
      }
      if (message.type !== 'ML_SHOPEE_CAPTURE_ACK') return;

      cleanup();
      if (message.ok) resolve(message);
      else reject(new Error(message.error || 'A extensão não conseguiu capturar o preço da Shopee.'));
    };
    const startupTimeout = window.setTimeout(() => {
      if (started) return;
      cleanup();
      reject(new Error('Atualize a extensão ML Afiliados Sender para a versão 1.0.12.'));
    }, 2_500);
    const captureTimeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('A Shopee demorou para abrir. Tente novamente.'));
    }, 35_000);

    window.addEventListener('message', onMessage);
    window.postMessage({
      source: 'ml-afiliados-pro',
      type: 'ML_SHOPEE_CAPTURE',
      requestId,
      url,
    }, window.location.origin);
  });
}

async function downloadExtensionArchive() {
  try {
    const response = await fetch('/ml-afiliados-sender-v1.0.12.zip.b64', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Download respondeu HTTP ${response.status}.`);
    const encoded = (await response.text()).replace(/\s+/g, '');
    const binary = window.atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);

    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = 'ml-afiliados-sender-v1.0.12.zip';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2_000);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Não foi possível baixar a extensão.');
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isLoginLoading, setIsLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  const toggleAllSelection = async (select: boolean) => {
    if (!user) return;
    try {
      for (let start = 0; start < products.length; start += 450) {
        const batch = writeBatch(db);
        for (const product of products.slice(start, start + 450)) {
          batch.update(doc(db, 'users', user.uid, 'products', product.id), { selected: select });
        }
        await batch.commit();
      }
    } catch (error) {
      console.error('Erro ao selecionar todos:', error);
      toast.error('Não foi possível atualizar toda a fila. Tente novamente.');
    }
  };

  const toggleProductSelection = (id: string, current: boolean) => {
    if (!user) return;
    const pRef = doc(db, 'users', user.uid, 'products', id);
    updateDoc(pRef, { selected: !current }).catch(err => console.error("Error toggling item:", err));
  };

  const selectedCount = products.filter(p => p.selected).length;

  const [inputUrl, setInputUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareStep, setShareStep] = useState(1);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [activeWorkspace, setActiveWorkspace] = useState<'products' | 'editor' | 'preview'>('products');
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({
    groupLink: 'https://divulgador.app/sua-bio',
    defaultCoupon: '',
    affiliateId: '',
    labelOriginalPrice: 'De:',
    labelPrice: 'por',
    labelCoupon: 'Cupom:',
    labelGroupLink: 'Link do Grupo:',
    emojiPriceOriginal: '💰',
    emojiTitle: '➡️',
    emojiPrice: '🔥',
    emojiCoupon: '🏷️',
    emojiGroup: '🛒',
    showEmojiPriceOriginal: false,
    showEmojiTitle: true,
    showEmojiPrice: true,
    showEmojiCoupon: true,
    showEmojiGroup: true,
    cardStyle: 'modern',
    themeColor: 'blue', // default
    autoPostInterval: 30,
  });

  // Local state for smooth editing
  const [localProduct, setLocalProduct] = useState<Product | null>(null);
  const [discountPercent, setDiscountPercent] = useState('');
  const [priceBeforeDiscount, setPriceBeforeDiscount] = useState<string | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // PWA & Service Worker Registration
  useEffect(() => {
    const registerServiceWorker = () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then(
          (registration) => console.log('SW registered:', registration.scope),
          (err) => console.log('SW register failed:', err)
        );
      }
    };

    window.addEventListener('load', registerServiceWorker);

    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    return () => {
      window.removeEventListener('load', registerServiceWorker);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      console.log('User accepted install');
      setDeferredPrompt(null);
    }
  };

  const applyPercentageDiscount = () => {
    if (!localProduct || !discountPercent) return;

    const currentPrice = parseCurrencyValue(localProduct.price);
    const percentage = Number(discountPercent.replace(',', '.'));
    if (currentPrice === null) {
      toast.error('Preço atual inválido para calcular desconto.');
      return;
    }
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage >= 100) {
      toast.error('Informe um desconto entre 0 e 100%.');
      return;
    }

    setPriceBeforeDiscount(localProduct.price);
    const newPrice = currentPrice * (1 - percentage / 100);
    handleLocalUpdate({ price: newPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) });
    setDiscountPercent('');
    toast.success(`Desconto de ${percentage}% aplicado!`);
  };

  const undoDiscount = () => {
    if (priceBeforeDiscount && localProduct) {
      handleLocalUpdate({ price: priceBeforeDiscount });
      setPriceBeforeDiscount(null);
      toast("Preço original restaurado", { icon: '🔄' });
    }
  };

  // Auth State
  useEffect(() => {
    getRedirectResult(auth).then((result) => {
        if (result) {
          console.log("Login via redirect bem sucedido:", result.user.email);
          setLoginError('');
          toast.success("Login realizado!");
        }
      }).catch(err => {
        console.error("Erro redirect:", err);
        const currentDomain = window.location.hostname;
        if (err?.code === 'auth/unauthorized-domain') {
          setLoginError(`O domínio ${currentDomain} ainda não está autorizado no Firebase.`);
        } else if (err?.code === 'auth/internal-error') {
          setLoginError('O redirecionamento foi bloqueado pelo navegador. Use o botão Entrar com Google para abrir a janela segura de login.');
        } else {
          setLoginError(`Não foi possível concluir o login: ${err?.code || err?.message || 'erro desconhecido'}.`);
        }
    });

    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
  }, []);

  // Load user settings and products from Firebase
  useEffect(() => {
    if (!user) {
      setProducts([]);
      setSelectedProductId(null);
      setLocalProduct(null);
      setPriceBeforeDiscount(null);
      return;
    }

    // Sync settings
    const userDocPath = `users/${user.uid}`;
    const userDocRef = doc(db, userDocPath);
    const unsubSettings = onSnapshot(userDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setGlobalSettings({
          groupLink: data.groupLink || 'https://divulgador.app/sua-bio',
          defaultCoupon: data.defaultCoupon || '',
          affiliateId: data.affiliateId || '',
          labelOriginalPrice: data.labelOriginalPrice ?? 'De:',
          labelPrice: data.labelPrice ?? 'por',
          labelCoupon: data.labelCoupon ?? 'Cupom:',
          labelGroupLink: data.labelGroupLink ?? 'Link do Grupo:',
          emojiPriceOriginal: data.emojiPriceOriginal || '💰',
          emojiTitle: data.emojiTitle || '➡️',
          emojiPrice: data.emojiPrice || '🔥',
          emojiCoupon: data.emojiCoupon || '🏷️',
          emojiGroup: data.emojiGroup || '🛒',
          showEmojiPriceOriginal: data.showEmojiPriceOriginal ?? false,
          showEmojiTitle: data.showEmojiTitle ?? true,
          showEmojiPrice: data.showEmojiPrice ?? true,
          showEmojiCoupon: data.showEmojiCoupon ?? true,
          showEmojiGroup: data.showEmojiGroup ?? true,
          cardStyle: data.cardStyle || 'modern',
          themeColor: data.themeColor || 'blue',
          autoPostInterval: data.autoPostInterval || 30,
        });
      } else {
        // Init user settings if new
        setDoc(userDocRef, {
          email: user.email,
          groupLink: 'https://divulgador.app/sua-bio',
          defaultCoupon: '',
          affiliateId: '',
          labelOriginalPrice: 'De:',
          labelPrice: 'por',
          labelCoupon: 'Cupom:',
          labelGroupLink: 'Link do Grupo:',
          emojiPriceOriginal: '💰',
          emojiTitle: '➡️',
          emojiPrice: '🔥',
          emojiCoupon: '🏷️',
          emojiGroup: '🛒',
          showEmojiPriceOriginal: false,
          showEmojiTitle: true,
          showEmojiPrice: true,
          showEmojiCoupon: true,
          showEmojiGroup: true,
          cardStyle: 'modern',
          themeColor: 'blue',
          autoPostInterval: 30,
          createdAt: serverTimestamp()
        }).catch(err => handleFirestoreError(err, OperationType.WRITE, userDocPath));
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, userDocPath));

    // Sync products
    const productsPath = `users/${user.uid}/products`;
    const productsRef = collection(db, productsPath);
    const q = query(productsRef, orderBy('addedAt', 'desc'));
    const unsubProducts = onSnapshot(q, (snap) => {
      const prods: Product[] = [];
      snap.forEach(doc => {
        prods.push({ id: doc.id, ...doc.data() } as Product);
      });
      setProducts(prods);
    }, (err) => handleFirestoreError(err, OperationType.LIST, productsPath));

    return () => {
      unsubSettings();
      unsubProducts();
    };
  }, [user]);

  const handleLogin = async (useRedirect = false) => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    setLoginError('');
    setIsLoginLoading(true);

    try {
      if (useRedirect) {
        await signInWithRedirect(auth, provider);
        return;
      }

      const result = await signInWithPopup(auth, provider);
        console.log("Login bem sucedido:", result.user.email);
        toast.success("Login realizado com sucesso!");
    } catch (err: any) {
      console.error("Erro detalhado do Firebase:", err);
      const currentDomain = window.location.hostname;

      if (err?.code === 'auth/popup-closed-by-user') return;
      if (err?.code === 'auth/popup-blocked') {
        setLoginError('O navegador bloqueou a janela do Google. Libere pop-ups para este site ou use a opção de redirecionamento.');
      } else if (err?.code === 'auth/unauthorized-domain') {
        setLoginError(`O domínio ${currentDomain} ainda não está autorizado no Firebase.`);
      } else {
        setLoginError(`Não foi possível entrar: ${err?.code || err?.message || 'erro desconhecido'}.`);
      }
    } finally {
      setIsLoginLoading(false);
    }
  };

  const clearUserWorkspace = () => {
    setProducts([]);
    setSelectedProductId(null);
    setLocalProduct(null);
    setPriceBeforeDiscount(null);
    setShareStep(1);
    setBulkInput('');
    setActiveWorkspace('products');
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      clearUserWorkspace();
      toast.success('Sessão encerrada.');
    } catch (error) {
      console.error('Erro ao encerrar sessão:', error);
      toast.error('Não foi possível sair agora.');
    }
  };

  const saveSettings = async (updates: any) => {
    if (!user) return;
    const path = `users/${user.uid}`;
    try {
      await setDoc(doc(db, path), updates, { merge: true });
      toast.success("Configurações salvas!");
      setIsSettingsOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const filteredProducts = products.filter(p => {
    const matchesSearch = (p.title || "").toLowerCase().includes(searchQuery.toLowerCase());
    const effectiveCategory = p.category || 'Geral';
    const matchesCategory = selectedCategory === 'all' || effectiveCategory === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = Array.from(new Set(['all', ...products.map(p => p.category || 'Geral')]));

  const selectedProduct = products.find(p => p.id === selectedProductId);

  const fireCelebration = useCallback(() => {
    const duration = 3 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 45, spread: 360, ticks: 100, zIndex: 10000 };

    const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

    const interval: any = setInterval(function() {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 70 * (timeLeft / duration);
      // side blasts
      confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
      confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
    }, 250);
  }, []);

  const lastCelebratedId = useRef<string | null>(null);
  const lastCelebrateState = useRef<boolean>(false);
  const migrationDone = useRef(false);

  useEffect(() => {
    migrationDone.current = false;
    setSelectedProductId(null);
    setLocalProduct(null);
    setPriceBeforeDiscount(null);
    setShareStep(1);
    setActiveWorkspace('products');
  }, [user?.uid]);

  // Migration: Clear local labels if they match common defaults to allow global settings to work
  useEffect(() => {
    if (!products.length || !user || migrationDone.current) return;
    
    const defaultLabels = [
      'de:', 'de', 'por', 'por:', 'cupom:', 'cupom ativo:', 
      'link do grupo:', 'link do grupo', 'rótulo: preço original',
      'rótulo: preço promo', 'rótulo: cupom', 'rótulo: link grupo'
    ];

    const isGeneric = (val: string | undefined) => {
      if (!val) return false;
      return defaultLabels.includes(val.toLowerCase().trim());
    };

    const productsToFix = products.filter(p => 
      isGeneric(p.labelOriginalPrice) ||
      isGeneric(p.labelPrice) ||
      isGeneric(p.labelCoupon) ||
      isGeneric(p.labelGroupLink)
    );

    if (productsToFix.length > 0) {
      migrationDone.current = true;
      const batch = writeBatch(db);
      productsToFix.forEach(p => {
        const docRef = doc(db, `users/${user.uid}/products`, p.id);
        const updates: any = {};
        if (isGeneric(p.labelOriginalPrice)) updates.labelOriginalPrice = deleteField();
        if (isGeneric(p.labelPrice)) updates.labelPrice = deleteField();
        if (isGeneric(p.labelCoupon)) updates.labelCoupon = deleteField();
        if (isGeneric(p.labelGroupLink)) updates.labelGroupLink = deleteField();
        batch.update(docRef, updates);
      });
      batch.commit().then(() => {
        toast.success("Produtos sincronizados com as Configurações Globais!");
      }).catch(err => console.error("Migration error:", err));
    }
  }, [products, user]);

  // Sync local state when selection changes
  useEffect(() => {
    if (!selectedProductId) {
      setLocalProduct(null);
      return;
    }
    
    // Reset localProduct only if a DIFFERENT product is selected
    if (!selectedProduct) {
      setLocalProduct(null);
      setSelectedProductId(null);
      return;
    }
    if (!localProduct || localProduct.id !== selectedProductId) {
      setLocalProduct({ ...selectedProduct });
    }
  }, [selectedProductId, selectedProduct]);

  // Celebration Trigger
  useEffect(() => {
    if (localProduct?.isHighlight) {
      const isNewProduct = localProduct.id !== lastCelebratedId.current;
      const wasNotHighlight = !lastCelebrateState.current;

      if (isNewProduct || wasNotHighlight) {
        setTimeout(fireCelebration, 300);
      }
    }
    lastCelebratedId.current = localProduct?.id || null;
    lastCelebrateState.current = !!localProduct?.isHighlight;
  }, [localProduct?.id, localProduct?.isHighlight, fireCelebration]);

  const autoCategorize = (title: string): string => {
    const categories: Record<string, string[]> = {
      'Veículos': ['carro', 'moto', 'motocicleta', 'caminhão', 'ônibus', 'náutica', 'barco', 'avião'],
      'Tecnologia': ['celular', 'smartphone', 'iphone', 'galaxy', 'xiaomi', 'motorola', 'redmi', 'tv', 'televisão', 'notebook', 'laptop', 'macbook', 'tablet', 'ipad', 'kindle', 'monitor', 'caixa de som', 'alexa', 'echo', 'bluetooth', 'fone', 'headphone', 'carregador', 'power bank', 'bateria', 'smartwatch', 'relógio inteligente', 'projetor', 'câmera', 'fotográfica', 'lente', 'impressora', 'teclado', 'mouse', 'console', 'playstation', 'ps5', 'ps4', 'xbox', 'nintendo', 'switch', 'placa de vídeo', 'rtx', 'gtx', 'amd', 'intel', 'processador', 'memória ram', 'ssd', 'gamer', 'headset', 'gabinete', 'controle', 'joystick'],
      'Casa e Móveis': ['sofá', 'cama', 'armário', 'mesa', 'cadeira', 'iluminação', 'lâmpada', 'lustre', 'cortina', 'climatizador', 'ventilador', 'ar condicionado', 'umidificador', 'almofada', 'tapete', 'espelho', 'quadro', 'lençol', 'travesseiro', 'toalha', 'móvel', 'decoração', 'guarda-roupa', 'estante', 'poltrona', 'colchão'],
      'Eletrodomésticos': ['geladeira', 'fogão', 'cooktop', 'máquina de lavar', 'lavadora', 'secadora', 'micro-ondas', 'microondas', 'aspirador', 'robô aspirador', 'ferro de passar', 'lavadora de alta pressão', 'aquecedor', 'freezer', 'adega', 'frigobar'],
      'Cozinha': ['airfryer', 'panela', 'liquidificador', 'batedeira', 'cafeteira', 'fritadeira', 'mixer', 'talher', 'copo', 'prato', 'pote', 'tapper', 'garrafa', 'churrasqueira', 'sanduicheira', 'grill', 'louça', 'escorredor', 'afiador', 'balança', 'utensílio'],
      'Esportes e Fitness': ['bola', 'bicicleta', 'bike', 'pesca', 'camping', 'academia', 'halter', 'suplemento', 'creatina', 'whey', 'garrafa térmica', 'patins', 'skate', 'prancha', 'mergulho', 'chuteira', 'musculação', 'esteira', 'spinning'],
      'Ferramentas': ['furadeira', 'parafusadeira', 'serra', 'martelo', 'chave', 'multímetro', 'trena', 'esmerilhadeira', 'ferramenta', 'guincho', 'talha', 'elevação', 'solda', 'parafuso', 'alicate', 'nível', 'compressor', 'morsa', 'torquímetro'],
      'Construção': ['piso', 'revestimento', 'pintura', 'tinta', 'argamassa', 'cimento', 'telha', 'tijolo', 'elétrica', 'hidráulica', 'tubo', 'conexão', 'pia', 'torneira', 'chuveiro'],
      'Indústria e Comércio': ['máquina industrial', 'gerador', 'empilhadeira', 'uniforme', 'segurança', 'epis', 'epi', 'balança comercial', 'embalagem', 'automação'],
      'Pet Shop': ['ração', 'coleira', 'aquário', 'gato', 'cachorro', 'pet', 'caminha pet', 'areia gato'],
      'Saúde': ['medidor', 'termômetro', 'ortopedia', 'máscara', 'massagem', 'nebulizador', 'oxímetro', 'estetoscópio', 'cadeira de rodas'],
      'Beleza e Cuidado Pessoal': ['perfume', 'secador', 'chapinha', 'barbeador', 'depilador', 'maquiagem', 'batom', 'shampoo', 'condicionador', 'creme', 'protetor solar', 'skincare', 'hidratante', 'esmalt', 'unha', 'escova', 'pente'],
      'Moda': ['tênis', 'sapato', 'sandália', 'bota', 'chinelo', 'relógio', 'óculos', 'bolsa', 'mochila', 'carteira', 'camiseta', 'calça', 'bermuda', 'vestido', 'casaco', 'jaqueta', 'joia', 'colar', 'brinco', 'cinta', 'modeladora', 'cueca', 'meia', 'roupa', 'fitness', 'esportivo'],
      'Bebês': ['fralda', 'carrinho de bebê', 'berço', 'mamadeira', 'chupeta', 'roupa bebê', 'mordedor', 'banheira'],
      'Brinquedos': ['boneca', 'barbie', 'carrinho de controle', 'lego', 'quebra-cabeça', 'tabuleiro', 'brinquedo', 'pelúcia', 'nerf', 'hot wheels'],
      'Supermercado': ['alimento', 'bebida', 'arroz', 'feijão', 'café', 'óleo', 'vinho', 'cerveja', 'refrigerante', 'limpeza', 'higiene', 'biscoito', 'bolacha', 'chocolate', 'leite'],
    };

    const lowerTitle = (title || "").toLowerCase();
    for (const [cat, keywords] of Object.entries(categories)) {
      if (keywords.some(k => lowerTitle.includes(k.toLowerCase()))) {
        return cat;
      }
    }
    return 'Geral';
  };

  const getApiAuthHeaders = async (includeJson = false): Promise<Record<string, string>> => {
    if (!user) throw new Error('Sua sessão expirou. Entre novamente.');
    const token = await user.getIdToken();
    return {
      Authorization: `Bearer ${token}`,
      ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
    };
  };

  const fetchProduct = async (url: string, options: { silent?: boolean } = {}): Promise<boolean> => {
    const normalizedUrl = url.trim();
    if (!user) {
      if (!options.silent) toast.error('Entre na sua conta para adicionar produtos.');
      return false;
    }
    if (!normalizedUrl) {
      if (!options.silent) toast.error('Cole um link de produto.');
      return false;
    }
    const marketplace = detectMarketplaceUrl(normalizedUrl);
    if (!marketplace) {
      if (!options.silent) toast.error('Use um link HTTPS válido do Mercado Livre, Amazon, AliExpress ou Shopee.');
      return false;
    }

    if (!options.silent) setIsLoading(true);
    try {
      const headers = await getApiAuthHeaders();
      const res = await fetch(`/api/scrape?url=${encodeURIComponent(normalizedUrl)}`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Não foi possível capturar o produto (${res.status}).`);

      let title = typeof data.title === 'string' ? data.title.trim() : '';
      let image = typeof data.image === 'string' ? data.image.trim() : '';
      let priceValue = parseCurrencyValue(data.price);
      let originalValue = parseCurrencyValue(data.originalPrice);
      let requiresManualPrice = data.requiresManualPrice === true;
      let shopeeCaptureWarning = '';

      if (marketplace.id === 'shopee' && requiresManualPrice) {
        try {
          const captured = await captureShopeeWithExtension(normalizedUrl);
          const capturedPrice = parseCurrencyValue(captured.price);
          const capturedOriginalPrice = parseCurrencyValue(captured.originalPrice);
          if (capturedPrice !== null && capturedPrice > 0) {
            priceValue = capturedPrice;
            originalValue = capturedOriginalPrice;
            requiresManualPrice = false;
          }
          if (typeof captured.title === 'string' && captured.title.trim().length >= 8) title = captured.title.trim();
          if (typeof captured.image === 'string' && captured.image.trim()) image = captured.image.trim();
        } catch (captureError) {
          shopeeCaptureWarning = captureError instanceof Error ? captureError.message : String(captureError);
          console.warn('Captura da Shopee pela extensão não concluída:', captureError);
        }
      }

      if (title.length < 8 || !image) {
        throw new Error(`${marketplace.name} não forneceu título e foto válidos. Tente outro link do produto.`);
      }
      if (!requiresManualPrice && (priceValue === null || priceValue <= 0)) {
        throw new Error(`${marketplace.name} não forneceu um preço válido. Tente outro link do produto.`);
      }

      const originalPrice = priceValue !== null && originalValue !== null && originalValue > priceValue
        ? originalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '';
      const newProductData = {
        userId: user.uid,
        title,
        image,
        price: priceValue !== null && priceValue > 0
          ? priceValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : '',
        originalPrice,
        coupon: typeof data.coupon === 'string' && data.coupon.trim() ? data.coupon.trim() : globalSettings.defaultCoupon,
        link: typeof data.originalLink === 'string' ? data.originalLink : normalizedUrl,
        groupLink: globalSettings.groupLink,
        category: autoCategorize(title),
        store: typeof data.store === 'string' && data.store.trim() ? data.store.trim() : marketplace.name,
        marketplace: marketplace.id,
        addedAt: Date.now(),
        isHighlight: false,
        selected: false,
      };

      const createdProductId = productStorageId(marketplace.id, newProductData.link);
      await setDoc(doc(db, 'users', user.uid, 'products', createdProductId), newProductData);
      if (!options.silent) {
        setInputUrl('');
        if (requiresManualPrice) {
          setSelectedProductId(createdProductId);
          toast(shopeeCaptureWarning
            ? `${marketplace.name}: preço pendente. ${shopeeCaptureWarning}`
            : `${marketplace.name}: título e foto adicionados. Informe o preço no editor antes de enviar.`, { duration: 7000, icon: '⚠️' });
        } else {
          toast.success(`${marketplace.name}: produto adicionado à fila.`);
        }
      }
      return true;
    } catch (error) {
      console.error('Erro ao capturar produto:', error);
      if (!options.silent) toast.error(error instanceof Error ? error.message : 'Não foi possível capturar o produto.');
      return false;
    } finally {
      if (!options.silent) setIsLoading(false);
    }
  };
  const updateProduct = async (id: string, updates: Partial<Product>) => {
    if (!user) return;
    const path = `users/${user.uid}/products/${id}`;
    try {
      await updateDoc(doc(db, path), updates);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const handleLocalUpdate = (updates: Partial<Product>) => {
    if (!localProduct) return;
    const updated = { ...localProduct, ...updates };
    setLocalProduct(updated);
    
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      updateProduct(localProduct.id, updates);
    }, 1000);
  };

  const deleteProduct = async (id: string) => {
    if (!user) return;
    const path = `users/${user.uid}/products/${id}`;
    try {
      await deleteDoc(doc(db, path));
      if (selectedProductId === id) setSelectedProductId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const openAffiliateLinkBuilder = () => {
    if (!selectedProduct) return;
    const marketplace = resolveProductMarketplace(selectedProduct);
    window.open(marketplace.affiliatePortal, '_blank', 'noopener,noreferrer');
    toast.success('Abrindo o portal de afiliados da ' + marketplace.name + '...', { icon: '🔗' });
  };

  // Helper to determine which label to show, ignoring generic defaults
  const getEffectiveLabel = (productLabel: string | undefined, globalLabel: string) => {
    if (!productLabel || !productLabel.trim()) return globalLabel;
    
    const genericDefaults = [
      'de:', 'de', 'por:', 'por', 'cupom:', 'cupom ativo:', 
      'link do grupo:', 'link do grupo', 'rótulo: preço original',
      'rótulo: preço promo', 'rótulo: cupom', 'rótulo: link grupo'
    ];
    
    if (genericDefaults.includes(productLabel.toLowerCase().trim())) {
      return globalLabel;
    }
    
    return productLabel;
  };

  const formatText = (p: Product) => {
    const formatPrice = (price: string | number) => formatCurrency(price);
    const marketplace = resolveProductMarketplace(p);

    // Some imported cards contain a previously formatted ad inside the title.
    // Keep only the actual product name so price, store and links are not repeated.
    const rawTitle = String(p.title || '').replace(/\s+/g, ' ').trim();
    const cleanTitle = rawTitle
      .split(/(?:_?Site Oficial\b|✅\s*De:|🔥\s*Por:|🛒\s*https?:|Link do Grupo:)/i)[0]
      .replace(/^[➡️\s]+/, '')
      .trim() || rawTitle;

    const lines = [
      p.isHighlight ? `🚨 🎉 *SUPER OFERTA* 🎉 🚨` : null,
      p.isHighlight ? `-------------------------` : null,
      `${globalSettings.showEmojiTitle ? globalSettings.emojiTitle + ' ' : ''}*${cleanTitle}*`,
      `_Site Oficial ${p.store || marketplace.name}_`,
      ``,
      p.originalPrice ? `${globalSettings.showEmojiPriceOriginal ? globalSettings.emojiPriceOriginal + ' ' : ''}${getEffectiveLabel(p.labelOriginalPrice, globalSettings.labelOriginalPrice)} ~${formatPrice(p.originalPrice)}~` : null,
      `${globalSettings.showEmojiPrice ? globalSettings.emojiPrice + ' ' : ''}${getEffectiveLabel(p.labelPrice, globalSettings.labelPrice)} *${formatPrice(p.price)}*`,
      p.coupon ? `${globalSettings.showEmojiCoupon ? globalSettings.emojiCoupon + ' ' : ''}${getEffectiveLabel(p.labelCoupon, globalSettings.labelCoupon)} *${p.coupon}*` : null,
      ``,
      marketplace.id === 'amazon' ? '#ComissõesPorCompra' : null,
      p.link ? `${globalSettings.showEmojiGroup ? globalSettings.emojiGroup + ' ' : ''}${p.link}` : null,
      ``,
      `${getEffectiveLabel(p.labelGroupLink, globalSettings.labelGroupLink)}`,
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

    // Celebration for super offers
    if (selectedProduct.isHighlight) {
      fireCelebration();
    }

    setIsSharing(true);
    
    try {
      const text = formatText(selectedProduct);
      
      if (shareStep === 1) {
        const encodedText = encodeURIComponent(text);
        // Try direct protocol first
        window.location.href = `whatsapp://send?text=${encodedText}`;
        // Backup: open web version in 1 second if app didn't respond (or just as second tab)
        setTimeout(() => {
          window.open(`https://web.whatsapp.com/send?text=${encodedText}`, '_blank');
        }, 800);
        
        toast.success("Enviando texto! Agora clique no Passo 2.", { duration: 4000 });
        setShareStep(2);
      } else {
        toast.loading("Copiando foto...", { id: 'img-toast' });
        
        const proxiedUrl = `/api/proxy-image?url=${encodeURIComponent(selectedProduct.image)}`;
        const response = await fetch(proxiedUrl, { headers: await getApiAuthHeaders() });
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
                    
                    // Try to trigger app refocus via protocol
                    window.location.href = "whatsapp://";
                    
                    // Backup: Open WhatsApp Web after a short delay to trigger focus
                    setTimeout(() => {
                      window.open('https://web.whatsapp.com', '_blank');
                    }, 500);
                    
                    setShareStep(1);
                    resolve(true);
                  } catch (clipErr: any) {
                    console.error("Clipboard Error:", clipErr);
                    if (clipErr.name === 'NotAllowedError' || clipErr.message?.includes('focus')) {
                      toast.error("O navegador bloqueou a cópia. Tente clicar no botão novamente sem mudar de aba.", { id: 'img-toast' });
                    } else {
                      toast.error("Erro ao copiar imagem. Tente novamente.", { id: 'img-toast' });
                    }
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
      const proxiedUrl = `/api/proxy-image?url=${encodeURIComponent(selectedProduct.image)}`;
      const response = await fetch(proxiedUrl, { headers: await getApiAuthHeaders() });
      if (!response.ok) throw new Error(`Imagem indisponível (${response.status}).`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.toLowerCase().startsWith('image/')) throw new Error('O endereço não retornou uma imagem válida.');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `produto-${selectedProduct.id}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (err) {
      window.open(selectedProduct.image, '_blank');
    }
  };

  const copyImageToClipboard = async () => {
    if (!selectedProduct?.image) return;
    
    try {
      toast.loading("Copiando imagem...", { id: 'copy-img-toast' });
      const proxiedUrl = `/api/proxy-image?url=${encodeURIComponent(selectedProduct.image)}`;
      const response = await fetch(proxiedUrl, { headers: await getApiAuthHeaders() });
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
                  toast.success("Imagem copiada com sucesso!", { id: 'copy-img-toast' });
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
    } catch (err) {
      console.error(err);
      toast.error("Erro ao copiar imagem.", { id: 'copy-img-toast' });
    }
  };

  const improveTitleWithAI = async () => {
    if (!selectedProduct || isAiLoading) return;
    
    setIsAiLoading(true);
    try {
      const response = await fetch('/api/improve-title', {
        method: 'POST',
        headers: await getApiAuthHeaders(true),
        body: JSON.stringify({ title: selectedProduct.title }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Serviço de IA indisponível.');
      const newTitle = typeof data.title === 'string' ? data.title.trim() : '';
      if (newTitle) {
        handleLocalUpdate({ title: newTitle });
      }
    } catch (err) {
      console.error('Erro ao melhorar título com IA:', err);
      toast.error(err instanceof Error ? err.message : 'Não foi possível melhorar o título com IA.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isQueueSending, setIsQueueSending] = useState(false);
  const [isDiagnosticLoading, setIsDiagnosticLoading] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticSnapshot | null>(null);
  const [deliveryHistory, setDeliveryHistory] = useState<DeliveryHistoryEntry[]>([]);

  const requestExtensionBridge = (
    requestType: string,
    responseType: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 8000
  ): Promise<Record<string, any>> => new Promise((resolve, reject) => {
    const requestId = `ml-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
    };
    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (
        event.source !== window ||
        message?.source !== 'ml-afiliados-extension' ||
        message?.type !== responseType ||
        message?.requestId !== requestId
      ) return;
      cleanup();
      resolve(message);
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Extensão não encontrada. Instale ou atualize para a versão ${REQUIRED_EXTENSION_VERSION}.`));
    }, timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage({
      source: 'ml-afiliados-pro',
      type: requestType,
      requestId,
      ...payload
    }, window.location.origin);
  });

  const getPublicationSelection = () => products.filter((product) => !!product.selected);

  const validatePublicationSelection = (items: Product[]) => {
    const invalid = items.filter((product) => {
      const price = parseCurrencyValue(product.price);
      return !product.title?.trim() || !product.link?.trim() || price === null || price <= 0;
    });
    const missingImage = items.filter((product) => !/^https:\/\//i.test(product.image || ''));
    return { invalid, missingImage };
  };

  const openPublicationReview = () => {
    const items = getPublicationSelection();
    if (!items.length) {
      toast.error('Marque pelo menos um produto na fila.');
      return;
    }
    const { invalid } = validatePublicationSelection(items);
    if (invalid.length) {
      toast.error(`Corrija título, preço e link de ${invalid.length} produto(s) antes de publicar.`);
      return;
    }
    setIsReviewOpen(true);
  };

  const confirmPublication = async () => {
    const selectedItems = getPublicationSelection();
    const { invalid } = validatePublicationSelection(selectedItems);
    if (!selectedItems.length || invalid.length) {
      setIsReviewOpen(false);
      toast.error('A fila mudou. Revise os produtos novamente.');
      return;
    }

    setIsQueueSending(true);
    try {
      const response = await requestExtensionBridge('ML_QUEUE_TO_EXTENSION', 'ML_EXTENSION_ACK', {
        delaySeconds: globalSettings.autoPostInterval || 30,
        items: selectedItems.map((product) => {
          const marketplace = resolveProductMarketplace(product);
          return {
            id: product.id,
            title: product.title,
            marketplace: marketplace.name,
            price: formatCurrency(product.price),
            link: product.link,
            image: product.image || '',
            text: formatText(product)
          };
        })
      }, 9000);
      if (!response.ok) throw new Error(response.error || 'A extensão recusou a fila.');
      setIsReviewOpen(false);
      toast.success(`${response.count} oferta(s) conferidas e enviadas para a extensão. Agora escolha o grupo no WhatsApp.`, { duration: 6000 });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível enviar a fila.');
    } finally {
      setIsQueueSending(false);
    }
  };

  const runDiagnostics = async () => {
    setIsDiagnosticOpen(true);
    setIsDiagnosticLoading(true);
    const selectedItems = getPublicationSelection();
    const { invalid, missingImage } = validatePublicationSelection(selectedItems);
    try {
      const response = await requestExtensionBridge('ML_DIAGNOSTIC_REQUEST', 'ML_DIAGNOSTIC_ACK', {}, 7000);
      setDiagnostic({
        ...response,
        selectedCount: selectedItems.length,
        invalidSelectionCount: invalid.length,
        missingImageCount: missingImage.length
      });
    } catch (error) {
      setDiagnostic({
        ok: false,
        selectedCount: selectedItems.length,
        invalidSelectionCount: invalid.length,
        missingImageCount: missingImage.length,
        error: error instanceof Error ? error.message : 'Não foi possível executar o diagnóstico.'
      });
    } finally {
      setIsDiagnosticLoading(false);
    }
  };

  const loadDeliveryHistory = async () => {
    setIsHistoryOpen(true);
    setIsHistoryLoading(true);
    try {
      const response = await requestExtensionBridge('ML_HISTORY_REQUEST', 'ML_HISTORY_ACK', {}, 7000);
      if (!response.ok) throw new Error(response.error || 'A extensão não retornou o histórico.');
      setDeliveryHistory(Array.isArray(response.entries) ? response.entries : []);
    } catch (error) {
      setDeliveryHistory([]);
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar o histórico.');
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const clearDeliveryHistory = async () => {
    if (!window.confirm('Apagar o histórico e liberar anúncios protegidos? Eles poderão ser enviados novamente.')) return;
    setIsHistoryLoading(true);
    try {
      const response = await requestExtensionBridge('ML_HISTORY_CLEAR', 'ML_HISTORY_CLEAR_ACK', {}, 7000);
      if (!response.ok) throw new Error(response.error || 'Não foi possível apagar o histórico.');
      setDeliveryHistory([]);
      toast.success('Histórico apagado e anúncios liberados.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível apagar o histórico.');
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const handleBulkImport = async (inputOverride?: string) => {
    const rawInput = inputOverride ?? bulkInput;
    if (!user || typeof rawInput !== 'string') {
      toast.error('Entre na sua conta para importar produtos.');
      return;
    }

    const input = rawInput.trim();
    if (!input) {
      toast.error('Cole o JSON capturado ou uma lista de links.');
      return;
    }

    const normalizeKey = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\/$/, '');
    const existingKeys = new Set(products.flatMap((product) => [
      product.link ? `link:${normalizeKey(product.link)}` : '',
      `item:${normalizeKey(product.title)}|${normalizeKey(product.image)}`,
    ]).filter(Boolean));

    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      parsed = null;
    }

    if (Array.isArray(parsed)) {
      const uniqueItems: Array<Record<string, unknown>> = [];
      let ignored = 0;
      for (const rawItem of parsed) {
        if (!rawItem || typeof rawItem !== 'object') {
          ignored++;
          continue;
        }
        const item = rawItem as Record<string, unknown>;
        const title = String(item.title ?? '').trim();
        const image = String(item.image ?? '').trim();
        const link = String(item.affiliate_link ?? item.link ?? '').trim();
        const priceValue = parseCurrencyValue(String(item.price ?? ''));
        const key = link ? `link:${normalizeKey(link)}` : `item:${normalizeKey(title)}|${normalizeKey(image)}`;
        if (title.length < 4 || !image || priceValue === null || priceValue <= 0 || existingKeys.has(key)) {
          ignored++;
          continue;
        }
        existingKeys.add(key);
        uniqueItems.push(item);
      }

      if (!uniqueItems.length) {
        toast.error(ignored ? 'Nenhum produto novo e válido foi encontrado. Os duplicados foram ignorados.' : 'Nenhum produto válido foi encontrado.');
        return;
      }

      toast.loading(`Importando ${uniqueItems.length} produto(s)...`, { id: 'bulk-load' });
      await Promise.all(uniqueItems.map((item) => {
        const title = String(item.title ?? '').trim();
        const priceValue = parseCurrencyValue(String(item.price ?? ''))!;
        const originalValue = parseCurrencyValue(String(item.originalPrice ?? item.price_from ?? item.priceOriginal ?? ''));
        const importedLink = String(item.affiliate_link ?? item.link ?? '').trim();
        const importedMarketplace = detectMarketplaceUrl(importedLink) || marketplaceFromStore(String(item.store ?? ''));
        const importedProductId = productStorageId(importedMarketplace.id, importedLink || `${title}|${String(item.image ?? '').trim()}`);
        return setDoc(doc(db, 'users', user.uid, 'products', importedProductId), {
          userId: user.uid,
          title,
          image: String(item.image ?? '').trim(),
          price: priceValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          originalPrice: originalValue !== null && originalValue > priceValue
            ? originalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : '',
          coupon: String(item.coupon ?? '').trim() || globalSettings.defaultCoupon,
          link: importedLink,
          groupLink: globalSettings.groupLink,
          category: String(item.category ?? '').trim() || autoCategorize(title),
          store: String(item.store ?? '').trim() || importedMarketplace.name,
          marketplace: importedMarketplace.id,
          addedAt: Date.now(),
          isHighlight: false,
        });
      }));
      setIsBulkModalOpen(false);
      setBulkInput('');
      const detail = ignored ? ` ${ignored} duplicado(s) ou inválido(s) foram ignorados.` : '';
      toast.success(`${uniqueItems.length} produto(s) importado(s).${detail}`, { id: 'bulk-load' });
      return;
    }

    const links = Array.from(new Set(input.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^https:\/\//i.test(line))))
      .filter((link) => !existingKeys.has(`link:${normalizeKey(link)}`));
    if (!links.length) {
      toast.error('Nenhum link HTTPS novo foi encontrado.');
      return;
    }

    toast.loading(`Importando ${links.length} produto(s)...`, { id: 'bulk-load' });
    const results = await Promise.all(links.map((link) => fetchProduct(link, { silent: true })));
    const imported = results.filter(Boolean).length;
    const failed = links.length - imported;
    if (imported > 0) {
      setIsBulkModalOpen(false);
      setBulkInput('');
      toast.success(`${imported} produto(s) importado(s)${failed ? `; ${failed} falharam` : ''}.`, { id: 'bulk-load' });
    } else {
      toast.error('Nenhum produto pôde ser importado. Confira os links.', { id: 'bulk-load' });
    }
  };
  if (authLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <Zap className="text-blue-600 animate-pulse" size={48} />
          <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Iniciando Sistema...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="login-shell flex min-h-screen w-full items-center justify-center bg-slate-950 p-5 sm:p-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md space-y-8 rounded-[32px] border border-slate-200 bg-white p-7 text-center shadow-2xl sm:p-10"
        >
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-amber-400 shadow-xl shadow-amber-400/20">
            <Zap className="fill-slate-950 text-slate-950" size={40} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-tight">Afiliados Pro</h1>
            <p className="mt-3 text-base font-medium leading-relaxed text-slate-600">Crie, organize e publique ofertas do Mercado Livre, Amazon, AliExpress e Shopee com apresentação profissional.</p>
          </div>
          {loginError && (
            <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-left text-sm font-bold text-red-700">
              <p>{loginError}</p>
              {loginError.includes('não está autorizado') && (
                <p className="mt-2 text-xs font-medium text-red-600">Firebase Console → Authentication → Settings → Authorized domains → adicione {window.location.hostname}</p>
              )}
            </div>
          )}

          <button 
            onClick={() => handleLogin(false)}
            disabled={isLoginLoading}
            className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-lg hover:bg-black transition-all flex items-center justify-center gap-3 shadow-xl shadow-slate-200 disabled:cursor-wait disabled:opacity-60"
          >
            {isLoginLoading ? <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <LogIn size={24} />}
            {isLoginLoading ? 'Abrindo Google...' : 'Entrar com Google'}
          </button>
          
          <button 
            onClick={() => handleLogin(true)}
            disabled={isLoginLoading}
            className="w-full py-3 bg-white text-slate-500 border border-slate-200 rounded-xl font-bold text-sm hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
          >
             Entrar por redirecionamento (alternativa)
          </button>
          <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-4">
             <div className="text-left">
                <p className="text-xs font-black uppercase tracking-wider text-slate-500">Multiusuário</p>
                <p className="mt-1 text-sm font-semibold leading-snug text-slate-700">Seus dados ficam salvos na nuvem.</p>
             </div>
             <div className="text-left">
                <p className="text-xs font-black uppercase tracking-wider text-slate-500">Captura rápida</p>
                <p className="mt-1 text-sm font-semibold leading-snug text-slate-700">Importe ofertas com poucos cliques.</p>
             </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="app-shell flex min-h-screen flex-col bg-slate-100 font-sans text-slate-800 selection:bg-amber-300 selection:text-slate-950 lg:h-screen lg:overflow-hidden">
      <Toaster position="top-center" />

      {/* Publication Review Modal */}
      <AnimatePresence>
        {isReviewOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.96, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 16 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="publication-review-title"
              className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-950 p-5 text-white sm:p-6">
                <div className="flex gap-3">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-amber-400 text-slate-950"><ListChecks size={23} /></div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-amber-300">Revisão obrigatória</p>
                    <h2 id="publication-review-title" className="mt-1 text-xl font-black sm:text-2xl">Confira antes de publicar</h2>
                    <p className="mt-1 text-sm font-medium text-slate-300">A extensão receberá exatamente os anúncios mostrados abaixo.</p>
                  </div>
                </div>
                <button type="button" onClick={() => !isQueueSending && setIsReviewOpen(false)} className="rounded-xl p-2 text-slate-300 hover:bg-white/10 hover:text-white"><X size={23} /></button>
              </div>

              <div className="grid gap-3 border-b border-slate-200 bg-slate-50 p-4 sm:grid-cols-3 sm:p-5">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-bold text-slate-500">Produtos</p>
                  <p className="mt-1 text-2xl font-black text-slate-950">{getPublicationSelection().length}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-bold text-slate-500">Intervalo entre envios</p>
                  <p className="mt-1 text-2xl font-black text-slate-950">{globalSettings.autoPostInterval || 30}s</p>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-bold text-emerald-700">Proteção antirrepetição</p>
                  <p className="mt-1 flex items-center gap-2 text-sm font-black text-emerald-900"><ShieldCheck size={20} /> Ativada</p>
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-4 custom-scrollbar sm:p-5">
                {getPublicationSelection().map((product, index) => {
                  const marketplace = resolveProductMarketplace(product);
                  const hasImage = /^https:\/\//i.test(product.image || '');
                  const affiliate = isAffiliateLink(product.link, marketplace.id);
                  return (
                    <article key={product.id} className="grid grid-cols-[72px_1fr] gap-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-[88px_1fr_auto] sm:items-center">
                      <div className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 sm:h-[88px] sm:w-[88px]">
                        {hasImage ? <img src={product.image} alt="" className="h-full w-full object-contain" /> : <ImageIcon className="text-slate-300" size={28} />}
                      </div>
                      <div className="min-w-0">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-slate-950 px-2 py-1 text-[9px] font-black uppercase text-white">{marketplace.name}</span>
                          <span className={cn("rounded-full px-2 py-1 text-[9px] font-black uppercase", affiliate ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800")}>{affiliate ? 'Link afiliado' : 'Conferir link'}</span>
                        </div>
                        <h3 className="line-clamp-2 text-sm font-black leading-snug text-slate-900">{index + 1}. {product.title}</h3>
                        <p className="mt-2 text-base font-black text-emerald-700">{formatCurrency(product.price)}</p>
                        {!hasImage && <p className="mt-1 flex items-center gap-1 text-xs font-bold text-amber-700"><AlertTriangle size={13} /> Sem imagem: será tentado envio em texto.</p>}
                      </div>
                      <a href={product.link} target="_blank" rel="noreferrer" className="col-span-2 flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 sm:col-span-1"><ExternalLink size={14} /> Abrir oferta</a>
                    </article>
                  );
                })}
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-white p-4 sm:flex-row sm:justify-end sm:p-5">
                <button type="button" onClick={() => setIsReviewOpen(false)} disabled={isQueueSending} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Voltar e corrigir</button>
                <button type="button" onClick={confirmPublication} disabled={isQueueSending} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-emerald-200 hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60">
                  {isQueueSending ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />}
                  {isQueueSending ? 'Enviando fila...' : 'Confirmar e abrir WhatsApp'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Diagnostics Modal */}
      <AnimatePresence>
        {isDiagnosticOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.96, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 16 }} role="dialog" aria-modal="true" aria-labelledby="diagnostic-title" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl custom-scrollbar">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 sm:p-6">
                <div className="flex gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white"><Activity size={23} /></div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-blue-600">Central de diagnóstico</p>
                    <h2 id="diagnostic-title" className="mt-1 text-2xl font-black text-slate-950">Saúde do sistema</h2>
                    <p className="mt-1 text-sm font-medium text-slate-500">Teste aplicativo, extensão, WhatsApp e fila.</p>
                  </div>
                </div>
                <button type="button" onClick={() => setIsDiagnosticOpen(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-900"><X size={23} /></button>
              </div>

              <div className="space-y-4 p-5 sm:p-6">
                {isDiagnosticLoading ? (
                  <div className="flex min-h-56 flex-col items-center justify-center gap-4 text-center">
                    <RefreshCw className="animate-spin text-blue-600" size={36} />
                    <p className="font-bold text-slate-600">Executando testes...</p>
                  </div>
                ) : (
                  <>
                    {[
                      { label: 'Aplicativo e login', ok: Boolean(user), detail: user?.email || 'Usuário não conectado', icon: Wifi },
                      { label: 'Extensão do Chrome', ok: diagnostic?.ok && diagnostic?.version === REQUIRED_EXTENSION_VERSION, detail: diagnostic?.version ? `Versão ${diagnostic.version}${diagnostic.version === REQUIRED_EXTENSION_VERSION ? ' atualizada' : ` — atualize para ${REQUIRED_EXTENSION_VERSION}`}` : (diagnostic?.error || 'Extensão não encontrada'), icon: ShieldCheck },
                      { label: 'WhatsApp Web', ok: Boolean(diagnostic?.whatsAppOpen), detail: diagnostic?.whatsAppOpen ? 'Aba do WhatsApp Web aberta' : 'Abra e conecte o WhatsApp Web', icon: Smartphone },
                      { label: 'Produtos selecionados', ok: Boolean(diagnostic?.selectedCount) && diagnostic?.invalidSelectionCount === 0, detail: diagnostic?.selectedCount ? `${diagnostic.selectedCount} selecionado(s); ${diagnostic.invalidSelectionCount} inválido(s)` : 'Nenhum produto selecionado', icon: Package },
                      { label: 'Imagens da fila', ok: diagnostic?.missingImageCount === 0, detail: diagnostic?.missingImageCount ? `${diagnostic.missingImageCount} produto(s) sem imagem válida` : 'Imagens válidas nos produtos selecionados', icon: ImageIcon },
                    ].map((check) => {
                      const Icon = check.icon;
                      return (
                        <div key={check.label} className={cn("flex items-start gap-3 rounded-2xl border p-4", check.ok ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
                          <div className={cn("mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl", check.ok ? "bg-emerald-600 text-white" : "bg-amber-400 text-slate-950")}>{check.ok ? <Check size={19} /> : <Icon size={19} />}</div>
                          <div>
                            <p className={cn("text-sm font-black", check.ok ? "text-emerald-950" : "text-amber-950")}>{check.label}</p>
                            <p className={cn("mt-1 text-xs font-semibold", check.ok ? "text-emerald-700" : "text-amber-700")}>{check.detail}</p>
                          </div>
                        </div>
                      );
                    })}
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl bg-slate-100 p-4"><p className="text-xs font-bold text-slate-500">Fila na extensão</p><p className="mt-1 text-xl font-black text-slate-950">{diagnostic?.queueIndex || 0}/{diagnostic?.queueCount || 0}</p></div>
                      <div className="rounded-2xl bg-slate-100 p-4"><p className="text-xs font-bold text-slate-500">Histórico</p><p className="mt-1 text-xl font-black text-slate-950">{diagnostic?.historyCount || 0}</p></div>
                      <div className="rounded-2xl bg-slate-100 p-4"><p className="text-xs font-bold text-slate-500">Protegidos</p><p className="mt-1 text-xl font-black text-slate-950">{diagnostic?.protectedCount || 0}</p></div>
                    </div>
                    {(diagnostic?.lastError || diagnostic?.lastStatus) && (
                      <div className={cn("rounded-2xl border p-4", diagnostic.lastError ? "border-red-200 bg-red-50" : "border-blue-200 bg-blue-50")}>
                        <p className={cn("text-xs font-black uppercase tracking-wide", diagnostic.lastError ? "text-red-700" : "text-blue-700")}>{diagnostic.lastError ? 'Último erro' : 'Último estado da extensão'}</p>
                        <p className={cn("mt-2 text-sm font-semibold", diagnostic.lastError ? "text-red-900" : "text-blue-900")}>{diagnostic.lastError || diagnostic.lastStatus}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="flex justify-end border-t border-slate-200 p-5">
                <button type="button" onClick={runDiagnostics} disabled={isDiagnosticLoading} className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-60"><RefreshCw size={17} className={isDiagnosticLoading ? 'animate-spin' : ''} /> Executar novamente</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delivery History Modal */}
      <AnimatePresence>
        {isHistoryOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.96, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 16 }} role="dialog" aria-modal="true" aria-labelledby="history-title" className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 sm:p-6">
                <div className="flex gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-600 text-white"><History size={23} /></div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-violet-600">Histórico de envios</p>
                    <h2 id="history-title" className="mt-1 text-2xl font-black text-slate-950">Publicações da extensão</h2>
                    <p className="mt-1 text-sm font-medium text-slate-500">Registros locais dos últimos 30 dias.</p>
                  </div>
                </div>
                <button type="button" onClick={() => setIsHistoryOpen(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-900"><X size={23} /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar sm:p-5">
                {isHistoryLoading ? (
                  <div className="flex min-h-60 items-center justify-center"><RefreshCw className="animate-spin text-violet-600" size={34} /></div>
                ) : deliveryHistory.length ? (
                  <div className="space-y-3">
                    {deliveryHistory.map((entry) => {
                      const statusConfig = {
                        sent: { label: 'Enviado', classes: 'bg-emerald-100 text-emerald-800' },
                        blocked: { label: 'Duplicado bloqueado', classes: 'bg-blue-100 text-blue-800' },
                        failed: { label: 'Falhou', classes: 'bg-red-100 text-red-800' },
                        uncertain: { label: 'Conferir no WhatsApp', classes: 'bg-amber-100 text-amber-800' }
                      }[entry.status] || { label: entry.status, classes: 'bg-slate-100 text-slate-700' };
                      return (
                        <article key={entry.id} className="grid grid-cols-[56px_1fr] gap-3 rounded-2xl border border-slate-200 p-3 sm:grid-cols-[64px_1fr_auto] sm:items-center sm:p-4">
                          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 sm:h-16 sm:w-16">
                            {entry.image ? <img src={entry.image} alt="" className="h-full w-full object-contain" /> : <Package className="text-slate-300" size={24} />}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={cn("rounded-full px-2 py-1 text-[9px] font-black uppercase", statusConfig.classes)}>{statusConfig.label}</span>
                              {entry.marketplace && <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black uppercase text-slate-600">{entry.marketplace}</span>}
                              {entry.mode && <span className="text-[10px] font-bold text-slate-500">{entry.mode === 'image' ? 'Foto + texto' : 'Somente texto'}</span>}
                            </div>
                            <h3 className="mt-2 line-clamp-2 text-sm font-black text-slate-900">{entry.title || 'Anúncio sem título registrado'}</h3>
                            <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-slate-500"><Clock3 size={12} /> {new Date(entry.timestamp).toLocaleString('pt-BR')}</p>
                            {entry.detail && <p className="mt-1 line-clamp-2 text-xs font-medium text-slate-600">{entry.detail}</p>}
                          </div>
                          <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                            {entry.price && <span className="text-sm font-black text-emerald-700">{entry.price}</span>}
                            {entry.link && <a href={entry.link} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" title="Abrir produto"><ExternalLink size={16} /></a>}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex min-h-60 flex-col items-center justify-center text-center">
                    <History className="text-slate-300" size={44} />
                    <h3 className="mt-4 text-lg font-black text-slate-900">Nenhum envio registrado</h3>
                    <p className="mt-2 max-w-sm text-sm font-medium text-slate-500">Depois que a extensão publicar ou bloquear um anúncio, ele aparecerá aqui.</p>
                  </div>
                )}
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-slate-200 p-4 sm:flex-row sm:justify-between sm:p-5">
                <button type="button" onClick={clearDeliveryHistory} disabled={isHistoryLoading || !deliveryHistory.length} className="rounded-xl border border-red-200 px-4 py-3 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-40"><Trash2 size={16} className="mr-2 inline" /> Limpar histórico</button>
                <button type="button" onClick={loadDeliveryHistory} disabled={isHistoryLoading} className="flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-black text-white hover:bg-violet-700 disabled:opacity-60"><RefreshCw size={17} className={isHistoryLoading ? 'animate-spin' : ''} /> Atualizar histórico</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
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
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-dialog-title"
              className="bg-white border border-slate-200 rounded-2xl p-8 max-w-lg w-full shadow-2xl space-y-6"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 id="settings-dialog-title" className="text-2xl font-black text-slate-900 tracking-tight">Configurações Gerais</h2>
                  <p className="text-slate-500 text-sm">Ajuste os dados que serão usados nos novos anúncios.</p>
                </div>
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-900 transition-colors"
                >
                  <Plus className="rotate-45" size={24} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tight">Link Padrão do Grupo/Bio</label>
                  <input 
                    type="text" 
                    value={globalSettings.groupLink}
                    onChange={(e) => setGlobalSettings(prev => ({ ...prev, groupLink: e.target.value }))}
                    className="w-full text-xs p-3 border border-slate-200 rounded-xl font-bold bg-slate-50 focus:ring-1 focus:ring-blue-400 outline-none transition-all"
                    placeholder="https://chat.whatsapp.com/..."
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tight">Cupom Padrão</label>
                  <input 
                    type="text" 
                    value={globalSettings.defaultCoupon}
                    onChange={(e) => setGlobalSettings(prev => ({ ...prev, defaultCoupon: e.target.value }))}
                    className="w-full text-xs p-3 border border-slate-200 rounded-xl font-bold bg-slate-50 focus:ring-1 focus:ring-blue-400 outline-none transition-all"
                    placeholder="Ex: BEMVINDO"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tight">Rótulo: Preço Original</label>
                  <input 
                    type="text" 
                    value={globalSettings.labelOriginalPrice}
                    onChange={(e) => setGlobalSettings(prev => ({ ...prev, labelOriginalPrice: e.target.value }))}
                    className="w-full text-xs p-3 border border-slate-200 rounded-xl font-bold bg-slate-50 focus:ring-1 focus:ring-blue-400 outline-none transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tight">Rótulo: Preço Promo</label>
                  <input 
                    type="text" 
                    value={globalSettings.labelPrice}
                    onChange={(e) => setGlobalSettings(prev => ({ ...prev, labelPrice: e.target.value }))}
                    className="w-full text-xs p-3 border border-slate-200 rounded-xl font-bold bg-slate-50 focus:ring-1 focus:ring-blue-400 outline-none transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tight">Rótulo: Cupom</label>
                  <input 
                    type="text" 
                    value={globalSettings.labelCoupon}
                    onChange={(e) => setGlobalSettings(prev => ({ ...prev, labelCoupon: e.target.value }))}
                    className="w-full text-xs p-3 border border-slate-200 rounded-xl font-bold bg-slate-50 focus:ring-1 focus:ring-blue-400 outline-none transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tight">Rótulo: Link Grupo</label>
                  <input 
                    type="text" 
                    value={globalSettings.labelGroupLink}
                    onChange={(e) => setGlobalSettings(prev => ({ ...prev, labelGroupLink: e.target.value }))}
                    className="w-full text-xs p-3 border border-slate-200 rounded-xl font-bold bg-slate-50 focus:ring-1 focus:ring-blue-400 outline-none transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tight">Intervalo de Postagem (segundos)</label>
                  <input 
                    type="number" 
                    value={globalSettings.autoPostInterval || 30}
                    onChange={(e) => setGlobalSettings(prev => ({ ...prev, autoPostInterval: parseInt(e.target.value) || 5 }))}
                    className="w-full text-xs p-3 border border-slate-200 rounded-xl font-bold bg-slate-50 focus:ring-1 focus:ring-blue-400 outline-none transition-all"
                    placeholder="Ex: 30"
                  />
                </div>

                <div className="pt-6 border-t border-slate-100 col-span-full" id="theme-color-section">
                  <div className="flex flex-wrap gap-3">
                    {[
                      { id: 'blue', color: 'bg-blue-500', name: 'Azul' },
                      { id: 'emerald', color: 'bg-emerald-500', name: 'Verde' },
                      { id: 'pink', color: 'bg-pink-500', name: 'Rosa' },
                      { id: 'orange', color: 'bg-orange-500', name: 'Laranja' },
                      { id: 'indigo', color: 'bg-indigo-500', name: 'Índigo' },
                      { id: 'slate', color: 'bg-slate-800', name: 'Escuro' },
                    ].map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setGlobalSettings(prev => ({ ...prev, themeColor: c.id }))}
                        className={cn(
                          "w-10 h-10 rounded-full border-2 transition-all flex items-center justify-center",
                          globalSettings.themeColor === c.id 
                            ? "border-slate-400 ring-2 ring-slate-100 scale-110" 
                            : "border-transparent hover:scale-105"
                        )}
                      >
                        <div className={cn("w-7 h-7 rounded-full shadow-sm", c.color)}></div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-6 border-t border-slate-100 col-span-full">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Estilo Visual do Card</p>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      { id: 'classic', label: 'Clássico', class: 'rounded-lg border-slate-200' },
                      { id: 'modern', label: 'Moderno', class: 'rounded-2xl border-slate-200 shadow-sm' },
                      { id: 'soft', label: 'Suave', class: 'rounded-[32px] border-slate-100 shadow-md' },
                      { id: 'glass', label: 'Glass', class: 'rounded-2xl border-white/40 bg-white/80 backdrop-blur-sm' },
                    ].map((style) => (
                      <button
                        key={style.id}
                        onClick={() => setGlobalSettings(prev => ({ ...prev, cardStyle: style.id as any }))}
                        className={cn(
                          "p-3 border-2 flex flex-col items-center gap-2 transition-all group",
                          globalSettings.cardStyle === style.id 
                            ? "border-blue-500 bg-blue-50" 
                            : "border-slate-100 hover:border-slate-200"
                        )}
                        style={{ borderRadius: style.id === 'soft' ? '20px' : style.id === 'classic' ? '8px' : '12px' }}
                      >
                        <div className={cn("w-10 h-6 bg-white border shadow-sm", style.class)}></div>
                        <span className="text-[10px] font-bold text-slate-600 uppercase">{style.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-6 border-t border-slate-100 col-span-full">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Personalização de Mensagem (Emojis)</p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {[
                      { key: 'emojiTitle', showKey: 'showEmojiTitle', label: 'Emoji do Título', current: globalSettings.emojiTitle, active: globalSettings.showEmojiTitle },
                      { key: 'emojiPriceOriginal', showKey: 'showEmojiPriceOriginal', label: 'Emoji Preço Original (De:)', current: globalSettings.emojiPriceOriginal, active: globalSettings.showEmojiPriceOriginal },
                      { key: 'emojiPrice', showKey: 'showEmojiPrice', label: 'Emoji do Preço (Por:)', current: globalSettings.emojiPrice, active: globalSettings.showEmojiPrice },
                      { key: 'emojiCoupon', showKey: 'showEmojiCoupon', label: 'Emoji do Cupom', current: globalSettings.emojiCoupon, active: globalSettings.showEmojiCoupon },
                      { key: 'emojiGroup', showKey: 'showEmojiGroup', label: 'Emoji de Link/Grupo', current: globalSettings.emojiGroup, active: globalSettings.showEmojiGroup },
                    ].map((item) => (
                      <div key={item.key} className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                        <div className="flex items-center justify-between mb-3">
                          <label className="text-[10px] font-black text-slate-500 uppercase">{item.label}</label>
                          <button
                            onClick={() => setGlobalSettings(prev => ({ ...prev, [item.showKey]: !prev[item.showKey as keyof GlobalSettings] }))}
                            className={cn(
                              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none",
                              item.active ? "bg-blue-600" : "bg-slate-300"
                            )}
                          >
                            <span className={cn("inline-block h-3 w-3 transform rounded-full bg-white transition-transform", item.active ? "translate-x-5" : "translate-x-1")} />
                          </button>
                        </div>
                        
                        {item.active && (
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-1 custom-scrollbar bg-white rounded-lg border border-slate-100 mb-2">
                              {['➡️', '🔥', '🏷️', '🛒', '⚡', '💎', '🚀', '🎁', '📢', '✅', '✨', '⭐', '📍', '💥', '💰', '📉', '👀', '🎯', '🚩', '📣', '🎈', '🎉', '🎊', '🤑', '🏆', '🔥'].map((emoji, idx) => (
                                <button
                                  key={`${emoji}-${idx}`}
                                  onClick={() => setGlobalSettings(prev => ({ ...prev, [item.key]: emoji }))}
                                  className={cn(
                                    "w-8 h-8 flex items-center justify-center rounded-lg bg-white border transition-all text-sm hover:scale-110",
                                    item.current === emoji ? "border-blue-500 bg-blue-50 z-10 shadow-sm" : "border-slate-100 hover:border-slate-200"
                                  )}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                            <input 
                              type="text" 
                              value={item.current}
                              onChange={(e) => setGlobalSettings(prev => ({ ...prev, [item.key]: e.target.value }))}
                              placeholder="Ou digite o emoji..."
                              className="w-full text-xs p-2 border border-slate-200 rounded-lg bg-white focus:ring-1 focus:ring-blue-400 outline-none"
                            />
                          </div>
                        )}
                        {!item.active && (
                          <p className="text-[10px] text-slate-400 italic">Desativado - nenhum emoji será mostrado neste campo.</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 space-y-2">
                <p className="text-[10px] font-black text-blue-800 uppercase tracking-widest flex items-center gap-2">
                  <Info size={12} /> Dica de Afiliado
                </p>
                <p className="text-[11px] text-blue-700 leading-tight">
                  O aplicativo preserva links afiliados já colados. Quando o link for comum, use <b>"Converter em Afiliado"</b> para abrir o portal oficial do marketplace e gerar seu link.
                </p>
              </div>

              {/* WhatsApp Support Section */}
              <div className="space-y-3 pt-6 border-t border-slate-200">
                <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <HelpCircle size={14} className="text-blue-600" /> WhatsApp não abre no PC?
                </h4>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Se o botão de enviar apenas copiar e não abrir o WhatsApp, oriente o cliente a instalar o aplicativo oficial para melhor integração, ou use a versão Web.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <a 
                    href="https://www.whatsapp.com/download" 
                    target="_blank" 
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all border border-slate-200 shadow-sm"
                  >
                    <Download size={14} className="text-blue-600" /> Baixar App
                  </a>
                  <a 
                    href="https://web.whatsapp.com" 
                    target="_blank" 
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all border border-slate-200 shadow-sm"
                  >
                    <Globe size={14} className="text-green-600" /> Usar Web
                  </a>
                </div>
              </div>

              <button 
                onClick={() => saveSettings(globalSettings)}
                className="w-full py-4 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 transition-all shadow-md shadow-blue-100"
              >
                Salvar Configurações
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
              role="dialog"
              aria-modal="true"
              aria-labelledby="bulk-dialog-title"
              className="bg-white border border-slate-200 rounded-2xl p-8 max-w-2xl w-full shadow-2xl space-y-6"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 id="bulk-dialog-title" className="text-2xl font-black text-slate-900 tracking-tight">Importação em Massa</h2>
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
                  onClick={() => handleBulkImport()}
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
      <header className="relative z-50 flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-950 px-4 py-3 shadow-lg sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-amber-400 shadow-lg shadow-amber-400/20">
            <Zap className="fill-slate-950 text-slate-950" size={22} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-black leading-tight text-white sm:text-xl">Afiliados Pro</h1>
            <p className="truncate text-xs font-semibold text-slate-400">Central profissional de anúncios</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {deferredPrompt && (
            <button 
              onClick={handleInstallClick}
              className="hidden items-center gap-2 rounded-xl border border-blue-500 bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-blue-500 sm:flex"
            >
              <Smartphone size={17} /> Instalar app
            </button>
          )}
          <button
            type="button"
            onClick={runDiagnostics}
            aria-label="Abrir central de diagnóstico"
            title="Diagnóstico"
            className="flex items-center gap-2 rounded-xl border border-blue-500/40 bg-blue-500/10 p-2.5 text-sm font-bold text-blue-200 transition-all hover:bg-blue-500/20 sm:px-4"
          >
            <Activity size={18} /> <span className="hidden xl:inline">Diagnóstico</span>
          </button>
          <button
            type="button"
            onClick={loadDeliveryHistory}
            aria-label="Abrir histórico de envios"
            title="Histórico"
            className="flex items-center gap-2 rounded-xl border border-violet-500/40 bg-violet-500/10 p-2.5 text-sm font-bold text-violet-200 transition-all hover:bg-violet-500/20 sm:px-4"
          >
            <History size={18} /> <span className="hidden xl:inline">Histórico</span>
          </button>
          <button 
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Abrir configurações"
            title="Configurações"
            className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 p-2.5 text-sm font-bold text-slate-100 transition-all hover:border-slate-600 hover:bg-slate-800 sm:px-4"
          >
            <Settings size={18} /> <span className="hidden sm:inline">Configurações</span>
          </button>
          <button 
            onClick={() => setIsBulkModalOpen(true)}
            aria-label="Importar produtos em massa"
            title="Importar em massa"
            className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 p-2.5 text-sm font-bold text-slate-100 transition-all hover:border-slate-600 hover:bg-slate-800 sm:px-4"
          >
            <Download size={18} /> <span className="hidden md:inline">Importar em massa</span>
          </button>
          <button 
            onClick={handleLogout}
            aria-label="Sair do aplicativo"
            title="Sair"
            className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 p-2.5 text-sm font-bold text-slate-100 transition-all hover:border-red-400 hover:bg-red-500/10 hover:text-red-300 sm:px-4"
          >
            <LogOut size={18} /> <span className="hidden lg:inline">Sair</span>
          </button>
        </div>
      </header>

      <nav className="grid grid-cols-3 border-b border-slate-200 bg-white p-2 shadow-sm lg:hidden" aria-label="Navegação principal">
        {([
          { id: 'products', label: 'Produtos', icon: Package, badge: products.length },
          { id: 'editor', label: 'Editor', icon: LayoutDashboard },
          { id: 'preview', label: 'Prévia', icon: Smartphone },
        ] as const).map((item) => {
          const Icon = item.icon;
          const isActive = activeWorkspace === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveWorkspace(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                "flex min-h-12 items-center justify-center gap-2 rounded-xl px-2 text-sm font-bold transition-all",
                isActive ? "bg-slate-950 text-white shadow-md" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              <Icon size={18} />
              <span>{item.label}</span>
              {'badge' in item && <span className={cn("rounded-full px-2 py-0.5 text-xs tabular-nums", isActive ? "bg-amber-400 text-slate-950" : "bg-slate-100 text-slate-600")}>{item.badge}</span>}
            </button>
          );
        })}
      </nav>

      <main className="grid min-h-0 flex-1 grid-cols-12 gap-0 overflow-visible lg:overflow-hidden">
        
        {/* Left Column: Capture & List */}
        <section className={cn(
          "col-span-12 min-h-0 flex-col border-r border-slate-200 bg-slate-100 p-4 lg:col-span-3 lg:flex lg:overflow-hidden xl:p-5",
          activeWorkspace === 'products' ? "flex" : "hidden"
        )}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Etapa 1</p>
              <h2 className="text-lg font-black text-slate-950">Produtos e fila</h2>
            </div>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-bold text-slate-600 shadow-sm">{products.length} itens</span>
          </div>
          
          <div className="flex flex-col space-y-4 lg:h-full lg:overflow-hidden">
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div>
                <label className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-600">Link individual do produto</label>
                <input 
                  type="text" 
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="Cole o link do Mercado Livre, Amazon, AliExpress ou Shopee..."
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 p-3.5 text-sm font-medium outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                />
                <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Marketplaces aceitos">
                  {MARKETPLACES.map((marketplace) => (
                    <span key={marketplace.id} className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[9px] font-black uppercase tracking-wide text-slate-600">
                      {marketplace.name}
                    </span>
                  ))}
                </div>
              </div>
              <button 
                onClick={() => fetchProduct(inputUrl)}
                disabled={isLoading || !inputUrl}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:opacity-50"
              >
                {isLoading ? <div className="w-4 h-4 border-2 border-white/20 border-t-white animate-spin rounded-full" /> : <><Plus size={14} /> Adicionar Produto</>}
              </button>
            </div>

            <details className="group rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-200">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400 text-slate-950"><HelpCircle size={19} /></div>
                  <div>
                    <p className="text-sm font-black text-amber-950">Guia rápido de automação</p>
                    <p className="text-xs font-semibold text-amber-700">Abra para ver o passo a passo</p>
                  </div>
                </div>
                <ChevronRight size={19} className="text-amber-700 transition-transform group-open:rotate-90" />
              </summary>
              <ol className="mt-4 space-y-3 border-t border-amber-200 pt-4 text-sm font-semibold leading-relaxed text-amber-950">
                <li className="flex gap-3"><span className="step-number">1</span><span>Cole ofertas dos marketplaces aceitos ou capture o painel do Mercado Livre.</span></li>
                <li className="flex gap-3"><span className="step-number">2</span><span>Marque na fila os produtos que deseja publicar.</span></li>
                <li className="flex gap-3"><span className="step-number">3</span><span>Instale e mantenha ativa a extensão ML Afiliados Sender.</span></li>
                <li className="flex gap-3"><span className="step-number">4</span><span>Envie para a extensão, escolha a conversa e confirme no WhatsApp.</span></li>
              </ol>
            </details>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-wider text-emerald-900">Extensão ML Afiliados Sender</p>
                  <p className="mt-1 text-[10px] font-bold text-emerald-700">Versão 1.0.12 para Google Chrome</p>
                </div>
                <button
                  type="button"
                  onClick={downloadExtensionArchive}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-black uppercase text-white shadow-sm transition hover:bg-emerald-700"
                >
                  <Download size={14} /> Baixar extensão
                </button>
              </div>

              <details className="mt-4 rounded-xl border border-emerald-200 bg-white p-3">
                <summary className="cursor-pointer text-[10px] font-black uppercase text-emerald-900">
                  Ver instruções de instalação passo a passo
                </summary>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-[10px] font-bold leading-relaxed text-slate-700">
                  <li>Clique em <b>Baixar extensão</b> e aguarde o arquivo ZIP terminar de baixar.</li>
                  <li>Abra a pasta Downloads, clique com o botão direito no ZIP e escolha <b>Extrair tudo</b>.</li>
                  <li>No Chrome, digite <b>chrome://extensions</b> na barra de endereço e pressione Enter.</li>
                  <li>Ative o <b>Modo do desenvolvedor</b> no canto superior direito.</li>
                  <li>Clique em <b>Carregar sem compactação</b>.</li>
                  <li>Selecione a pasta extraída que contém o arquivo <b>manifest.json</b>.</li>
                  <li>Confirme que aparece <b>ML Afiliados Sender — versão 1.0.12</b> e deixe a extensão ativada.</li>
                  <li>Fixe a extensão no ícone de quebra-cabeça do Chrome e abra o WhatsApp Web.</li>
                </ol>
                <p className="mt-3 rounded-lg bg-amber-50 p-2 text-[9px] font-bold text-amber-800">
                  Ao atualizar: remova a versão antiga, extraia o novo ZIP e carregue novamente a pasta.
                </p>
              </details>
            </div>

            {/* Bookmarklets Container */}
            <div className="space-y-2" aria-label="Instalação das automações">
              <div className={cn(
                "flex items-center justify-between rounded-lg border px-3 py-2 text-[10px] font-bold",
                selectedCount > 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-500"
              )}>
                <span>{selectedCount > 0 ? 'Fila pronta para envio' : 'Selecione produtos na fila'}</span>
                <span className="rounded-full bg-white px-2 py-0.5 tabular-nums shadow-sm">{selectedCount} selecionado{selectedCount === 1 ? '' : 's'}</span>
              </div>
              {/* Bookmarklet 1: Capture */}
              <button
                type="button"
                draggable
                    onClick={() => toast.error('NÃO CLIQUE! Você deve ARRASTAR este botão para a Barra de Favoritos do seu Chrome!', { duration: 6000, icon: '⬆️' })}
                    onDragStart={(e) => {
                      const scraperScript = `javascript:(function(){function clean(s){return(s||'').replace(/\\s+/g,' ').trim()}function parsePrice(s){if(!s)return null;var m=String(s).match(/[\\d\\.]+(?:,\\d{1,2})?/);if(!m)return null;var v=m[0];if(/,\\d{1,2}$/.test(v))v=v.replace(/\\./g,'').replace(',','.');var n=parseFloat(v);return isFinite(n)&&n>0&&n<1e6?n:null}function fmt(n){if(n==null)return null;var s=n.toFixed(2).replace('.',',');return s.replace(/,00$/,'')}function cleanTitle(s){s=clean(s);s=s.replace(/^[☀-➿⌀-⏿■-◿\\s\\-\\|·]+/,'');s=s.replace(/^[\\uD83C-\\uDBFF][\\uDC00-\\uDFFF]\\s*/,'');s=s.replace(/^(MAIS\\s+VENDIDO|GANHOS\\s+EXTRAS|PROMO[ÇC][ÃA]O|OFF|FRETE\\s+GR[ÁA]TIS|NOVO)\\s*[:\\-]?\\s*/i,'');return clean(s)}function isJunk(s){if(!s)return true;if(s.length<10)return true;if(/^(R\\$|\\d+\\s*%|MAIS\\s+VENDIDO|Compartilhar|Frete|GANHOS)/i.test(s))return true;return false}function isProductHref(h){if(!h)return false;if(/meli\\.la\\//i.test(h))return true;if(!/mercadolivre\\.com/i.test(h))return false;if(/\\/(ajuda|hub|login|cadastro|conta|seguranca|menu|busca|policies|terminos|notification)/i.test(h))return false;if(/\\/p\\/MLB\\d+/i.test(h))return true;if(/[?&]client=affiliates/i.test(h))return true;if(/produto\\.mercadolivre/i.test(h))return true;return false}function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}var MELI_RE=/https?:\\/\\/meli\\.la\\/[A-Za-z0-9]+/;var pendingIdx=-1;var captured={};function trapMeli(text){if(typeof text!=='string')return false;var m=text.match(MELI_RE);if(m&&pendingIdx>=0){captured[pendingIdx]=m[0];return true}return false}var origWT=null;if(navigator.clipboard&&navigator.clipboard.writeText){origWT=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=function(text){trapMeli(text);return origWT(text)}}var origExec=document.execCommand.bind(document);document.execCommand=function(cmd){if(cmd==='copy'||cmd==='cut'){try{var sel=window.getSelection?window.getSelection().toString():'';if(sel)trapMeli(sel);var ae=document.activeElement;if(ae){if(ae.value)trapMeli(ae.value);if(ae.textContent)trapMeli(ae.textContent)}}catch(e){}}return origExec.apply(document,arguments)};document.addEventListener('copy',function(e){try{if(e.clipboardData){var txt=e.clipboardData.getData('text/plain')||e.clipboardData.getData('text');if(txt)trapMeli(txt)}var sel=window.getSelection?window.getSelection().toString():'';if(sel)trapMeli(sel)}catch(err){}},true);function findInDOM(){var sels=['input[value*="meli.la"]','a[href*="meli.la"]','textarea','[data-href*="meli.la"]','[data-url*="meli.la"]','[data-clipboard-text*="meli.la"]'];var els=document.querySelectorAll(sels.join(','));for(var i=0;i<els.length;i++){var attrs=['value','href','data-href','data-url','data-clipboard-text'];for(var a=0;a<attrs.length;a++){var v=els[i].getAttribute?els[i].getAttribute(attrs[a]):null;if(v){var m=v.match(MELI_RE);if(m)return m[0]}}var t=els[i].value||els[i].textContent||'';var m2=t&&t.match(MELI_RE);if(m2)return m2[0]}var html=document.body&&document.body.innerHTML||'';var mm=html.match(MELI_RE);return mm?mm[0]:null}function findCopyLink(){var best=null,bestLen=9999;var all=document.querySelectorAll('*');for(var i=0;i<all.length;i++){var el=all[i];var txt=clean(el.textContent||'');if(!txt||txt.length>30)continue;if(!/^copiar\\s+link$/i.test(txt))continue;var click=el;for(var j=0;j<4&&click;j++){var tag=(click.tagName||'').toLowerCase();if(tag==='button'||tag==='a'||click.getAttribute('role')=== 'button'||click.onclick)break;click=click.parentElement}if(!click)click=el;if(txt.length<bestLen){best=click;bestLen=txt.length}}return best}function humanClick(el){if(!el)return;try{var opts={bubbles:true,cancelable:true,view:window,button:0};el.dispatchEvent(new MouseEvent('mousedown',opts));el.dispatchEvent(new MouseEvent('mouseup',opts));el.dispatchEvent(new MouseEvent('click',opts))}catch(e){try{el.click()}catch(e2){}}}function closeModal(){var sels=['[class*="andes-modal__close"]','button[class*="close"]','[aria-label*="ech" i]','[aria-label*="lose" i]','[class*="close-button"]'];for(var i=0;i<sels.length;i++){var b=document.querySelector(sels[i]);if(b){try{humanClick(b)}catch(e){}return}}document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));document.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}))}var priceRe=/(?:R\\$|R\\$ )?\\s*[\\d\\.]+(?:,\\d{2})?/g;var imgs=document.querySelectorAll('img');var seenSrc={};var rawCards=[];for(var i=0;i<imgs.length;i++){var img=imgs[i];var w=img.naturalWidth||img.width||0;var h=img.naturalHeight||img.height||0;if(w<100&&h<100)continue;if(seenSrc[img.src])continue;seenSrc[img.src]=1;var card=img.parentElement;var foundCard=null;for(var j=0;j<8&&card;j++){var prods=[];var alls=card.querySelectorAll('a[href]');for(var x=0;x<alls.length;x++)if(isProductHref(alls[x].href))prods.push(alls[x]);var txt=card.innerText||'';var prices=txt.match(priceRe);if(prods.length>=1&&prices&&prices.length){var bigImgs=card.querySelectorAll('img');var bigCount=0;for(var k=0;k<bigImgs.length;k++){var iw=bigImgs[k].naturalWidth||bigImgs[k].width||0;var ih=bigImgs[k].naturalHeight||bigImgs[k].height||0;if(iw>=100||ih>=100)bigCount++}if(bigCount<=1){foundCard={el:card,img:img,prices:prices,links:prods};break}}card=card.parentElement}if(foundCard)rawCards.push(foundCard)}if(!rawCards.length){alert('Nenhum produto encontrado nesta pagina. Va ate uma pagina de produtos no painel ML Afiliados.');return}var products=rawCards.map(function(c){var text=c.el.innerText||'';var title=cleanTitle(c.img.alt||'');if(isJunk(title)){var lines=text.split('\\n').map(clean).filter(Boolean);for(var li=0;li<lines.length;li++){var l=cleanTitle(lines[li]);if(!isJunk(l)&&/[a-zA-ZÀ-ſ]{4,}/.test(l)){title=l;break}}}var pFull=null,pOld=null;var pTag=c.el.querySelector('.andes-money-amount--previous');if(pTag)pOld=parsePrice(pTag.innerText);var mTags=c.el.querySelectorAll('.andes-money-amount');for(var t=0;t<mTags.length;t++){var v=parsePrice(mTags[t].innerText);if(!v)continue;if(mTags[t].classList.contains('andes-money-amount--previous'))pOld=v;else pFull=v}var vals=c.prices.map(parsePrice).filter(Boolean);var uniq=[];for(var v=0;v<vals.length;v++)if(uniq.indexOf(vals[v])<0)uniq.push(vals[v]);if(!pFull&&uniq.length>=1)pFull=Math.min.apply(null,uniq);if(!pOld&&uniq.length>=2)pOld=Math.max.apply(null,uniq);if(pOld&&pFull&&pOld<=pFull*1.01)pOld=null;var discount='';if(pOld&&pFull&&pOld>pFull){var pct=Math.floor((1-pFull/pOld)*100);if(pct>=1)discount=pct+'% OFF'}var meli=c.el.querySelector('a[href*="meli.la"]');var longHref=c.links[0].href;return{_card:c.el,title:title.slice(0,200),price:fmt(pFull),price_from:fmt(pOld),originalPrice:fmt(pOld),discount:discount,image:c.img.src,affiliate_link:meli?meli.href:longHref,_hasMeli:!!meli}});function findShareBtn(cardEl){var cands=cardEl.querySelectorAll('button, a, [role="button"]');for(var i=0;i<cands.length;i++){var t=(cands[i].textContent||'')+' '+(cands[i].getAttribute('aria-label')||'');if(/compartilhar/i.test(t))return cands[i]}return null}function waitMeli(idx,timeoutMs){return new Promise(function(resolve){var start=Date.now();function tick(){if(captured[idx])return resolve(captured[idx]);var dom=findInDOM();if(dom)return resolve(dom);if(Date.now()-start>=timeoutMs)return resolve(null);setTimeout(tick,150)}tick()})}function processOne(idx){if(idx>=products.length)return finalize();var p=products[idx];if(p._hasMeli)return processOne(idx+1);pendingIdx=idx;var btn=findShareBtn(p._card);if(!btn){pendingIdx=-1;return processOne(idx+1)}humanClick(btn);sleep(800).then(function(){var copy=findCopyLink();if(copy)humanClick(copy);return waitMeli(idx,2500)}).then(function(link){if(link)p.affiliate_link=link;closeModal();return sleep(600)}).then(function(){pendingIdx=-1;processOne(idx+1)})}function finalize(){products.forEach(function(p){delete p._card;delete p._hasMeli});var json=JSON.stringify(products);var got=0;for(var i=0;i<products.length;i++)if(/meli\\.la\\//.test(products[i].affiliate_link||''))got++;var msg=products.length+' produto(s) capturado(s) ('+got+' com link meli.la curto)! Volte ao app, cole com Ctrl+V e clique em Importar.';var done=function(){alert(msg)};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(json).then(done,function(){var t=document.createElement('textarea');t.value=json;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();done()})}else{var t=document.createElement('textarea');t.value=json;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();done()}}processOne(0)})();`;
                      const priceSafeScraper = scraperScript
                        .replace(
                          "var n=parseFloat(v);",
                          "if(/^[0-9]{1,3}(\\.[0-9]{3})+$/.test(v))v=v.replace(/\\./g,'');var n=parseFloat(v);"
                        )
                        .replace(
                          "for(var t=0;t<mTags.length;t++){var v=parsePrice(mTags[t].innerText);if(!v)continue;if(mTags[t].classList.contains('andes-money-amount--previous'))pOld=v;else pFull=v}",
                          "for(var t=0;t<mTags.length;t++){var mt=mTags[t];if(mt.closest('.ui-pdp-installments,.ui-search-installments,[class*=installment]'))continue;var v=parsePrice(mt.innerText);if(!v)continue;if(mt.classList.contains('andes-money-amount--previous'))pOld=v;else if(!pFull)pFull=v}"
                        )
                        .replace(
                          "if(!pFull&&uniq.length>=1)pFull=Math.min.apply(null,uniq);",
                          "if(!pFull&&uniq.length>=1){var currentVals=pOld?uniq.filter(function(n){return n<pOld*.999}):uniq;pFull=Math.max.apply(null,currentVals.length?currentVals:uniq)};"
                        )
                        .replace(
                          "var meli=c.el.querySelector('a[href*=\"meli.la\"]');var longHref=c.links[0].href;return{_card:c.el,title:title.slice(0,200),price:fmt(pFull),price_from:fmt(pOld),originalPrice:fmt(pOld),discount:discount,image:c.img.src,affiliate_link:meli?meli.href:longHref,_hasMeli:!!meli}",
                          "var meli=c.el.querySelector('a[href*=\"meli.la\"]');var cardMeli=meli?meli.href:null;if(!cardMeli){var cardMatch=((c.el.innerText||'')+' '+(c.el.textContent||'')+' '+(c.el.innerHTML||'')).match(MELI_RE);if(cardMatch)cardMeli=cardMatch[0]}var longHref=c.links[0].href;return{_card:c.el,title:title.slice(0,200),price:fmt(pFull),price_from:fmt(pOld),originalPrice:fmt(pOld),discount:discount,image:c.img.src,affiliate_link:cardMeli||longHref,_hasMeli:!!cardMeli}"
                        );
                      e.dataTransfer.setData('text/plain', priceSafeScraper);
                      e.dataTransfer.setData('text/uri-list', priceSafeScraper);
                      e.dataTransfer.setData('text/html', `<a href="${priceSafeScraper}">1. CAPTURAR (V12)</a>`);
                    }}
                    aria-label="Arraste para os favoritos: capturar ofertas do Mercado Livre"
                    className="w-full bg-slate-900 border border-yellow-500/30 px-3 py-3 rounded-xl text-[10px] text-yellow-500 font-bold flex items-center justify-center gap-2 cursor-grab active:cursor-grabbing hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 transition-all group shadow-lg"
                  >
                    <Target size={14} className="text-yellow-500" />
                    <span>1. CAPTURAR OFERTAS NO MERCADO LIVRE (V11)</span>
                  </button>

                  {/* Bookmarklet 2: Auto-Sender V6 */}
                  <button
                    type="button"
                    draggable={false}
                    onClick={openPublicationReview}
                    onDragStart={(e) => {
                      const selectedItems = products.filter(p => !!p.selected);
                      if (selectedItems.length === 0) {
                        toast.error('MARQUE OS PRODUTOS NA FILA PRIMEIRO!');
                        e.preventDefault();
                        return;
                      }
                      const incompleteProducts = selectedItems.filter((product) => {
                        const price = parseCurrencyValue(product.price);
                        return price === null || price <= 0;
                      });
                      if (incompleteProducts.length > 0) {
                        toast.error(`Preencha o preço de ${incompleteProducts.length} produto(s) antes de enviar.`);
                        e.preventDefault();
                        return;
                      }

                      const queueData = selectedItems.map(p => ({
                        image: p.image || '',
                        text: formatText(p)
                      }));

                      const delay = globalSettings.autoPostInterval || 30;
                      const scriptName = "2. ENVIAR (V22)";

                      const script = `javascript:(function(){var DATA=${JSON.stringify(queueData)};var DELAY_MS=${delay}*1000;if(!Array.isArray(DATA)||!DATA.length){alert('Fila vazia.');return}if(!/web\\.whatsapp\\.com/.test(location.hostname)){alert('Abra o WhatsApp Web primeiro.');return}var ex=document.getElementById('__ml_bot__');if(ex)ex.remove();var st=false;var b=document.createElement('div');b.id='__ml_bot__';b.style.cssText='position:fixed;top:80px;right:20px;background:#fff;border:3px solid #25d366;padding:20px;z-index:99999;font:14px sans-serif;color:#000;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.4);min-width:320px;';b.innerHTML='<div style="font-weight:900;color:#25d366;margin-bottom:10px;font-size:18px;display:flex;justify-content:space-between;align-items:center;"><span>🚀 Zap Ninja PRO V21</span><span id="__ml_x__" style="cursor:pointer;color:#999;font-size:24px;">&times;</span></div><div id="__ml_st__" style="margin:10px 0;font-size:14px;line-height:1.5;min-height:42px;color:#333;font-weight:500;">Conectando...</div><div style="background:#eee;height:10px;border-radius:5px;overflow:hidden;margin:12px 0;"><div id="__ml_bar__" style="background:#25d366;height:100%;width:0;transition:width 0.4s ease;"></div></div><button id="__ml_st_btn__" style="width:100%;margin-top:10px;padding:12px;background:#dc3545;color:#fff;border:0;border-radius:10px;cursor:pointer;font-weight:800;font-size:13px;text-transform:uppercase;">PARAR TUDO</button>';document.body.appendChild(b);document.getElementById('__ml_st_btn__').onclick=function(){st=true;setSt('⛔ Parado!');setTimeout(()=>b.remove(),1500)};document.getElementById('__ml_x__').onclick=function(){st=true;b.remove()};function setSt(s){var el=document.getElementById('__ml_st__');if(el)el.textContent=s}function setPr(n,t){var el=document.getElementById('__ml_bar__');if(el)el.style.width=(n/t*100)+'%'}function sleep(m){return new Promise(r=>setTimeout(r,m))}function clUI(){var xbtns=document.querySelectorAll('button[aria-label="Fechar"], button[aria-label="Close"], [data-icon="x"], [data-icon="close"], [data-icon="wds-ic-close"]');xbtns.forEach(x=>{try{x.click()}catch(e){}});var d=document.querySelector('div[role="dialog"]');if(d){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}))}var ovls=document.querySelectorAll('.overlay, [class*="overlay"]');ovls.forEach(o=>{if(o.children.length===0||o.classList.contains('overlay'))o.remove()});var bts=document.querySelectorAll('button');bts.forEach(b=>{if(b.innerText==='OK'||b.innerText==='ENTENDI')b.click()})}function mkF(bl){return new File([bl],'p.jpg',{type:bl.type||'image/jpeg'})}async function ftImg(u,fn){if(!u)return null;fn('🔍 Baixando imagem...');var ps=[u,'https://images.weserv.nl/?url='+encodeURIComponent(u.replace(/^https?:\\/\\//,'')),'https://corsproxy.io/?'+encodeURIComponent(u)];for(var i=0;i<ps.length;i++){if(st)return null;try{var r=await fetch(ps[i],{mode:'cors'});if(r.ok){var bl=await r.blob();if(bl.size>1000)return mkF(bl)}}catch(e){}}return null}function fInp(){var m=document.querySelector('#main');if(m)return m.querySelector('[contenteditable="true"]');return document.querySelector('footer [contenteditable="true"]')||document.querySelector('[role="textbox"][contenteditable="true"]')}function fCap(){return document.querySelector('div[role="dialog"] [contenteditable="true"]')||document.querySelector('.copyable-area [contenteditable="true"]')||document.querySelector('div[role="presentation"] [contenteditable="true"]')||document.querySelector('#main [contenteditable="true"][data-tab="10"]')}function fSnd(){var i=document.querySelector('span[data-icon="send"]')||document.querySelector('span[data-icon="wds-ic-send-filled"]');return i?i.closest('button')||i.parentElement:null}function psT(el,t){el.focus();var d=new DataTransfer();d.setData('text/plain',t);el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}))}function psI(f){var d=new DataTransfer();d.items.add(f);var e=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d});var i=fInp();if(i){i.click();i.focus();i.dispatchEvent(e)}document.body.dispatchEvent(e)}function drI(f){var d=new DataTransfer();d.items.add(f);var t=document.querySelector('#main')||document.body;['dragenter','dragover','drop'].forEach(ty=>{t.dispatchEvent(new DragEvent(ty,{bubbles:true,cancelable:true,dataTransfer:d}))})}async function sndT(t){var i=fInp();if(!i)return;psT(i,t);await sleep(1500);var btn=fSnd();if(btn)btn.click();else i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true}))}async function snd(m,idx,tot){var p='['+ (idx+1)+'/'+tot+'] ';for(var k=0;k<3;k++){clUI();await sleep(1000)}var img=await ftImg(m.image,s=>setSt(p+s));if(!img){setSt(p+'⚠️ Foto falhou, enviando texto...');await sndT(m.text);return}setSt(p+'🖼️ Preparando foto...');var attempts=0,cap=null;while(attempts<4&&!cap){var inp=fInp();if(inp){inp.click();await sleep(200);inp.focus();}await sleep(1500);psI(img);for(var j=0;j<70;j++){if(st)return;await sleep(300);cap=fCap();if(cap)break}attempts++;if(!cap&&attempts<4){setSt(p+'🔄 Re-tentando ('+attempts+')...');clUI();await sleep(2500)}}if(!cap){setSt(p+'🔄 Tentando arrasto...');drI(img);for(var j=0;j<50;j++){if(st)return;await sleep(500);cap=fCap();if(cap)break}}if(!cap){setSt(p+'❌ Erro anexo, via texto...');await sndT(m.text);return}setSt(p+'✍️ Legendando...');cap.focus();psT(cap,m.text);await sleep(2500);var btn=fSnd();if(btn)btn.click();else cap.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true}));await sleep(6000);clUI();setSt(p+'✅ Enviado!')}async function run(){for(var i=0;i<DATA.length;i++){if(st)return;if(!fInp()){setSt('⚠️ Selecione a conversa...');while(!fInp()&&!st)await sleep(1000);if(st)return}setPr(i,DATA.length);await snd(DATA[i],i,DATA.length);if(i<DATA.length-1&&!st){var d=Math.floor(DELAY_MS/1000);for(var s=d;s>0;s--){if(st)return;setSt('['+ (i+1)+'/'+DATA.length+'] Aguardando '+s+'s...');await sleep(1000)}}}setPr(DATA.length,DATA.length);setSt('🔥 Concluido!');setTimeout(()=>b.remove(),4000)}run()})()`;

                      const improvedScript = buildWhatsAppSenderBookmarklet(queueData, delay);
                      e.dataTransfer.setData('text/plain', improvedScript);
                      e.dataTransfer.setData('text/uri-list', improvedScript);
                      e.dataTransfer.setData('text/html', `<a href="${improvedScript}">${scriptName}</a>`);
                    }}
                    aria-label={`Arraste para os favoritos: enviar ${selectedCount} produtos pelo WhatsApp Web`}
                    className={cn(
                      "w-full border px-3 py-3 rounded-xl text-[10px] text-white font-bold flex items-center justify-center gap-2 cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 transition-all shadow-lg",
                      selectedCount > 0 ? "bg-emerald-600 border-emerald-400 hover:bg-emerald-700 shadow-emerald-600/20" : "bg-slate-400 border-slate-300 shadow-none"
                    )}
                  >
                    <Zap size={14} className="text-white fill-emerald-200" />
                    <span>2. REVISAR E ENVIAR {selectedCount > 0 ? `${selectedCount} SELECIONADO${selectedCount === 1 ? '' : 'S'}` : 'SELECIONADOS'}</span>
                  </button>
                </div>

                <div className="flex-1 overflow-hidden flex flex-col pt-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Fila ({filteredProducts.length})</h3>
                  <button 
                    onClick={() => toggleAllSelection(products.some(p => !p.selected))}
                    className="text-[9px] font-black text-blue-500 uppercase hover:underline"
                  >
                    {products.some(p => !p.selected) ? 'Marcar Tudo' : 'Desmarcar'}
                  </button>
                </div>
                <div className="relative">
                   <Search size={12} className="absolute left-2 top-2 text-slate-400" />
                   <input 
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar..."
                    className="pl-7 pr-2 py-1 text-[10px] bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 w-24"
                   />
                </div>
              </div>

              {/* Categories Filter */}
              <div className="flex gap-2 mb-3 overflow-x-auto pb-1 no-scrollbar">
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={cn(
                      "px-3 py-1 rounded-full text-[9px] font-black uppercase whitespace-nowrap transition-all border",
                      selectedCategory === cat 
                        ? "bg-blue-600 text-white border-blue-600" 
                        : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                    )}
                  >
                    {cat === 'all' ? 'Tudo' : cat}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {filteredProducts.length === 0 ? (
                  <div className="text-center py-12 opacity-50 space-y-2">
                     <Package size={32} className="mx-auto text-slate-300" />
                     <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Nenhum produto</p>
                  </div>
                ) : (
                  filteredProducts.map(p => (
                    <motion.div 
                      key={p.id}
                      onClick={() => { setSelectedProductId(p.id); setActiveWorkspace('editor'); }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedProductId(p.id);
                          setActiveWorkspace('editor');
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`Editar produto ${p.title}`}
                      className={cn(
                        "group flex items-center gap-3 p-2.5 rounded-xl border transition-all cursor-pointer relative overflow-hidden",
                        selectedProductId === p.id 
                          ? "bg-white border-blue-200 ring-2 ring-blue-50" 
                          : "bg-white border-slate-200 hover:border-slate-300",
                        p.selected && "border-blue-400 bg-blue-50/30"
                      )}
                    >
                      <div 
                        onClick={(e) => { e.stopPropagation(); toggleProductSelection(p.id, !!p.selected); }}
                        className={cn(
                          "absolute left-0 top-0 bottom-0 w-1 transition-all",
                          p.selected ? "bg-blue-500" : "bg-transparent group-hover:bg-slate-200"
                        )}
                      />

                      <div className="flex items-center gap-3 flex-1 overflow-hidden">
                        <div 
                          onClick={(e) => { e.stopPropagation(); toggleProductSelection(p.id, !!p.selected); }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              event.stopPropagation();
                              toggleProductSelection(p.id, !!p.selected);
                            }
                          }}
                          role="checkbox"
                          aria-checked={!!p.selected}
                          aria-label={`Selecionar ${p.title} para envio`}
                          tabIndex={0}
                          className={cn(
                            "w-4 h-4 rounded border flex items-center justify-center transition-all flex-shrink-0",
                            p.selected ? "bg-blue-500 border-blue-500" : "bg-white border-slate-300"
                          )}
                        >
                          {p.selected && <Check size={10} className="text-white" />}
                        </div>

                        <div className="w-10 h-10 bg-white rounded-lg border border-slate-100 flex-shrink-0 overflow-hidden">
                        {p.image ? (
                          <img src={p.image} className="w-full h-full object-contain" alt="" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-300">
                            <ImageIcon size={16} />
                          </div>
                        )}
                      </div>
                      <div className="overflow-hidden flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[8px] font-black uppercase whitespace-nowrap border border-blue-100">
                            {resolveProductMarketplace(p).name}
                          </span>
                          <span className="hidden px-1.5 py-0.5 bg-slate-50 text-slate-500 rounded text-[8px] font-black uppercase whitespace-nowrap border border-slate-100 xl:inline">
                            {p.category || 'Geral'}
                          </span>
                          {p.isHighlight && (
                            <span className="px-1.5 py-0.5 bg-yellow-400 text-slate-900 rounded text-[8px] font-black uppercase whitespace-nowrap shadow-sm">
                              Super
                            </span>
                          )}
                          <p className={cn("text-[11px] font-bold truncate", selectedProductId === p.id ? "text-blue-600" : "text-slate-800")}>{p.title}</p>
                        </div>
                        <p className={cn("text-[10px] font-medium", parseCurrencyValue(p.price) ? "text-slate-500" : "text-amber-700")}>
                          {parseCurrencyValue(p.price) ? `R$ ${p.price}` : 'Preço pendente'}
                        </p>
                      </div>
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); deleteProduct(p.id); }}
                        aria-label={`Excluir ${p.title}`} title="Excluir produto" className="flex-shrink-0 rounded-lg p-2 text-slate-400 opacity-100 transition-all hover:bg-red-50 hover:text-red-600 lg:opacity-0 lg:group-hover:opacity-100"
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
        <section className={cn(
          "col-span-12 min-h-0 border-r border-slate-200 bg-white p-5 lg:col-span-5 lg:block lg:overflow-y-auto lg:p-8 custom-scrollbar",
          activeWorkspace === 'editor' ? "block" : "hidden"
        )}>
          <div className="mx-auto mb-6 flex max-w-xl items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Etapa 2</p>
              <h2 className="text-xl font-black text-slate-950">Editar anúncio</h2>
              <p className="mt-1 text-sm font-medium text-slate-500">Revise as informações antes de publicar.</p>
            </div>
            <button type="button" onClick={() => setActiveWorkspace('preview')} className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-200 lg:hidden">
              Ver prévia <ChevronRight size={16} />
            </button>
          </div>
          
          {localProduct ? (
            <div className="space-y-6 max-w-xl mx-auto">
                {/* Super Oferta Toggle */}
                <div className="pt-2">
                  <button
                    onClick={() => {
                       const newState = !localProduct.isHighlight;
                       handleLocalUpdate({ isHighlight: newState });
                       if (newState) {
                         fireCelebration();
                       }
                    }}
                    className={cn(
                      "w-full p-4 rounded-xl border-2 flex items-center justify-between transition-all group",
                      localProduct.isHighlight 
                        ? "bg-yellow-400 border-yellow-500 shadow-lg shadow-yellow-100" 
                        : "bg-slate-50 border-slate-200 hover:border-slate-300"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                        localProduct.isHighlight ? "bg-white text-yellow-600 scale-110" : "bg-slate-200 text-slate-400"
                      )}>
                        <PartyPopper size={20} />
                      </div>
                      <div className="text-left">
                        <p className={cn("text-[10px] font-black uppercase tracking-widest leading-none mb-1", localProduct.isHighlight ? "text-slate-900" : "text-slate-400")}>Highlight VIP</p>
                        <p className={cn("text-xs font-bold", localProduct.isHighlight ? "text-slate-900" : "text-slate-500")}>Transformar em Super Oferta</p>
                      </div>
                    </div>
                    <div className={cn(
                      "w-12 h-6 rounded-full relative transition-all border",
                      localProduct.isHighlight ? "bg-slate-900 border-slate-900" : "bg-slate-200 border-slate-300"
                    )}>
                      <div className={cn(
                        "w-4 h-4 rounded-full bg-white absolute top-1 transition-all shadow-sm",
                        localProduct.isHighlight ? "right-1" : "left-1"
                      )} />
                    </div>
                  </button>
                </div>

                <div className="space-y-1.5 pt-2">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tight">Categoria do Produto</label>
                  <Tag size={12} className="text-slate-400" />
                </div>
                <input 
                  type="text"
                  value={localProduct.category || "Geral"}
                  onChange={(e) => handleLocalUpdate({ category: e.target.value })}
                  placeholder="Ex: Eletrônicos, Cozinha..."
                  className="w-full text-xs p-3 border border-slate-200 rounded-xl font-bold bg-slate-50 focus:ring-1 focus:ring-blue-400 outline-none transition-all"
                />
              </div>

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
                  value={localProduct.title}
                  onChange={(e) => handleLocalUpdate({ title: e.target.value })}
                  className="w-full text-sm p-4 border border-slate-200 rounded-xl font-bold bg-slate-50 focus:ring-1 focus:ring-blue-400 outline-none transition-all min-h-[100px] leading-tight"
                />
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <input 
                    type="text"
                    value={localProduct.labelOriginalPrice}
                    onChange={(e) => handleLocalUpdate({ labelOriginalPrice: e.target.value })}
                    placeholder={globalSettings.labelOriginalPrice || "De:"}
                    className="text-[10px] font-black text-slate-500 uppercase tracking-tight bg-transparent border-none p-0 focus:ring-0 focus:outline-none w-full"
                  />
                  <div className="relative">
                    <span className="absolute left-4 top-4 text-slate-400 text-sm font-bold">R$</span>
                    <input 
                      type="text" 
                      value={localProduct.originalPrice}
                      onChange={(e) => handleLocalUpdate({ originalPrice: e.target.value })}
                      placeholder="Ex: 59,90"
                      className="w-full text-sm p-4 pl-12 border border-slate-200 rounded-xl font-bold text-slate-400 bg-slate-50 focus:ring-1 focus:ring-blue-400 outline-none transition-all line-through"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <input 
                    type="text"
                    value={localProduct.labelPrice}
                    onChange={(e) => handleLocalUpdate({ labelPrice: e.target.value })}
                    placeholder={globalSettings.labelPrice || "Por:"}
                    className="text-[10px] font-black text-slate-500 uppercase tracking-tight bg-transparent border-none p-0 focus:ring-0 focus:outline-none w-full"
                  />
                  <div className="relative">
                    <span className="absolute left-4 top-4 text-slate-400 text-sm font-bold">R$</span>
                    <input 
                      type="text" 
                      value={localProduct.price}
                      onChange={(e) => handleLocalUpdate({ price: e.target.value })}
                      className="w-full text-sm p-4 pl-12 border border-slate-200 rounded-xl font-black text-green-600 bg-slate-50 focus:ring-1 focus:ring-blue-400 outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <input 
                    type="text"
                    value={localProduct.labelCoupon}
                    onChange={(e) => handleLocalUpdate({ labelCoupon: e.target.value })}
                    placeholder={globalSettings.labelCoupon || "Cupom Ativo:"}
                    className="text-[10px] font-black text-slate-500 uppercase tracking-tight bg-transparent border-none p-0 focus:ring-0 focus:outline-none w-full"
                  />
                  
                  {/* Calculadora de Desconto */}
                  <div className="flex items-center gap-1 bg-slate-50 rounded-lg p-0.5 px-1.5 border border-slate-200">
                    <span className="text-[9px] font-black text-slate-400 uppercase">Desconto:</span>
                    <input 
                      type="text"
                      value={discountPercent}
                      onChange={(e) => setDiscountPercent(e.target.value)}
                      placeholder=""
                      className="w-10 text-[10px] font-bold bg-white border border-slate-200 rounded px-1 h-4 text-center focus:ring-1 focus:ring-blue-400 focus:outline-none"
                    />
                    <span className="text-[10px] font-bold text-slate-400">%</span>
                    <button 
                      onClick={applyPercentageDiscount}
                      className="text-[9px] font-black uppercase text-blue-600 hover:bg-blue-50 px-1 rounded transition-colors"
                    >
                      Aplicar
                    </button>
                    {priceBeforeDiscount && (
                      <button 
                        onClick={undoDiscount}
                        className="text-[9px] font-black uppercase text-rose-500 hover:bg-rose-50 px-1 rounded transition-colors border-l border-slate-200"
                      >
                        Voltar
                      </button>
                    )}
                  </div>

                  {localProduct.coupon && (
                    <span className="text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-bold animate-pulse">Detectado</span>
                  )}
                </div>
                <input 
                  type="text" 
                  value={localProduct.coupon}
                  onChange={(e) => handleLocalUpdate({ coupon: e.target.value })}
                  placeholder="Ex: CUPOM10"
                  className="w-full text-sm p-4 border border-orange-200 rounded-xl font-black text-orange-600 bg-orange-50/30 focus:ring-1 focus:ring-orange-400 outline-none transition-all tracking-wider uppercase"
                />
              </div>

              <div className="space-y-1.5">
                <input 
                  type="text"
                  value={localProduct.labelGroupLink}
                  onChange={(e) => handleLocalUpdate({ labelGroupLink: e.target.value })}
                  placeholder={globalSettings.labelGroupLink || "Link do Grupo:"}
                  className="text-[10px] font-black text-slate-500 uppercase tracking-tight bg-transparent border-none p-0 focus:ring-0 focus:outline-none w-full mb-1.5"
                />
                <div className="relative">
                  <Smartphone className="absolute left-4 top-4 text-slate-400" size={16} />
                  <input 
                    type="text" 
                    value={localProduct.groupLink}
                    onChange={(e) => handleLocalUpdate({ groupLink: e.target.value })}
                    className="w-full text-sm p-4 pl-12 border border-slate-200 rounded-xl text-blue-600 font-medium bg-slate-50 focus:ring-1 focus:ring-blue-400 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tight">Link de Afiliado</label>
                  {!isAffiliateLink(localProduct.link, resolveProductMarketplace(localProduct).id) && (
                    <button 
                      onClick={openAffiliateLinkBuilder}
                      className="text-[9px] font-black uppercase text-blue-600 hover:underline flex items-center gap-1"
                    >
                      <Zap size={10} /> Converter em Afiliado
                    </button>
                  )}
                </div>
                <div className="relative">
                  <ExternalLink className="absolute left-4 top-4 text-slate-400" size={16} />
                  <input 
                    type="text" 
                    value={localProduct.link}
                    onChange={(e) => handleLocalUpdate({ link: e.target.value })}
                    className={cn(
                      "w-full text-sm p-4 pl-12 border rounded-xl font-medium bg-slate-50 focus:ring-1 focus:ring-blue-400 outline-none transition-all truncate",
                      !isAffiliateLink(localProduct.link, resolveProductMarketplace(localProduct).id)
                        ? "border-yellow-200 text-slate-600"
                        : "border-green-200 text-green-700 font-bold"
                    )}
                  />
                  {(!isAffiliateLink(localProduct.link, resolveProductMarketplace(localProduct).id)) && (
                    <div className="absolute right-3 top-3.5 flex items-center gap-1 text-[9px] font-black bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full uppercase">
                      <Info size={10} /> Link Comum
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-6 flex gap-4 border-t border-slate-100">
                <button 
                  onClick={handleDownloadImage}
                  className="flex-1 flex flex-col items-center gap-1.5 p-4 border border-slate-200 rounded-xl hover:bg-slate-50 transition-all group"
                >
                  <ImageIcon size={20} className="text-slate-400 group-hover:text-blue-500" />
                  <span className="text-[10px] font-black uppercase text-slate-400 group-hover:text-slate-900 leading-tight text-center">Baixar Imagem</span>
                </button>
                <button 
                  onClick={copyImageToClipboard}
                  className="flex-1 flex flex-col items-center gap-1.5 p-4 border border-slate-200 rounded-xl hover:bg-slate-50 transition-all group"
                >
                  <Copy size={20} className="text-slate-400 group-hover:text-blue-500" />
                  <span className="text-[10px] font-black uppercase text-slate-400 group-hover:text-slate-900 leading-tight text-center">Copiar Imagem</span>
                </button>
                <button 
                  onClick={handleCopy}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-1.5 p-4 border rounded-xl transition-all group",
                    isCopied ? "bg-blue-50 border-blue-200" : "border-slate-200 hover:bg-slate-50"
                  )}
                >
                  {isCopied ? <Check size={20} className="text-blue-600" /> : <Copy size={20} className="text-slate-400 group-hover:text-blue-500" />}
                  <span className={cn("text-[10px] font-black uppercase leading-tight text-center", isCopied ? "text-blue-600" : "text-slate-400 group-hover:text-slate-900")}>
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
        <section className={cn(
          "col-span-12 min-h-0 flex-col items-center overflow-y-auto bg-slate-200 p-5 lg:col-span-4 lg:flex lg:p-8 custom-scrollbar",
          activeWorkspace === 'preview' ? "flex" : "hidden"
        )} aria-label="Prévia do anúncio no WhatsApp">
          <div className="mb-5 flex w-full max-w-[380px] items-center justify-between lg:hidden">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Etapa 3</p>
              <h2 className="text-xl font-black text-slate-950">Prévia no WhatsApp</h2>
            </div>
            <button type="button" onClick={() => setActiveWorkspace('editor')} className="rounded-xl bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm">Voltar ao editor</button>
          </div>
          <div className="relative my-auto flex h-[600px] w-full max-w-[340px] flex-col overflow-hidden rounded-[40px] border-[10px] border-slate-900 bg-[#E5DDD5] shadow-2xl">
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
              {localProduct ? (
                <div className={cn(
                  "p-2 animate-in fade-in slide-in-from-bottom-4 duration-300 transition-all relative overflow-hidden",
                  globalSettings.cardStyle === 'classic' && "rounded-lg shadow-sm border border-slate-200",
                  globalSettings.cardStyle === 'modern' && "rounded-2xl rounded-tl-none shadow-md border-b-2",
                  globalSettings.cardStyle === 'soft' && "rounded-[32px] shadow-xl border border-slate-100",
                  globalSettings.cardStyle === 'glass' && "rounded-2xl border border-white/60 bg-white/90 backdrop-blur-md shadow-lg",
                  
                  // Color accents
                  globalSettings.themeColor === 'blue' && (globalSettings.cardStyle === 'modern' ? "border-blue-500" : ""),
                  globalSettings.themeColor === 'emerald' && (globalSettings.cardStyle === 'modern' ? "border-emerald-500" : ""),
                  globalSettings.themeColor === 'pink' && (globalSettings.cardStyle === 'modern' ? "border-pink-500" : ""),
                  globalSettings.themeColor === 'orange' && (globalSettings.cardStyle === 'modern' ? "border-orange-500" : ""),
                  globalSettings.themeColor === 'indigo' && (globalSettings.cardStyle === 'modern' ? "border-indigo-500" : ""),
                  globalSettings.themeColor === 'slate' && (globalSettings.cardStyle === 'modern' ? "border-slate-800" : ""),

                  // Highlight styling
                  localProduct.isHighlight ? "bg-yellow-50 ring-2 ring-yellow-400 ring-offset-0 scale-[1.02] shadow-yellow-200" : "bg-white"
                )}>
                  {localProduct.isHighlight && (
                    <div className="absolute top-0 right-0 bg-yellow-400 px-3 py-1 rounded-bl-xl z-20 shadow-md flex items-center gap-1.5 animate-bounce">
                      <PartyPopper size={12} className="text-slate-900" />
                      <p className="text-[9px] font-black text-slate-900 uppercase tracking-widest italic flex items-center gap-1">
                        Super Oferta
                      </p>
                      <PartyPopper size={12} className="text-slate-900 -scale-x-100" />
                    </div>
                  )}
                  {localProduct.image ? (
                    <div className={cn(
                      "w-full aspect-square bg-slate-50 mb-3 overflow-hidden border border-slate-100 flex items-center justify-center p-2 transition-all",
                      globalSettings.cardStyle === 'classic' && "rounded-md",
                      globalSettings.cardStyle === 'modern' && "rounded-xl",
                      globalSettings.cardStyle === 'soft' && "rounded-[24px]",
                      globalSettings.cardStyle === 'glass' && "rounded-xl"
                    )}>
                       <img src={localProduct.image} className="w-full h-full object-contain" alt={localProduct.title} />
                    </div>
                  ) : (
                    <div className="w-full aspect-square bg-slate-50 rounded-xl mb-3 border border-dashed border-slate-200 flex items-center justify-center">
                       <ImageIcon size={32} className="text-slate-300" />
                    </div>
                  )}
                  <div className="p-1 space-y-1 text-slate-800 leading-tight">
                    <p className="text-[13px] font-bold">
                      {globalSettings.showEmojiTitle ? globalSettings.emojiTitle + ' ' : ''}
                      {localProduct.title}
                    </p>
                    <p className="text-[12px] italic text-slate-400 font-serif">Site Oficial {localProduct.store || resolveProductMarketplace(localProduct).name}</p>
                    {localProduct.originalPrice && (
                      <p className="text-[12px] text-slate-400">
                        {globalSettings.showEmojiPriceOriginal ? globalSettings.emojiPriceOriginal + ' ' : ''}
                        {getEffectiveLabel(localProduct.labelOriginalPrice, globalSettings.labelOriginalPrice)} <span className="line-through">{localProduct.originalPrice.startsWith('R$') ? localProduct.originalPrice : `R$ ${localProduct.originalPrice}`}</span>
                      </p>
                    )}
                    <div className="h-2" />
                    <p className="text-[13px]">
                      {globalSettings.showEmojiPrice ? globalSettings.emojiPrice + ' ' : ''}
                      {getEffectiveLabel(localProduct.labelPrice, globalSettings.labelPrice)} <span className="font-bold">{parseCurrencyValue(localProduct.price) ? (localProduct.price.startsWith('R$') ? localProduct.price : `R$ ${localProduct.price}`) : 'Informe o preço'}</span>
                    </p>
                    {localProduct.coupon && (
                      <p className="text-[13px]">
                        {globalSettings.showEmojiCoupon ? globalSettings.emojiCoupon + ' ' : ''}
                        {getEffectiveLabel(localProduct.labelCoupon, globalSettings.labelCoupon)} <span className={cn(
                          "font-bold underline decoration-2",
                          globalSettings.themeColor === 'blue' && "decoration-blue-400",
                          globalSettings.themeColor === 'emerald' && "decoration-emerald-400",
                          globalSettings.themeColor === 'pink' && "decoration-pink-400",
                          globalSettings.themeColor === 'orange' && "decoration-orange-400",
                          globalSettings.themeColor === 'indigo' && "decoration-indigo-400",
                          globalSettings.themeColor === 'slate' && "decoration-slate-400"
                        )}>{localProduct.coupon}</span>
                      </p>
                    )}
                    {localProduct.link && (
                      <>
                        <div className="h-2" />
                        <p className={cn(
                          "text-[13px] underline truncate",
                          globalSettings.themeColor === 'blue' && "text-blue-600",
                          globalSettings.themeColor === 'emerald' && "text-emerald-600",
                          globalSettings.themeColor === 'pink' && "text-pink-600",
                          globalSettings.themeColor === 'orange' && "text-orange-600",
                          globalSettings.themeColor === 'indigo' && "text-indigo-600",
                          globalSettings.themeColor === 'slate' && "text-slate-800"
                        )}>
                          {globalSettings.showEmojiGroup ? globalSettings.emojiGroup + ' ' : ''}
                          {localProduct.link}
                        </p>
                      </>
                    )}
                    <div className="h-3" />
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-tighter">{getEffectiveLabel(localProduct.labelGroupLink, globalSettings.labelGroupLink)}</p>
                    <p className={cn(
                      "text-[11px] underline truncate",
                      globalSettings.themeColor === 'blue' && "text-blue-600",
                      globalSettings.themeColor === 'emerald' && "text-emerald-600",
                      globalSettings.themeColor === 'pink' && "text-pink-600",
                      globalSettings.themeColor === 'orange' && "text-orange-600",
                      globalSettings.themeColor === 'indigo' && "text-indigo-600",
                      globalSettings.themeColor === 'slate' && "text-slate-800"
                    )}>{localProduct.groupLink}</p>
                  </div>
                  <div className="flex justify-end gap-1.5 mt-1 pr-1 items-center">
                    <span className="text-[10px] text-slate-400 font-bold">14:32</span>
                    <div className={cn(
                      "flex -space-x-1 scale-75 origin-right",
                      globalSettings.themeColor === 'blue' && "text-blue-400",
                      globalSettings.themeColor === 'emerald' && "text-emerald-400",
                      globalSettings.themeColor === 'pink' && "text-pink-400",
                      globalSettings.themeColor === 'orange' && "text-orange-400",
                      globalSettings.themeColor === 'indigo' && "text-indigo-400",
                      globalSettings.themeColor === 'slate' && "text-slate-500"
                    )}>
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
      <footer className="relative z-50 hidden items-center justify-between border-t border-slate-200 bg-white px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-500 sm:flex">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span> Sistema Pronto
          </span>
          <span className="hidden sm:inline">Marketplaces: <b className="text-slate-800">4 ativos</b></span>
          <span className="hidden lg:inline">Usuário: <b className="text-blue-600 lowercase">{user.email}</b></span>
        </div>
        <div className="flex gap-4">
          <span>v3.0.0 (Multi Marketplace)</span>
        </div>
      </footer>

      {/* Global CSS for scrollbar */}
      <style>{`
        .app-shell [class~="text-[8px]"] { font-size: 0.625rem !important; line-height: 1.35 !important; }
        .app-shell [class~="text-[9px]"] { font-size: 0.6875rem !important; line-height: 1.4 !important; }
        .app-shell [class~="text-[10px]"] { font-size: 0.75rem !important; line-height: 1.45 !important; }
        .app-shell [class~="text-[11px]"] { font-size: 0.8125rem !important; line-height: 1.45 !important; }
        .app-shell input,
        .app-shell textarea,
        .app-shell select { font-size: 0.875rem !important; }
        .app-shell button:focus-visible,
        .app-shell a:focus-visible,
        .login-shell button:focus-visible {
          outline: 3px solid #60a5fa;
          outline-offset: 2px;
        }
        .step-number {
          display: inline-flex;
          width: 1.75rem;
          height: 1.75rem;
          flex: 0 0 1.75rem;
          align-items: center;
          justify-content: center;
          border-radius: 9999px;
          background: #fbbf24;
          color: #0f172a;
          font-size: 0.75rem;
          font-weight: 900;
        }
        @media (max-width: 1023px) {
          .app-shell main > section { min-height: calc(100vh - 138px); }
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 7px;
          height: 7px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #cbd5e1;
        }
      `}</style>
    </div>
  );
}
