import { isServer } from './is-server';

export interface CopyImageResult {
  skippedImages: number;
  skippedBackgrounds: number;
  format: 'png' | 'svg';
}

export interface CopyImageOptions {
  backgroundColor?: string;
  pixelRatio?: number;
  skipDataAttribute?: string;
  preferredWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}

const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const IMAGE_PROXY_ENDPOINT = '/api/images/proxy';
const URL_FUNCTION_REGEX = /url\(("|'|)([^"')]+)\1\)/gi;
const GOOGLE_DOMAIN_REGEX = /(google|gstatic|googleapis|googleusercontent|googletag|doubleclick)\./i;
const XLINK_NS = 'http://www.w3.org/1999/xlink';

interface ClipboardItemLike {
  readonly types: readonly string[];
  getType(type: string): Promise<Blob>;
}

type ClipboardItemConstructor = new (items: Record<string, Blob>) => ClipboardItemLike;

interface Counters {
  images: number;
  backgrounds: number;
}

let cachedCssText: string | null = null;
const imageDataUrlCache = new Map<string, string | null>();
const imageDataUrlPending = new Map<string, Promise<string | null>>();

function getWindow(): Window {
  if (typeof window === 'undefined') {
    throw new Error('Element capture utilities can only run in a browser.');
  }
  return window;
}

function extractUrls(value: string): string[] {
  const urls: string[] = [];
  URL_FUNCTION_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_FUNCTION_REGEX.exec(value)) !== null) {
    urls.push(match[2]);
  }
  return urls;
}

function isDataUrl(url: string | null | undefined): boolean {
  return !!url && url.startsWith('data:');
}

function isProbablyExternal(url: string | null | undefined): boolean {
  if (!url || url === 'none' || isDataUrl(url) || url.startsWith('#')) {
    return false;
  }

  try {
    const win = getWindow();
    const parsed = new URL(url, win.location.href);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (parsed.origin !== win.location.origin) {
        return true;
      }
      return GOOGLE_DOMAIN_REGEX.test(parsed.hostname);
    }
    return true;
  } catch {
    return true;
  }
}

function shouldSkipNode(node: Element, skipAttr?: string | null): boolean {
  if (skipAttr && node.hasAttribute(skipAttr)) {
    return true;
  }
  const tag = node.tagName.toLowerCase();
  return tag === 'script' || tag === 'iframe';
}

function copyBasicBoxModel(original: Element, target: HTMLElement): void {
  const win = getWindow();
  const style = win.getComputedStyle(original);
  const props = [
    'display',
    'position',
    'top',
    'right',
    'bottom',
    'left',
    'margin',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'padding',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'border',
    'border-radius',
    'box-sizing',
    'width',
    'height',
    'min-width',
    'min-height',
    'max-width',
    'max-height',
  ];

  props.forEach((prop) => {
    const value = style.getPropertyValue(prop);
    if (value) {
      target.style.setProperty(prop, value);
    }
  });
}

function createPlaceholder(original: Element): HTMLElement {
  const win = getWindow();
  const placeholder = win.document.createElement('div');
  copyBasicBoxModel(original, placeholder);
  placeholder.style.backgroundColor = 'transparent';
  placeholder.style.backgroundImage = 'none';
  placeholder.style.display = placeholder.style.display || 'block';
  return placeholder;
}

function sanitizeBackground(
  original: Element,
  clone: Element,
  counters: Counters,
  tasks: Promise<void>[],
): void {
  if (!('style' in clone)) {
    return;
  }

  const win = getWindow();
  const computed = win.getComputedStyle(original);
  const backgroundImage = computed.backgroundImage;
  if (!backgroundImage || backgroundImage === 'none') {
    return;
  }

  const urls = extractUrls(backgroundImage);
  if (urls.length === 0) {
    return;
  }

  const externalUrls = urls.filter((url) => isProbablyExternal(url));
  if (externalUrls.length === 0) {
    return;
  }

  const style = (clone as HTMLElement | SVGElement).style;
  const fallbackColor = computed.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)'
    ? computed.backgroundColor
    : 'transparent';

  const task = (async () => {
    const uniqueUrls = Array.from(new Set(externalUrls));
    const results = await Promise.all(
      uniqueUrls.map(async (url) => ({ url, dataUrl: await fetchImageAsDataUrl(url) })),
    );

    const failed = results.filter((result) => !result.dataUrl);
    if (failed.length === 0) {
      const replacements = new Map(results.map((result) => [result.url, result.dataUrl!]));
      const replaceWithInlineData = (value: string): string => {
        URL_FUNCTION_REGEX.lastIndex = 0;
        return value.replace(URL_FUNCTION_REGEX, (match, quote, url) => {
          const replacement = replacements.get(url);
          if (!replacement) {
            return match;
          }
          const q = quote || '"';
          return `url(${q}${replacement}${q})`;
        });
      };

      const sanitizedImage = replaceWithInlineData(backgroundImage);
      style.backgroundImage = sanitizedImage;

      const inlineBackground = style.background;
      if (inlineBackground) {
        style.background = replaceWithInlineData(inlineBackground);
      }

      style.backgroundColor = computed.backgroundColor || fallbackColor;
      return;
    }

    counters.backgrounds += externalUrls.length;
    style.backgroundImage = 'none';
    style.background = fallbackColor;
    style.backgroundColor = fallbackColor;
  })();

  tasks.push(task);
}

function sanitizeImage(
  original: HTMLImageElement,
  clone: HTMLImageElement,
  counters: Counters,
  tasks: Promise<void>[],
): void {
  const candidates = new Set<string>();
  if (original.currentSrc) candidates.add(original.currentSrc);
  if (original.src) candidates.add(original.src);

  const attrSrc = clone.getAttribute('src');
  if (attrSrc) candidates.add(attrSrc);
  const srcset = original.getAttribute('srcset');
  if (srcset) {
    srcset
      .split(',')
      .map((token) => token.trim().split(' ')[0])
      .filter(Boolean)
      .forEach((token) => candidates.add(token));
  }

  const hasExternal = Array.from(candidates).some((url) => isProbablyExternal(url));
  if (hasExternal) {
    const preferred = original.currentSrc || original.src || attrSrc || null;
    clone.removeAttribute('srcset');
    clone.src = TRANSPARENT_PIXEL;

    if (!preferred) {
      counters.images += 1;
      return;
    }

    const task = inlineExternalImage(preferred, clone).then((ok) => {
      if (!ok) {
        counters.images += 1;
        clone.src = TRANSPARENT_PIXEL;
      }
    });
    tasks.push(task);
    return;
  }

  clone.removeAttribute('srcset');
  const preferred = original.currentSrc || original.src || attrSrc;
  if (preferred) {
    clone.src = preferred;
  }
  clone.crossOrigin = 'anonymous';
}

async function inlineExternalImage(url: string, target: HTMLImageElement): Promise<boolean> {
  const dataUrl = await fetchImageAsDataUrl(url);
  if (!dataUrl) {
    return false;
  }
  target.src = dataUrl;
  target.removeAttribute('crossorigin');
  return true;
}

function toAbsoluteUrl(url: string): string {
  try {
    return new URL(url, getWindow().location.href).toString();
  } catch {
    return url;
  }
}

function isSameOrigin(url: URL): boolean {
  try {
    return url.origin === getWindow().location.origin;
  } catch {
    return false;
  }
}

async function fetchBlobAsDataUrl(url: string, init?: RequestInit): Promise<string | null> {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      mode: 'cors',
      ...init,
    });
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    if (!blob || blob.size === 0) {
      return null;
    }
    const dataUrl = await blobToDataUrl(blob);
    return dataUrl || null;
  } catch {
    return null;
  }
}

function buildProxyUrl(url: string): string {
  const win = getWindow();
  const proxy = new URL(IMAGE_PROXY_ENDPOINT, win.location.origin);
  proxy.searchParams.set('url', url);
  return proxy.toString();
}

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  const absoluteUrl = toAbsoluteUrl(url);

  if (imageDataUrlCache.has(absoluteUrl)) {
    return imageDataUrlCache.get(absoluteUrl) ?? null;
  }

  let pending = imageDataUrlPending.get(absoluteUrl);
  if (!pending) {
    pending = (async () => {
      const targetUrl = new URL(absoluteUrl);
      const includeCredentials = isSameOrigin(targetUrl);

      const direct = await fetchBlobAsDataUrl(targetUrl.toString(), {
        credentials: includeCredentials ? 'include' : 'omit',
      });
      if (direct) {
        return direct;
      }
      if (targetUrl.pathname.startsWith(IMAGE_PROXY_ENDPOINT)) {
        return null;
      }

      const proxied = await fetchBlobAsDataUrl(buildProxyUrl(targetUrl.toString()));
      if (proxied) {
        return proxied;
      }

      return null;
    })();
    imageDataUrlPending.set(absoluteUrl, pending);
  }

  const result = await pending;
  imageDataUrlPending.delete(absoluteUrl);
  imageDataUrlCache.set(absoluteUrl, result ?? null);
  return result ?? null;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        resolve('');
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function replaceCanvas(
  original: HTMLCanvasElement,
  clone: HTMLCanvasElement,
  counters: Counters,
): Promise<void> {
  const win = getWindow();
  try {
    const dataUrl = original.toDataURL('image/png');
    if (!dataUrl || dataUrl === 'data:,') {
      throw new Error('empty canvas');
    }
    const img = win.document.createElement('img');
    img.src = dataUrl;
    copyBasicBoxModel(original, img);
    clone.replaceWith(img);
  } catch {
    counters.images += 1;
    const placeholder = createPlaceholder(original);
    clone.replaceWith(placeholder);
  }
}

async function replaceVideo(
  original: HTMLVideoElement,
  clone: HTMLVideoElement,
  counters: Counters,
): Promise<void> {
  const win = getWindow();
  let dataUrl: string | null = null;

  try {
    if (original.readyState >= 2 && original.videoWidth > 0 && original.videoHeight > 0) {
      const canvas = win.document.createElement('canvas');
      canvas.width = original.videoWidth;
      canvas.height = original.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(original, 0, 0, original.videoWidth, original.videoHeight);
        dataUrl = canvas.toDataURL('image/png');
      }
    }
  } catch {
    dataUrl = null;
  }

  if (!dataUrl && original.poster && !isProbablyExternal(original.poster)) {
    try {
      const response = await fetch(original.poster, { mode: 'cors' });
      if (response.ok) {
        const blob = await response.blob();
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      }
    } catch {
      dataUrl = null;
    }
  }

  if (dataUrl) {
    const img = win.document.createElement('img');
    img.src = dataUrl;
    copyBasicBoxModel(original, img);
    clone.replaceWith(img);
    return;
  }

  counters.images += 1;
  const placeholder = createPlaceholder(original);
  clone.replaceWith(placeholder);
}

async function prepareClone(
  element: HTMLElement,
  options: CopyImageOptions,
): Promise<{ clone: HTMLElement; counters: Counters }> {
  const clone = element.cloneNode(true) as HTMLElement;
  const counters: Counters = { images: 0, backgrounds: 0 };
  const queue: Array<{ original: Element; clone: Element }> = [{ original: element, clone }];
  const tasks: Promise<void>[] = [];
  const skipAttr = options.skipDataAttribute ?? null;

  while (queue.length > 0) {
    const { original, clone: current } = queue.shift()!;

    if (shouldSkipNode(original, skipAttr)) {
      current.remove();
      continue;
    }

    sanitizeBackground(original, current, counters, tasks);

    if (original instanceof HTMLImageElement && current instanceof HTMLImageElement) {
      sanitizeImage(original, current, counters, tasks);
    } else if (original instanceof HTMLCanvasElement && current instanceof HTMLCanvasElement) {
      tasks.push(replaceCanvas(original, current, counters));
      continue;
    } else if (original instanceof HTMLVideoElement && current instanceof HTMLVideoElement) {
      tasks.push(replaceVideo(original, current, counters));
      continue;
    } else if (original instanceof SVGImageElement && current instanceof SVGImageElement) {
      const href = original.href.baseVal || original.getAttributeNS(XLINK_NS, 'href');
      if (isProbablyExternal(href)) {
        counters.images += 1;
        current.removeAttribute('href');
        current.removeAttributeNS(XLINK_NS, 'href');
      }
    }

    const originalChildren = Array.from(original.children);
    const cloneChildren = Array.from(current.children);
    for (let i = 0; i < cloneChildren.length; i += 1) {
      const originalChild = originalChildren[i];
      const cloneChild = cloneChildren[i];
      if (originalChild && cloneChild) {
        queue.push({ original: originalChild, clone: cloneChild });
      }
    }
  }

  await Promise.all(tasks);

  return { clone, counters };
}

function resolveBackgroundColor(element: HTMLElement): string {
  const win = getWindow();
  let current: HTMLElement | null = element;
  while (current) {
    const color = win.getComputedStyle(current).backgroundColor;
    if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
      return color;
    }
    current = current.parentElement;
  }

  const doc = win.document.documentElement;
  const docColor = win.getComputedStyle(doc).backgroundColor;
  if (docColor && docColor !== 'rgba(0, 0, 0, 0)' && docColor !== 'transparent') {
    return docColor;
  }

  const bodyColor = win.getComputedStyle(win.document.body).backgroundColor;
  if (bodyColor && bodyColor !== 'rgba(0, 0, 0, 0)' && bodyColor !== 'transparent') {
    return bodyColor;
  }

  return '#ffffff';
}

function resolveTargetWidth(element: HTMLElement, options: CopyImageOptions): number {
  const rect = element.getBoundingClientRect();
  const fallbackWidth = rect.width || element.offsetWidth || element.scrollWidth || 0;
  let targetWidth = fallbackWidth;

  if (options.preferredWidth && options.preferredWidth > targetWidth) {
    targetWidth = options.preferredWidth;
  }

  if (options.minWidth && options.minWidth > targetWidth) {
    targetWidth = options.minWidth;
  }

  if (options.maxWidth && targetWidth > options.maxWidth) {
    targetWidth = options.maxWidth;
  }

  return Math.max(1, Math.round(targetWidth || 1));
}

function layoutClone(
  element: HTMLElement,
  clone: HTMLElement,
  options: CopyImageOptions,
): { width: number; height: number } {
  const win = getWindow();
  const host = win.document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '0';
  host.style.visibility = 'hidden';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '-1';
  host.style.width = 'auto';
  host.style.height = 'auto';
  host.style.maxWidth = 'none';
  host.style.maxHeight = 'none';
  host.style.overflow = 'visible';

  const targetWidth = resolveTargetWidth(element, options);
  const originalRect = element.getBoundingClientRect();
  const enlarge = targetWidth > Math.round(originalRect.width || 0);

  clone.style.boxSizing = 'border-box';
  clone.style.width = `${targetWidth}px`;
  clone.style.height = 'auto';
  clone.style.maxHeight = 'none';
  clone.style.position = 'static';

  if (enlarge) {
    clone.style.minWidth = `${targetWidth}px`;
    clone.style.maxWidth = `${targetWidth}px`;
  } else {
    clone.style.minWidth = '';
    clone.style.maxWidth = '';
  }

  host.appendChild(clone);
  win.document.body.appendChild(host);

  let width = 1;
  let height = 1;

  try {
    const measuredRect = clone.getBoundingClientRect();
    width = Math.max(1, Math.round(measuredRect.width));
    height = Math.max(1, Math.round(measuredRect.height));
  } finally {
    if (host.contains(clone)) {
      host.removeChild(clone);
    }
    if (host.parentNode) {
      host.parentNode.removeChild(host);
    }
  }

  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.minWidth = '';
  clone.style.maxWidth = '';
  clone.style.position = '';

  return { width, height };
}

function getCombinedCssText(): string {
  if (cachedCssText != null) {
    return cachedCssText;
  }
  const win = getWindow();
  const cssPieces: string[] = [];
  const sheets = Array.from(win.document.styleSheets) as CSSStyleSheet[];
  sheets.forEach((sheet) => {
    try {
      const rules = sheet.cssRules;
      if (!rules) return;
      for (let i = 0; i < rules.length; i += 1) {
        cssPieces.push(rules[i].cssText);
      }
    } catch {
      /* ignore cross-origin styles */
    }
  });
  cachedCssText = cssPieces.join('\n');
  return cachedCssText;
}

function serializeCloneToSvg(
  node: HTMLElement,
  width: number,
  height: number,
  backgroundColor: string,
): string {
  const serializer = new XMLSerializer();
  const prepared = node.cloneNode(true) as HTMLElement;
  prepared.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  prepared.style.width = `${width}px`;
  prepared.style.height = `${height}px`;
  const serialized = serializer.serializeToString(prepared);
  const cssText = getCombinedCssText();
  const styleBlock = cssText
    ? `<style xmlns="http://www.w3.org/1999/xhtml"><![CDATA[${cssText}]]></style>`
    : '';
  const bgRect = backgroundColor
    ? `<rect width="100%" height="100%" fill="${backgroundColor}" />`
    : '';
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xhtml="http://www.w3.org/1999/xhtml"` +
    ` width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `${bgRect}<foreignObject x="0" y="0" width="${width}" height="${height}" requiredExtensions="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;">` +
    `${styleBlock}${serialized}</foreignObject></svg>`
  );
}

function isCanvasBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return true;
  }
  try {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < imageData.data.length; i += 4) {
      if (imageData.data[i] !== 0) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось отрисовать изображение'));
    img.src = url;
  });
}

async function rasterizeSvg(
  svgText: string,
  width: number,
  height: number,
  pixelRatio: number,
  backgroundColor: string,
): Promise<HTMLCanvasElement> {
  const win = getWindow();
  const canvas = win.document.createElement('canvas');
  const scaledWidth = Math.max(1, Math.round(width * pixelRatio));
  const scaledHeight = Math.max(1, Math.round(height * pixelRatio));
  canvas.width = scaledWidth;
  canvas.height = scaledHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Не удалось создать контекст рисования');
  }

  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;

  const attemptBitmap = async (): Promise<boolean> => {
    if (typeof createImageBitmap !== 'function') {
      return false;
    }
    try {
      const bitmap = await createImageBitmap(blob);
      ctx.clearRect(0, 0, scaledWidth, scaledHeight);
      ctx.drawImage(bitmap, 0, 0, scaledWidth, scaledHeight);
      bitmap.close();
      return !isCanvasBlank(canvas);
    } catch {
      return false;
    }
  };

  let rendered = await attemptBitmap();
  if (!rendered) {
    const img = await loadImage(dataUrl);
    ctx.clearRect(0, 0, scaledWidth, scaledHeight);
    ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);
    rendered = !isCanvasBlank(canvas);
    if (!rendered) {
      throw new Error('Получилось пустое изображение после рендеринга');
    }
  }

  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, scaledWidth, scaledHeight);
  ctx.globalCompositeOperation = 'source-over';

  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Не удалось создать изображение'));
      }
    }, 'image/png', 0.95);
  });
}

function getClipboardItemConstructor(): ClipboardItemConstructor | undefined {
  if (typeof globalThis === 'undefined') {
    return undefined;
  }
  const candidate = (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
  return typeof candidate === 'function' ? (candidate as ClipboardItemConstructor) : undefined;
}

async function writeBlobToClipboard(blob: Blob): Promise<void> {
  const win = getWindow();
  const nav = win.navigator;
  const clipboard = nav.clipboard;
  if (!clipboard || typeof clipboard.write !== 'function') {
    throw new Error('Буфер обмена недоступен в этом браузере');
  }
  const ClipboardItemCtor = getClipboardItemConstructor();
  if (!ClipboardItemCtor) {
    throw new Error('Браузер не поддерживает сохранение изображений в буфер обмена');
  }
  const item = new ClipboardItemCtor({ [blob.type]: blob });
  const write = clipboard.write.bind(clipboard) as unknown as (
    items: ClipboardItemLike[],
  ) => Promise<void>;
  await write([item]);
}

async function writeSvgToClipboard(svgText: string): Promise<void> {
  const win = getWindow();
  const nav = win.navigator;
  const clipboard = nav.clipboard;
  if (!clipboard || typeof clipboard.write !== 'function') {
    throw new Error('Буфер обмена недоступен в этом браузере');
  }
  const ClipboardItemCtor = getClipboardItemConstructor();
  if (!ClipboardItemCtor) {
    throw new Error('Браузер не поддерживает сохранение изображений в буфер обмена');
  }
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const item = new ClipboardItemCtor({ 'image/svg+xml': blob });
  const write = clipboard.write.bind(clipboard) as unknown as (
    items: ClipboardItemLike[],
  ) => Promise<void>;
  await write([item]);
}

function isSecurityError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'SecurityError' || error.message.includes('Tainted canvases may not be exported'))
  );
}

export async function copyElementImageToClipboard(
  element: HTMLElement,
  options: CopyImageOptions = {},
): Promise<CopyImageResult> {
  if (isServer()) {
    throw new Error('Невозможно сделать снимок на сервере');
  }

  const { clone, counters } = await prepareClone(element, options);
  const { width, height } = layoutClone(element, clone, options);

  const pixelRatio = options.pixelRatio ?? getWindow().devicePixelRatio ?? 1;
  const backgroundColor = options.backgroundColor ?? resolveBackgroundColor(element);

  const svgText = serializeCloneToSvg(clone, width, height, backgroundColor);

  try {
    const canvas = await rasterizeSvg(svgText, width, height, pixelRatio, backgroundColor);
    const blob = await canvasToBlob(canvas);
    await writeBlobToClipboard(blob);
    return { skippedImages: counters.images, skippedBackgrounds: counters.backgrounds, format: 'png' };
  } catch (error) {
    if (!isSecurityError(error) && !(error instanceof Error && /пустое изображение/i.test(error.message))) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    await writeSvgToClipboard(svgText);
    return { skippedImages: counters.images, skippedBackgrounds: counters.backgrounds, format: 'svg' };
  }
}
