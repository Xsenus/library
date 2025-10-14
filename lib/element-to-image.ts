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

type PrepareOptions = Required<Pick<CopyImageOptions, 'skipDataAttribute'>>;

async function processCssUrls(
  value: string,
  counters: Counters,
): Promise<string | null> {
  if (!value || !value.includes('url(')) return value;

  let result = value;
  const matches = Array.from(value.matchAll(URL_FUNCTION_REGEX));
  for (const match of matches) {
    const rawUrl = match[2];
    if (!rawUrl) continue;
    if (DATA_URL_REGEX.test(rawUrl) || rawUrl.startsWith('blob:')) continue;

    let absolute: string;
    try {
      absolute = new URL(rawUrl, getWindow().location.href).href;
    } catch {
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

  const win = getWindow();
  const style = win.getComputedStyle(original);
  const cssTexts: string[] = [];
  for (let i = 0; i < style.length; i += 1) {
    const name = style.item(i);
    if (!name) continue;
    let value = style.getPropertyValue(name);
    if (!value) continue;
    if (name === 'background' || name === 'background-image' || name === 'mask' || name === 'mask-image') {
      value = (await processCssUrls(value, counters)) ?? value;
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
    await inlineImageElement(original, clone, counters);
  } else if (clone instanceof HTMLCanvasElement && original instanceof HTMLCanvasElement) {
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
): Promise<void> {
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

async function createCanvasFromElement(
  element: HTMLElement,
  options: CopyImageOptions,
  counters: Counters,
): Promise<HTMLCanvasElement> {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');

  const prepareOptions: PrepareOptions = {
    skipDataAttribute: options.skipDataAttribute ?? 'data-copy-skip',
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

export async function copyElementImageToClipboard(
  element: HTMLElement,
  options: CopyImageOptions = {},
): Promise<CopyImageResult> {
  if (isServer()) {
    throw new Error('Невозможно сделать снимок на сервере');
  }

  const counters: Counters = { images: 0, backgrounds: 0 };
  const canvas = await createCanvasFromElement(element, options, counters);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png', 0.95),
  );
  if (!blob) {
    throw new Error('Не удалось создать изображение');
  }

  await writeBlobToClipboard(blob);
  return { skippedImages: counters.images, skippedBackgrounds: counters.backgrounds };
}

