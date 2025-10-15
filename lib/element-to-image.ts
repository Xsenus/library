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
}

const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const URL_FUNCTION_REGEX = /url\(("|'|)([^"')]+)\1\)/gi;
const GOOGLE_DOMAIN_REGEX = /(google|gstatic|googleapis|googleusercontent|googletag|doubleclick)\./i;
const SAFE_FONT_STACK = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const URL_BASED_STYLE_PROPS: Array<keyof CSSStyleDeclaration> = [
  'borderImage',
  'borderImageSource',
  'mask',
  'maskImage',
  'maskBorder',
  'maskBorderSource',
  'maskComposite',
  'listStyleImage',
  'cursor',
  'filter',
  'clipPath',
  'shapeOutside',
  'shapeImageThreshold',
];

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Не удалось прочитать данные изображения'));
    reader.readAsDataURL(blob);
  });
}

async function fetchAsDataUrl(
  url: string,
  cache: Map<string, Promise<string>>,
): Promise<string> {
  const win = getWindow();
  const absolute = new URL(url, win.location.href).toString();
  if (!cache.has(absolute)) {
    cache.set(
      absolute,
      (async () => {
        const response = await fetch(absolute, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error(`Не удалось загрузить ресурс (${response.status})`);
        }
        const blob = await response.blob();
        return blobToDataUrl(blob);
      })(),
    );
  }
  return cache.get(absolute)!;
}

type SanitizeResult = {
  node: HTMLElement;
  skippedImages: number;
  skippedBackgrounds: number;
  width: number;
  height: number;
};

type Counters = {
  images: number;
  backgrounds: number;
};

function measureElementDimensions(element: HTMLElement, win: Window): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  let width = rect.width;
  let height = rect.height;

  if (width === 0 || height === 0) {
    const computed = win.getComputedStyle(element);
    const parsedWidth = parseFloat(computed.width || '0');
    const parsedHeight = parseFloat(computed.height || '0');
    const fallbackWidths = [width, element.offsetWidth, element.clientWidth, element.scrollWidth, parsedWidth].filter(
      (value) => typeof value === 'number' && !Number.isNaN(value),
    ) as number[];
    const fallbackHeights = [
      height,
      element.offsetHeight,
      element.clientHeight,
      element.scrollHeight,
      parsedHeight,
    ].filter((value) => typeof value === 'number' && !Number.isNaN(value)) as number[];

    if (fallbackWidths.length > 0) {
      width = Math.max(...fallbackWidths);
    }
    if (fallbackHeights.length > 0) {
      height = Math.max(...fallbackHeights);
    }
  }

  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

function isTransparentColor(color: string | null | undefined): boolean {
  if (!color) return true;
  const normalized = color.trim().toLowerCase();
  if (normalized === 'transparent') return true;
  if (normalized === 'rgba(0, 0, 0, 0)' || normalized === 'rgba(0,0,0,0)') {
    return true;
  }
  if (normalized === 'rgb(0 0 0 / 0)' || normalized === 'rgba(255, 255, 255, 0)') {
    return true;
  }
  if (normalized.startsWith('rgba')) {
    const alpha = normalized.substring(normalized.lastIndexOf(',') + 1).replace(')', '').trim();
    if (parseFloat(alpha) === 0) {
      return true;
    }
  }
  if (normalized.startsWith('hsla')) {
    const alpha = normalized.substring(normalized.lastIndexOf(',') + 1).replace(')', '').trim();
    if (parseFloat(alpha) === 0) {
      return true;
    }
  }
  if (/\/\s*0(?:\.0+)?\)/.test(normalized)) {
    return true;
  }
  return false;
}

function resolveBackgroundColor(element: HTMLElement): string {
  const win = getWindow();
  let current: HTMLElement | null = element;
  while (current) {
    const color = win.getComputedStyle(current).backgroundColor;
    if (!isTransparentColor(color)) {
      return color;
    }
    current = current.parentElement;
  }

  const doc = win.document.documentElement;
  const docColor = win.getComputedStyle(doc).backgroundColor;
  if (!isTransparentColor(docColor)) {
    return docColor;
  }

  const bodyColor = win.getComputedStyle(win.document.body).backgroundColor;
  if (!isTransparentColor(bodyColor)) {
    return bodyColor;
  }

  return '#ffffff';
}

function getWindow(): Window {
  if (typeof window === 'undefined') {
    throw new Error('Element capture utilities can only run in a browser.');
  }
  return window;
}

function isDataUrl(url: string | null | undefined): boolean {
  return !!url && url.startsWith('data:');
}

function isProbablyExternal(url: string | null | undefined): boolean {
  if (!url || url === 'none') return false;
  if (isDataUrl(url) || url.startsWith('#')) return false;

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

function extractUrls(value: string): string[] {
  const urls: string[] = [];
  URL_FUNCTION_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_FUNCTION_REGEX.exec(value)) !== null) {
    urls.push(match[2]);
  }
  return urls;
}

function sanitizeExternalAttributes(element: Element): void {
  const attributes = Array.from(element.attributes);
  attributes.forEach((attr) => {
    const name = attr.name;
    const lowerName = name.toLowerCase();
    const value = attr.value;

    if (!value) return;
    if (lowerName === 'style' || lowerName === 'class' || lowerName === 'id') return;
    if (lowerName.startsWith('aria-')) return;
    if (lowerName.startsWith('data-')) return;
    if (lowerName === 'xmlns' || lowerName.startsWith('xmlns:') || lowerName.startsWith('xml:')) return;

    if (lowerName === 'srcset') {
      const tokens = value
        .split(',')
        .map((token) => token.trim().split(' ')[0])
        .filter(Boolean);
      if (tokens.some((token) => isProbablyExternal(token))) {
        element.removeAttribute(name);
      }
      return;
    }

    if (
      lowerName === 'href' ||
      lowerName === 'xlink:href' ||
      lowerName === 'src' ||
      lowerName === 'poster' ||
      lowerName === 'action' ||
      lowerName === 'formaction' ||
      lowerName === 'data'
    ) {
      if (!isProbablyExternal(value)) {
        return;
      }

      if (lowerName === 'href' || lowerName === 'xlink:href') {
        element.setAttribute(name, '#');
        if (lowerName === 'xlink:href') {
          element.setAttributeNS(XLINK_NS, 'href', '#');
        }
      } else if (lowerName === 'src' && element instanceof HTMLImageElement) {
        element.setAttribute(name, TRANSPARENT_PIXEL);
      } else {
        element.removeAttribute(name);
      }
      return;
    }

    if (/https?:/i.test(value) || value.startsWith('//')) {
      element.removeAttribute(name);
    }
  });
}

function gatherImageUrls(img: HTMLImageElement): string[] {
  const urls = new Set<string>();
  if (img.currentSrc) urls.add(img.currentSrc);
  if (img.src) urls.add(img.src);
  const src = img.getAttribute('src');
  if (src) urls.add(src);
  const srcset = img.getAttribute('srcset');
  if (srcset) {
    srcset
      .split(',')
      .map((token) => token.trim().split(' ')[0])
      .filter(Boolean)
      .forEach((token) => urls.add(token));
  }
  return Array.from(urls);
}

function inlineComputedStyles(original: Element, clone: Element, fontStack: string): void {
  if (!('style' in clone)) {
    return;
  }
  const win = getWindow();
  const computed = win.getComputedStyle(original);
  const target = (clone as HTMLElement | SVGElement).style;
  for (let i = 0; i < computed.length; i += 1) {
    const prop = computed[i];
    target.setProperty(prop, computed.getPropertyValue(prop));
  }
  target.setProperty('font-family', fontStack);

  URL_BASED_STYLE_PROPS.forEach((prop) => {
    const current = target[prop];
    if (typeof current === 'string' && current.includes('url(')) {
      // @ts-expect-error runtime style mutation
      target[prop] = prop === 'cursor' ? 'auto' : 'none';
    }
  });
}

async function sanitizeImage(
  original: HTMLImageElement,
  clone: HTMLImageElement,
  counters: Counters,
  dataUrlCache: Map<string, Promise<string>>,
): Promise<void> {
  const urls = gatherImageUrls(original);
  if (urls.length === 0) {
    return Promise.resolve();
  }

  if (urls.some((url) => isProbablyExternal(url))) {
    counters.images += 1;
    clone.removeAttribute('srcset');
    clone.setAttribute('src', TRANSPARENT_PIXEL);
    return Promise.resolve();
  }

  const preferredUrl = original.currentSrc || original.src || urls[0];
  if (!preferredUrl) {
    return Promise.resolve();
  }

  clone.removeAttribute('srcset');
  if (isDataUrl(preferredUrl)) {
    clone.setAttribute('src', preferredUrl);
    return Promise.resolve();
  }
  return fetchAsDataUrl(preferredUrl, dataUrlCache)
    .then((dataUrl) => {
      clone.setAttribute('src', dataUrl);
    })
    .catch(() => {
      counters.images += 1;
      clone.setAttribute('src', TRANSPARENT_PIXEL);
    });
}

async function sanitizeSvgImage(
  original: SVGImageElement,
  clone: SVGImageElement,
  counters: Counters,
  dataUrlCache: Map<string, Promise<string>>,
): Promise<void> {
  const href = original.href?.baseVal || original.getAttribute('href') || original.getAttributeNS(XLINK_NS, 'href');
  if (!href) {
    return Promise.resolve();
  }

  if (isDataUrl(href)) {
    clone.setAttributeNS(XLINK_NS, 'href', href);
    clone.setAttribute('href', href);
    return Promise.resolve();
  }

  if (isProbablyExternal(href)) {
    counters.images += 1;
    clone.removeAttribute('href');
    clone.removeAttributeNS(XLINK_NS, 'href');
    return Promise.resolve();
  }

  return fetchAsDataUrl(href, dataUrlCache)
    .then((dataUrl) => {
      clone.setAttributeNS(XLINK_NS, 'href', dataUrl);
      clone.setAttribute('href', dataUrl);
    })
    .catch(() => {
      counters.images += 1;
      clone.removeAttribute('href');
      clone.removeAttributeNS(XLINK_NS, 'href');
    });
}

async function sanitizeBackground(
  original: Element,
  clone: Element,
  counters: Counters,
  dataUrlCache: Map<string, Promise<string>>,
): Promise<void> {
  const win = getWindow();
  const computed = win.getComputedStyle(original);
  const backgroundImage = computed.backgroundImage;
  if (!backgroundImage || backgroundImage === 'none') {
    return Promise.resolve();
  }

  const urls = extractUrls(backgroundImage);
  if (urls.length === 0) {
    return Promise.resolve();
  }

  const external = urls.filter((url) => isProbablyExternal(url));
  if (external.length > 0) {
    counters.backgrounds += external.length;
    if ('style' in clone && clone.style) {
      const style = (clone as HTMLElement | SVGElement).style;
      style.backgroundImage = 'none';
      const bgColor = computed.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)'
        ? computed.backgroundColor
        : 'transparent';
      style.backgroundColor = bgColor;
      style.background = bgColor;
    }
    return Promise.resolve();
  }

  if (!('style' in clone) || !clone.style) {
    return Promise.resolve();
  }

  const replacements = urls.map(async (url) => {
    if (isDataUrl(url)) {
      return { originalUrl: url, dataUrl: url };
    }
    try {
      const dataUrl = await fetchAsDataUrl(url, dataUrlCache);
      return { originalUrl: url, dataUrl };
    } catch {
      counters.backgrounds += 1;
      return { originalUrl: url, dataUrl: null };
    }
  });

  return Promise.all(replacements).then((entries) => {
    const style = (clone as HTMLElement | SVGElement).style;
    let bgValue = computed.backgroundImage;
    let shorthand = computed.background;
    const fallbackColor = computed.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)'
      ? computed.backgroundColor
      : 'transparent';

    entries.forEach(({ originalUrl, dataUrl }) => {
      if (!dataUrl) {
        bgValue = 'none';
        shorthand = fallbackColor;
        return;
      }
      const escaped = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'g');
      bgValue = bgValue.replace(regex, dataUrl);
      shorthand = shorthand.replace(regex, dataUrl);
    });

    style.backgroundImage = bgValue;
    if (shorthand.includes('url(')) {
      style.background = bgValue;
    } else {
      style.background = shorthand;
    }
  });
}

function shouldSkipNode(node: Element, skipAttr?: string | null): boolean {
  if (skipAttr && node.hasAttribute(skipAttr)) {
    return true;
  }
  const tag = node.tagName.toLowerCase();
  return tag === 'script' || tag === 'iframe';
}

function getElementRect(element: Element): DOMRect {
  const rect = element.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) {
    return rect;
  }

  if (element instanceof HTMLElement) {
    const width = element.offsetWidth || element.clientWidth;
    const height = element.offsetHeight || element.clientHeight;
    return new DOMRect(0, 0, width, height);
  }

  return rect;
}

function createTransparentPlaceholder(win: Window, rect: DOMRect): HTMLElement {
  const placeholder = win.document.createElement('div');
  placeholder.style.width = `${Math.max(1, Math.round(rect.width))}px`;
  placeholder.style.height = `${Math.max(1, Math.round(rect.height))}px`;
  placeholder.style.backgroundColor = 'transparent';
  placeholder.style.boxSizing = 'border-box';
  return placeholder;
}

async function sanitizeElement(
  root: HTMLElement,
  options: CopyImageOptions,
): Promise<SanitizeResult> {
  const clone = root.cloneNode(true) as HTMLElement;
  const counters: Counters = { images: 0, backgrounds: 0 };
  const skipAttr = options.skipDataAttribute ?? null;
  const queue: Array<{ original: Element; clone: Element }> = [{ original: root, clone }];
  const win = getWindow();
  const { width: rootWidth, height: rootHeight } = measureElementDimensions(root, win);
  const dataUrlCache = new Map<string, Promise<string>>();
  clone.style.boxSizing = 'border-box';
  clone.style.width = `${rootWidth}px`;
  clone.style.height = `${rootHeight}px`;
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');

  const asyncTasks: Promise<void>[] = [];

  while (queue.length > 0) {
    const { original, clone: current } = queue.shift()!;

    if (shouldSkipNode(original, skipAttr)) {
      current.remove();
      continue;
    }

    if (current instanceof HTMLSourceElement) {
      current.removeAttribute('srcset');
      current.removeAttribute('src');
    }

    if (original instanceof HTMLCanvasElement && current instanceof HTMLCanvasElement) {
      const rect = getElementRect(original);
      try {
        const dataUrl = original.toDataURL('image/png');
        if (!dataUrl || dataUrl === 'data:,') {
          throw new Error('empty canvas');
        }
        const img = win.document.createElement('img');
        inlineComputedStyles(original, img, SAFE_FONT_STACK);
        asyncTasks.push(sanitizeBackground(original, img, counters, dataUrlCache));
        img.src = dataUrl;
        current.replaceWith(img);
      } catch {
        const placeholder = createTransparentPlaceholder(win, rect);
        inlineComputedStyles(original, placeholder, SAFE_FONT_STACK);
        asyncTasks.push(sanitizeBackground(original, placeholder, counters, dataUrlCache));
        current.replaceWith(placeholder);
        counters.images += 1;
      }
      continue;
    }

    if (original instanceof HTMLVideoElement && current instanceof HTMLVideoElement) {
      const rect = getElementRect(original);
      const placeholder = createTransparentPlaceholder(win, rect);
      inlineComputedStyles(original, placeholder, SAFE_FONT_STACK);
      asyncTasks.push(sanitizeBackground(original, placeholder, counters, dataUrlCache));
      current.replaceWith(placeholder);

      asyncTasks.push(
        (async () => {
          let dataUrl: string | null = null;
          try {
            if (original.readyState >= 2 && original.videoWidth > 0 && original.videoHeight > 0) {
              const tempCanvas = win.document.createElement('canvas');
              tempCanvas.width = original.videoWidth;
              tempCanvas.height = original.videoHeight;
              const ctx = tempCanvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(original, 0, 0, original.videoWidth, original.videoHeight);
                dataUrl = tempCanvas.toDataURL('image/png');
              }
            }
          } catch {
            dataUrl = null;
          }

          if (!dataUrl && original.poster && !isProbablyExternal(original.poster)) {
            try {
              dataUrl = await fetchAsDataUrl(original.poster, dataUrlCache);
            } catch {
              dataUrl = null;
            }
          }

          if (dataUrl) {
            const img = win.document.createElement('img');
            inlineComputedStyles(original, img, SAFE_FONT_STACK);
            await sanitizeBackground(original, img, counters, dataUrlCache);
            img.src = dataUrl;
            placeholder.replaceWith(img);
          } else {
            counters.images += 1;
          }
        })(),
      );
      continue;
    }

    inlineComputedStyles(original, current, SAFE_FONT_STACK);
    asyncTasks.push(sanitizeBackground(original, current, counters, dataUrlCache));

    if (original instanceof HTMLImageElement && current instanceof HTMLImageElement) {
      asyncTasks.push(sanitizeImage(original, current, counters, dataUrlCache));
    }

    if (original instanceof SVGImageElement && current instanceof SVGImageElement) {
      asyncTasks.push(sanitizeSvgImage(original, current, counters, dataUrlCache));
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

  await Promise.all(asyncTasks);

  const attrQueue: Element[] = [clone];
  while (attrQueue.length > 0) {
    const current = attrQueue.shift()!;
    if (current instanceof HTMLStyleElement || current instanceof HTMLLinkElement) {
      current.remove();
      continue;
    }
    sanitizeExternalAttributes(current);
    const children = Array.from(current.children);
    children.forEach((child) => attrQueue.push(child));
  }

  return {
    node: clone,
    skippedImages: counters.images,
    skippedBackgrounds: counters.backgrounds,
    width: rootWidth,
    height: rootHeight,
  };
}

async function writeBlobToClipboard(blob: Blob): Promise<void> {
  const win = getWindow();
  const nav = win.navigator as Navigator & { ClipboardItem?: typeof ClipboardItem };
  if (!nav.clipboard || typeof nav.clipboard.write !== 'function') {
    throw new Error('Буфер обмена недоступен в этом браузере');
  }
  const ClipboardItemCtor = win.ClipboardItem || (nav as any).ClipboardItem;
  if (!ClipboardItemCtor) {
    throw new Error('Браузер не поддерживает сохранение изображений в буфер обмена');
  }
  const item = new ClipboardItemCtor({ [blob.type]: blob });
  await nav.clipboard.write([item]);
}

async function writeSvgToClipboard(svgText: string): Promise<void> {
  const win = getWindow();
  const nav = win.navigator as Navigator & { ClipboardItem?: typeof ClipboardItem };
  if (!nav.clipboard || typeof nav.clipboard.write !== 'function') {
    throw new Error('Буфер обмена недоступен в этом браузере');
  }
  const ClipboardItemCtor = win.ClipboardItem || (nav as any).ClipboardItem;
  if (!ClipboardItemCtor) {
    throw new Error('Браузер не поддерживает сохранение изображений в буфер обмена');
  }
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const item = new ClipboardItemCtor({ 'image/svg+xml': blob });
  await nav.clipboard.write([item]);
}

function isSecurityError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'SecurityError' || error.message.includes('Tainted canvases may not be exported'))
  );
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
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

function serializeCloneToSvg(
  node: HTMLElement,
  width: number,
  height: number,
  backgroundColor?: string,
): string {
  const serializer = new XMLSerializer();
  const prepared = node.cloneNode(true) as HTMLElement;
  const roundedWidth = Math.max(1, Math.round(width));
  const roundedHeight = Math.max(1, Math.round(height));
  prepared.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  prepared.style.width = `${roundedWidth}px`;
  prepared.style.height = `${roundedHeight}px`;
  const serialized = serializer.serializeToString(prepared);
  const bgRect = backgroundColor
    ? `<rect width="100%" height="100%" fill="${backgroundColor}" />`
    : '';
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"` +
    ` width="${roundedWidth}" height="${roundedHeight}" viewBox="0 0 ${roundedWidth} ${roundedHeight}"` +
    `>` +
    `${bgRect}<foreignObject x="0" y="0" width="${roundedWidth}" height="${roundedHeight}" style="width:${roundedWidth}px;height:${roundedHeight}px;" xmlns="http://www.w3.org/1999/xhtml">` +
    `${serialized}</foreignObject></svg>`
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
    try {
      img.crossOrigin = 'anonymous';
    } catch {
      /* ignore */
    }
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

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, scaledWidth, scaledHeight);

  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);
  } finally {
    URL.revokeObjectURL(url);
  }

  return canvas;
}

export async function copyElementImageToClipboard(
  element: HTMLElement,
  options: CopyImageOptions = {},
): Promise<CopyImageResult> {
  if (isServer()) {
    throw new Error('Невозможно сделать снимок на сервере');
  }

  const { node, skippedImages, skippedBackgrounds, width, height } = await sanitizeElement(element, options);
  const pixelRatio = options.pixelRatio ?? getWindow().devicePixelRatio ?? 1;
  const backgroundColor = options.backgroundColor ?? resolveBackgroundColor(element);
  if ('style' in node) {
    (node as HTMLElement).style.backgroundColor = backgroundColor;
  }
  const svgText = serializeCloneToSvg(node, width, height, backgroundColor);

  try {
    const canvas = await rasterizeSvg(svgText, width, height, pixelRatio, backgroundColor);
    if (isCanvasBlank(canvas)) {
      throw new Error('Получилось пустое изображение после рендеринга');
    }
    const blob = await canvasToBlob(canvas);
    await writeBlobToClipboard(blob);
    return { skippedImages, skippedBackgrounds, format: 'png' };
  } catch (error) {
    if (!isSecurityError(error) && !(error instanceof Error && /пустое изображение/i.test(error.message))) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    await writeSvgToClipboard(svgText);
    return { skippedImages, skippedBackgrounds, format: 'svg' };
  }
}
