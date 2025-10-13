'use client';

export interface ElementToImageOptions {
  pixelRatio?: number;
  backgroundColor?: string;
  filter?: (node: HTMLElement) => boolean;
}

const DEFAULT_BACKGROUND = '#ffffff';
const URL_REGEX = /url\(("|')?(.*?)(\1)?\)/g;
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

function isHTMLElement(node: Element): node is HTMLElement {
  return node instanceof HTMLElement;
}

function isSVGElement(node: Element): node is SVGElement {
  return node instanceof SVGElement;
}

function cloneNodeDeep(node: Element, filter?: (node: HTMLElement) => boolean): Element | null {
  if (filter && isHTMLElement(node) && !filter(node)) {
    return null;
  }

  const clone = node.cloneNode(false) as Element;

  if (clone instanceof HTMLImageElement) {
    clone.crossOrigin = 'anonymous';
    clone.referrerPolicy = 'no-referrer';
  }

  inlineStyles(node, clone);
  copySpecialValues(node, clone);

  node.childNodes.forEach((child) => {
    if (child instanceof Element) {
      const childClone = cloneNodeDeep(child, filter);
      if (childClone) {
        clone.appendChild(childClone);
      }
    } else {
      clone.appendChild(child.cloneNode(true));
    }
  });

  return clone;
}

function inlineStyles(source: Element, target: Element) {
  if (!(isHTMLElement(target) || isSVGElement(target))) return;

  const computed = window.getComputedStyle(source);
  const targetStyle = target.style;

  for (let i = 0; i < computed.length; i += 1) {
    const property = computed.item(i);
    if (!property) continue;
    targetStyle.setProperty(property, computed.getPropertyValue(property));
  }

  targetStyle.setProperty('transition', 'none');
  targetStyle.setProperty('animation', 'none');
}

function copySpecialValues(source: Element, target: Element) {
  if (source instanceof HTMLInputElement && target instanceof HTMLInputElement) {
    target.value = source.value;
  } else if (source instanceof HTMLTextAreaElement && target instanceof HTMLTextAreaElement) {
    target.value = source.value;
    target.textContent = source.value;
  } else if (source instanceof HTMLSelectElement && target instanceof HTMLSelectElement) {
    target.value = source.value;
  } else if (source instanceof HTMLCanvasElement && target instanceof HTMLCanvasElement) {
    target.width = source.width;
    target.height = source.height;
    const ctx = target.getContext('2d');
    if (ctx) ctx.drawImage(source, 0, 0);
  }
}

function isInlineableUrl(raw?: string | null): raw is string {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (/^(data:|blob:|#|about:|javascript:)/i.test(trimmed)) return false;
  return true;
}

async function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать blob.'));
    reader.readAsDataURL(blob);
  });
}

async function fetchResource(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      mode: 'cors',
      signal: controller.signal,
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function proxyResource(url: string): Promise<Response> {
  const proxyUrl = `/api/screenshot/proxy?url=${encodeURIComponent(url)}`;
  const response = await fetch(proxyUrl, { cache: 'no-store', mode: 'same-origin' });
  if (!response.ok) {
    throw new Error(`Proxy HTTP ${response.status}`);
  }
  return response;
}

async function resourceToDataUrl(url: string): Promise<string> {
  try {
    const response = await fetchResource(url);
    const blob = await response.blob();
    return await readBlobAsDataUrl(blob);
  } catch (directError) {
    try {
      const response = await proxyResource(url);
      const blob = await response.blob();
      return await readBlobAsDataUrl(blob);
    } catch (proxyError) {
      const message = proxyError instanceof Error ? proxyError.message : String(proxyError);
      throw new Error(`Не удалось загрузить ресурс ${url}: ${message}`);
    }
  }
}

async function inlineImageSource(img: HTMLImageElement) {
  const src = img.getAttribute('src');
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) return;
  try {
    const absolute = new URL(src, window.location.href).toString();
    const dataUrl = await resourceToDataUrl(absolute);
    img.setAttribute('src', dataUrl);
    img.removeAttribute('srcset');
  } catch (error) {
    console.warn('Не удалось встроить изображение', src, error);
    img.removeAttribute('srcset');
    img.setAttribute('src', TRANSPARENT_PIXEL);
    img.style.visibility = 'hidden';
  }
}

async function inlineSvgImageSource(img: SVGImageElement) {
  const href =
    img.getAttribute('href') ||
    img.getAttribute('xlink:href') ||
    img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
  if (!href || href.startsWith('data:') || href.startsWith('blob:')) return;

  try {
    const absolute = new URL(href, window.location.href).toString();
    const dataUrl = await resourceToDataUrl(absolute);
    img.setAttribute('href', dataUrl);
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', dataUrl);
  } catch (error) {
    console.warn('Не удалось встроить SVG-изображение', href, error);
    img.setAttribute('href', TRANSPARENT_PIXEL);
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', TRANSPARENT_PIXEL);
    img.style.setProperty('visibility', 'hidden');
  }
}

async function inlineStyleUrls(element: Element) {
  if (!(isHTMLElement(element) || isSVGElement(element))) return;

  const styleAttr = element.getAttribute('style');
  if (!styleAttr || !styleAttr.includes('url(')) return;

  URL_REGEX.lastIndex = 0;
  const matches = Array.from(styleAttr.matchAll(URL_REGEX));
  if (matches.length === 0) return;

  let result = styleAttr;
  for (const match of matches) {
    const raw = match[2];
    if (!isInlineableUrl(raw)) continue;
    try {
      const absolute = new URL(raw, window.location.href).toString();
      const dataUrl = await resourceToDataUrl(absolute);
      result = result.replaceAll(match[0], `url("${dataUrl}")`);
    } catch (error) {
      console.warn('Не удалось встроить стиль с изображением', raw, error);
      result = result.replaceAll(match[0], 'none');
    }
  }

  element.setAttribute('style', result);
}

async function inlineBackgroundImages(element: HTMLElement) {
  const value = element.style.backgroundImage;
  if (!value || value === 'none') return;

  URL_REGEX.lastIndex = 0;
  const matches = Array.from(value.matchAll(URL_REGEX));
  if (!matches.length) return;

  let result = value;
  for (const match of matches) {
    const raw = match[2];
    if (!isInlineableUrl(raw)) continue;
    try {
      const absolute = new URL(raw, window.location.href).toString();
      const dataUrl = await resourceToDataUrl(absolute);
      result = result.replace(match[0], `url("${dataUrl}")`);
    } catch (error) {
      console.warn('Не удалось встроить фон', raw, error);
      result = result.replace(match[0], 'none');
    }
  }

  element.style.backgroundImage = result;
}

async function embedImages(root: Element): Promise<void> {
  const imageTasks: Promise<void>[] = [];
  const visitedImages = new Set<HTMLImageElement>();
  const visitedSvgImages = new Set<SVGImageElement>();

  if (root instanceof HTMLImageElement) {
    visitedImages.add(root);
  }

  root.querySelectorAll('img').forEach((img) => {
    if (img instanceof HTMLImageElement) {
      visitedImages.add(img);
    }
  });

  if (root instanceof SVGImageElement) {
    visitedSvgImages.add(root);
  }

  root.querySelectorAll('image').forEach((img) => {
    if (img instanceof SVGImageElement) {
      visitedSvgImages.add(img);
    }
  });

  visitedImages.forEach((img) => {
    imageTasks.push(inlineImageSource(img));
  });

  visitedSvgImages.forEach((img) => {
    imageTasks.push(inlineSvgImageSource(img));
  });

  const backgroundElements: HTMLElement[] = [];
  if (root instanceof HTMLElement) {
    backgroundElements.push(root);
  }
  root.querySelectorAll('*').forEach((node) => {
    if (node instanceof HTMLElement) {
      backgroundElements.push(node);
    }
  });

  for (const element of backgroundElements) {
    imageTasks.push(inlineBackgroundImages(element));
  }

  const styleElements: Element[] = [];
  if (root instanceof HTMLElement || root instanceof SVGElement) {
    styleElements.push(root);
  }

  root.querySelectorAll('*').forEach((node) => {
    if (node instanceof HTMLElement || node instanceof SVGElement) {
      styleElements.push(node);
    }
  });

  for (const element of styleElements) {
    imageTasks.push(inlineStyleUrls(element));
  }

  await Promise.all(imageTasks);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Не удалось сформировать изображение.'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

function measure(node: HTMLElement) {
  const rect = node.getBoundingClientRect();
  const width = Math.max(Math.ceil(rect.width), node.offsetWidth, node.scrollWidth);
  const height = Math.max(Math.ceil(rect.height), node.offsetHeight, node.scrollHeight);
  return { width, height };
}

export async function elementToCanvas(
  node: HTMLElement,
  options: ElementToImageOptions = {}
): Promise<HTMLCanvasElement> {
  const { filter, pixelRatio: requestedPixelRatio, backgroundColor } = options;
  const clone = cloneNodeDeep(node, filter);
  if (!clone) {
    throw new Error('Элемент не содержит содержимого для копирования.');
  }

  const { width, height } = measure(node);
  if (!width || !height) {
    throw new Error('Не удалось определить размер элемента.');
  }

  const wrapper = document.createElement('div');
  wrapper.style.margin = '0';
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrapper.appendChild(clone);

  if (isHTMLElement(clone)) {
    clone.style.width = `${width}px`;
    clone.style.height = `${height}px`;
  } else if (isSVGElement(clone)) {
    clone.setAttribute('width', `${width}px`);
    clone.setAttribute('height', `${height}px`);
  }

  await embedImages(wrapper);

  const serialized = new XMLSerializer().serializeToString(wrapper);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await loadImage(url);
    const pixelRatio = Math.max(1, Math.min(requestedPixelRatio ?? (window.devicePixelRatio || 1), 3));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D контекст недоступен.');
    }

    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = backgroundColor ?? DEFAULT_BACKGROUND;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(pixelRatio, pixelRatio);
    ctx.drawImage(img, 0, 0);

    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function elementToBlob(
  node: HTMLElement,
  options?: ElementToImageOptions
): Promise<Blob> {
  const canvas = await elementToCanvas(node, options);
  return canvasToBlob(canvas);
}

export async function elementToPng(
  node: HTMLElement,
  options?: ElementToImageOptions
): Promise<string> {
  const canvas = await elementToCanvas(node, options);
  return canvas.toDataURL('image/png');
}
