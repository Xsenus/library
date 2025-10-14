import { isServer } from './is-server';

export interface CopyImageResult {
  skippedImages: number;
  skippedBackgrounds: number;
}

export interface CopyImageOptions {
  backgroundColor?: string;
  pixelRatio?: number;
  skipDataAttribute?: string;
}

const DATA_URL_REGEX = /^data:/i;
const URL_FUNCTION_REGEX = /url\(("|'|)([^"')]+)\1\)/gi;
const URL_FUNCTION_SIMPLE_REGEX = /url\(/gi;
const XLINK_NS = 'http://www.w3.org/1999/xlink';

function getWindow(): Window {
  if (typeof window === 'undefined') {
    throw new Error('Element image utilities can only run in a browser environment.');
  }
  return window;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('Не удалось преобразовать Blob в data URL'));
      }
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать Blob'));
    reader.readAsDataURL(blob);
  });
}

async function fetchAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Не удалось загрузить ресурс (${response.status})`);
  }
  const blob = await response.blob();
  return blobToDataUrl(blob);
}

type Counters = {
  images: number;
  backgrounds: number;
};

type PrepareOptions = Required<Pick<CopyImageOptions, 'skipDataAttribute'>> & {
  stripAllImages: boolean;
};

async function processCssUrls(
  value: string,
  counters: Counters,
  stripAllImages: boolean,
): Promise<string | null> {
  if (!value || !value.includes('url(')) return value;

  if (stripAllImages) {
    const matches = value.match(URL_FUNCTION_SIMPLE_REGEX);
    if (matches?.length) {
      counters.backgrounds += matches.length;
    }
    return 'none';
  }

  let result = value;
  const matches = Array.from(value.matchAll(URL_FUNCTION_REGEX));
  for (const match of matches) {
    const rawUrl = match[2];
    if (!rawUrl) continue;
    if (DATA_URL_REGEX.test(rawUrl) || rawUrl.startsWith('blob:')) continue;
    if (rawUrl.startsWith('#')) continue;

    let absolute: string;
    try {
      const parsed = new URL(rawUrl, getWindow().location.href);
      if (parsed.protocol === 'data:') continue;
      if (parsed.protocol === 'javascript:') continue;
      if (parsed.protocol === 'chrome-extension:' || parsed.protocol === 'moz-extension:') {
        counters.backgrounds += 1;
        result = result.replace(match[0], 'none');
        continue;
      }
      absolute = parsed.href;
    } catch {
      counters.backgrounds += 1;
      result = result.replace(match[0], 'none');
      continue;
    }

    try {
      const dataUrl = await fetchAsDataUrl(absolute);
      result = result.replace(match[0], `url("${dataUrl}")`);
    } catch (error) {
      counters.backgrounds += 1;
      result = result.replace(match[0], 'none');
    }
  }

  return result;
}

function shouldProcessCssProperty(name: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return (
    lower.includes('background') ||
    lower.includes('mask') ||
    lower.includes('filter') ||
    lower.includes('clip-path') ||
    lower.includes('image') ||
    lower === 'border-image' ||
    lower === 'border-image-source' ||
    lower === 'list-style' ||
    lower === 'list-style-image' ||
    lower === 'content' ||
    lower === 'cursor'
  );
}

async function inlineElementStyles(
  original: Element,
  clone: Element,
  counters: Counters,
  options: PrepareOptions,
): Promise<void> {
  if (!(clone instanceof HTMLElement || clone instanceof SVGElement)) return;
  if (!(original instanceof HTMLElement || original instanceof SVGElement)) return;

  if (options.skipDataAttribute && original.getAttribute(options.skipDataAttribute) === '1') {
    clone.remove();
    return;
  }

  if (
    clone instanceof HTMLIFrameElement ||
    clone instanceof HTMLEmbedElement ||
    clone instanceof HTMLObjectElement ||
    clone instanceof HTMLVideoElement
  ) {
    counters.images += 1;
    clone.remove();
    return;
  }

  const win = getWindow();
  const style = win.getComputedStyle(original);
  const cssTexts: string[] = [];
  for (let i = 0; i < style.length; i += 1) {
    const name = style.item(i);
    if (!name) continue;
    let value = style.getPropertyValue(name);
    if (!value) continue;
    if (value.includes('url(') && shouldProcessCssProperty(name)) {
      value = (await processCssUrls(value, counters, options.stripAllImages)) ?? value;
      if (!value || value === 'none') {
        cssTexts.push(`${name}: none;`);
        continue;
      }
    }
    const priority = style.getPropertyPriority(name);
    cssTexts.push(`${name}: ${value}${priority ? ' !important' : ''};`);
  }

  clone.setAttribute('style', cssTexts.join(' '));

  if (clone instanceof HTMLInputElement && original instanceof HTMLInputElement) {
    clone.value = original.value;
    if (original.type === 'checkbox' || original.type === 'radio') {
      clone.checked = original.checked;
    }
  } else if (clone instanceof HTMLTextAreaElement && original instanceof HTMLTextAreaElement) {
    clone.value = original.value;
    clone.textContent = original.value;
  } else if (clone instanceof HTMLSelectElement && original instanceof HTMLSelectElement) {
    clone.value = original.value;
  }

  if (clone instanceof HTMLImageElement && original instanceof HTMLImageElement) {
    await inlineImageElement(original, clone, counters, options);
  } else if (clone instanceof HTMLSourceElement && original instanceof HTMLSourceElement) {
    if (original.src || original.srcset) {
      counters.images += 1;
    }
    clone.removeAttribute('srcset');
    clone.removeAttribute('src');
    return;
  } else if (clone instanceof HTMLCanvasElement && original instanceof HTMLCanvasElement) {
    try {
      const dataUrl = original.toDataURL();
      const img = new Image();
      img.src = dataUrl;
      img.width = original.width;
      img.height = original.height;
      const styleText = clone.getAttribute('style');
      if (styleText) {
        img.setAttribute('style', styleText);
      }
      clone.replaceWith(img);
      return;
    } catch (error) {
      counters.images += 1;
      if (options.stripAllImages) {
        clone.remove();
      } else {
        const placeholder = original.ownerDocument?.createElement('div') || document.createElement('div');
        placeholder.textContent = '';
        placeholder.setAttribute('style', clone.getAttribute('style') || '');
        placeholder.style.backgroundColor = '#f8fafc';
        placeholder.style.border = '1px solid rgba(148, 163, 184, 0.4)';
        placeholder.setAttribute('data-skipped-canvas', '1');
        clone.replaceWith(placeholder);
      }
      return;
    }
  }

  const svgHandled = await inlineSvgElementResources(original, clone, counters, options);
  if (svgHandled) {
    return;
  }

  for (let i = 0; i < original.childNodes.length; i += 1) {
    const origChild = original.childNodes[i];
    const cloneChild = clone.childNodes[i];
    if (!cloneChild) continue;
    if (origChild instanceof Element && options.skipDataAttribute && origChild.getAttribute(options.skipDataAttribute) === '1') {
      cloneChild.parentNode?.removeChild(cloneChild);
      continue;
    }
    if (origChild.nodeType === Node.ELEMENT_NODE) {
      await inlineElementStyles(origChild as Element, cloneChild as Element, counters, options);
    }
  }
}

async function inlineImageElement(
  original: HTMLImageElement,
  clone: HTMLImageElement,
  counters: Counters,
  options: PrepareOptions,
): Promise<void> {
  if (options.stripAllImages) {
    const src = original.currentSrc || original.src;
    if (src) {
      counters.images += 1;
    }
    clone.removeAttribute('srcset');
    clone.setAttribute('src', '');
    clone.setAttribute('data-skipped-image', src || '');
    clone.style.backgroundColor = '#f8fafc';
    clone.style.border = '1px solid rgba(148, 163, 184, 0.4)';
    return;
  }

  const src = original.currentSrc || original.src;
  if (!src || DATA_URL_REGEX.test(src)) return;

  let absolute: string;
  try {
    absolute = new URL(src, getWindow().location.href).href;
  } catch {
    return;
  }

  try {
    const dataUrl = await fetchAsDataUrl(absolute);
    clone.setAttribute('src', dataUrl);
    clone.removeAttribute('srcset');
  } catch (error) {
    counters.images += 1;
    clone.removeAttribute('srcset');
    clone.setAttribute('src', '');
    clone.setAttribute('data-skipped-image', absolute);
    clone.style.backgroundColor = '#f8fafc';
    clone.style.border = '1px solid rgba(148, 163, 184, 0.4)';
  }
}

function getSvgHref(element: SVGImageElement | SVGUseElement): string | null {
  if ('href' in element && element.href && typeof element.href.baseVal === 'string' && element.href.baseVal) {
    return element.href.baseVal;
  }
  return (
    element.getAttribute('href') ||
    element.getAttributeNS(XLINK_NS, 'href') ||
    element.getAttribute('xlink:href')
  );
}

async function inlineSvgImageElement(
  original: SVGImageElement,
  clone: SVGImageElement,
  counters: Counters,
  options: PrepareOptions,
): Promise<void> {
  if (options.stripAllImages) {
    counters.images += 1;
    clone.remove();
    return;
  }
  const rawHref = getSvgHref(original);
  if (!rawHref || DATA_URL_REGEX.test(rawHref) || rawHref.startsWith('blob:')) {
    return;
  }

  let absolute: string;
  try {
    absolute = new URL(rawHref, getWindow().location.href).href;
  } catch {
    counters.images += 1;
    clone.remove();
    return;
  }

  try {
    const dataUrl = await fetchAsDataUrl(absolute);
    clone.setAttribute('href', dataUrl);
    clone.setAttributeNS(XLINK_NS, 'href', dataUrl);
  } catch (error) {
    counters.images += 1;
    clone.removeAttribute('href');
    clone.removeAttributeNS(XLINK_NS, 'href');
    clone.remove();
  }
}

async function inlineExternalSvgSubtree(
  element: Element,
  counters: Counters,
  options: PrepareOptions,
): Promise<void> {
  if (!(element instanceof SVGElement)) return;

  if (element instanceof SVGImageElement) {
    if (options.stripAllImages) {
      counters.images += 1;
      element.remove();
      return;
    }
    const href = getSvgHref(element);
    if (!href || DATA_URL_REGEX.test(href) || href.startsWith('blob:')) {
      // nothing to inline
    } else {
      try {
        const absolute = new URL(href, getWindow().location.href).href;
        const dataUrl = await fetchAsDataUrl(absolute);
        element.setAttribute('href', dataUrl);
        element.setAttributeNS(XLINK_NS, 'href', dataUrl);
      } catch (error) {
        counters.images += 1;
        element.remove();
        return;
      }
    }
  } else if (element instanceof SVGUseElement) {
    counters.images += 1;
    element.remove();
    return;
  }

  const children = Array.from(element.children);
  for (const child of children) {
    await inlineExternalSvgSubtree(child, counters, options);
  }
}

async function inlineSvgUseElement(
  original: SVGUseElement,
  clone: SVGUseElement,
  counters: Counters,
  options: PrepareOptions,
): Promise<boolean> {
  if (options.stripAllImages) {
    counters.images += 1;
    clone.remove();
    return true;
  }
  const rawHref = getSvgHref(original);
  if (!rawHref) return false;

  const parent = clone.parentNode;
  if (!parent) return true;

  const transform = clone.getAttribute('transform');

  if (rawHref.startsWith('#')) {
    const id = rawHref.slice(1);
    const target = original.ownerDocument?.getElementById(id);
    if (!target) {
      counters.images += 1;
      clone.remove();
      return true;
    }
    const replacement = target.cloneNode(true) as Element;
    if (transform) {
      replacement.setAttribute('transform', transform);
    }
    parent.replaceChild(replacement, clone);
    await inlineElementStyles(target, replacement, counters, options);
    return true;
  }

  let absoluteUrl: URL;
  try {
    absoluteUrl = new URL(rawHref, getWindow().location.href);
  } catch {
    counters.images += 1;
    clone.remove();
    return true;
  }

  const hrefString = absoluteUrl.href;
  const hashIndex = hrefString.indexOf('#');
  const resourceUrl = hashIndex >= 0 ? hrefString.slice(0, hashIndex) : hrefString;
  const fragmentId = hashIndex >= 0 ? hrefString.slice(hashIndex + 1) : null;

  try {
    const response = await fetch(resourceUrl, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error('Не удалось загрузить SVG-спрайт');
    }
    const text = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'image/svg+xml');
    let target: Element | null = null;
    if (fragmentId) {
      target = doc.getElementById(fragmentId);
    }
    if (!target) {
      target = doc.documentElement;
    }
    if (!target) {
      throw new Error('Не найден целевой SVG-элемент');
    }
    const ownerDocument = parent.ownerDocument || getWindow().document;
    const replacementSource = target.cloneNode(true) as Element;
    const replacement = ownerDocument.importNode
      ? (ownerDocument.importNode(replacementSource, true) as Element)
      : replacementSource;
    if (transform) {
      replacement.setAttribute('transform', transform);
    }
    parent.replaceChild(replacement, clone);
    await inlineExternalSvgSubtree(replacement, counters, options);
    return true;
  } catch (error) {
    counters.images += 1;
    clone.remove();
    return true;
  }
}

async function inlineSvgElementResources(
  original: Element,
  clone: Element,
  counters: Counters,
  options: PrepareOptions,
): Promise<boolean> {
  if (!(clone instanceof SVGElement) || !(original instanceof SVGElement)) {
    return false;
  }

  if (clone instanceof SVGImageElement && original instanceof SVGImageElement) {
    await inlineSvgImageElement(original, clone, counters, options);
    return false;
  }

  if (clone instanceof SVGUseElement && original instanceof SVGUseElement) {
    return inlineSvgUseElement(original, clone, counters, options);
  }

  return false;
}

async function createCanvasFromElement(
  element: HTMLElement,
  options: CopyImageOptions,
  counters: Counters,
  stripAllImages: boolean,
): Promise<HTMLCanvasElement> {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');

  const prepareOptions: PrepareOptions = {
    skipDataAttribute: options.skipDataAttribute ?? 'data-copy-skip',
    stripAllImages,
  };

  await inlineElementStyles(element, clone, counters, prepareOptions);

  const { width, height } = element.getBoundingClientRect();
  const safeWidth = Math.ceil(width);
  const safeHeight = Math.ceil(height);

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('xmlns', svgNS);
  svg.setAttribute('width', `${safeWidth}`);
  svg.setAttribute('height', `${safeHeight}`);
  svg.setAttribute('viewBox', `0 0 ${safeWidth} ${safeHeight}`);

  const foreignObject = document.createElementNS(svgNS, 'foreignObject');
  foreignObject.setAttribute('width', '100%');
  foreignObject.setAttribute('height', '100%');
  foreignObject.appendChild(clone);
  svg.appendChild(foreignObject);

  const serialized = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([serialized], {
    type: 'image/svg+xml;charset=utf-8',
  });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    const pixelRatio = Math.min(options.pixelRatio ?? getWindow().devicePixelRatio ?? 1, 3);
    canvas.width = safeWidth * pixelRatio;
    canvas.height = safeHeight * pixelRatio;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Не удалось создать контекст canvas');
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(pixelRatio, pixelRatio);
    const background = options.backgroundColor || getCanvasBackgroundColor(element);
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, safeWidth, safeHeight);
    }
    ctx.drawImage(img, 0, 0, safeWidth, safeHeight);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function getCanvasBackgroundColor(element: HTMLElement): string {
  const win = getWindow();
  let el: HTMLElement | null = element;
  while (el) {
    const bg = win.getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      return bg;
    }
    el = el.parentElement;
  }
  return win.getComputedStyle(win.document.body).backgroundColor || '#ffffff';
}

async function loadImage(url: string): Promise<HTMLImageElement> {
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

async function writeBlobToClipboard(blob: Blob): Promise<void> {
  const nav = getWindow().navigator as Navigator & { ClipboardItem?: typeof ClipboardItem };
  if (!nav.clipboard || typeof nav.clipboard.write !== 'function') {
    throw new Error('Буфер обмена недоступен в этом браузере');
  }

  const ClipboardItemCtor = getWindow().ClipboardItem || (nav as any).ClipboardItem;
  if (!ClipboardItemCtor) {
    throw new Error('Браузер не поддерживает сохранение изображений в буфер обмена');
  }

  const item = new ClipboardItemCtor({
    [blob.type]: blob,
  });
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
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Не удалось создать изображение'));
        }
      }, 'image/png', 0.95);
    } catch (error) {
      reject(error);
    }
  });
}

export async function copyElementImageToClipboard(
  element: HTMLElement,
  options: CopyImageOptions = {},
): Promise<CopyImageResult> {
  if (isServer()) {
    throw new Error('Невозможно сделать снимок на сервере');
  }

  const firstCounters: Counters = { images: 0, backgrounds: 0 };

  try {
    const canvas = await createCanvasFromElement(element, options, firstCounters, false);
    const blob = await canvasToBlob(canvas);
    await writeBlobToClipboard(blob);
    return {
      skippedImages: firstCounters.images,
      skippedBackgrounds: firstCounters.backgrounds,
    };
  } catch (error) {
    if (!isSecurityError(error)) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    console.warn('Falling back to strict capture mode due to canvas security error', error);
    const fallbackCounters: Counters = { images: 0, backgrounds: 0 };
    const fallbackCanvas = await createCanvasFromElement(element, options, fallbackCounters, true);
    const fallbackBlob = await canvasToBlob(fallbackCanvas);
    await writeBlobToClipboard(fallbackBlob);
    return {
      skippedImages: fallbackCounters.images,
      skippedBackgrounds: fallbackCounters.backgrounds,
    };
  }
}

