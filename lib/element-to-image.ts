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
const HTTP_URL_REGEX = /^(https?:)?\/\//i;

function isHTMLElement(node: Element): node is HTMLElement {
  return node instanceof HTMLElement;
}

function isSVGElement(node: Element): node is SVGElement {
  return node instanceof SVGElement;
}

function getEffectivePort(url: URL): string {
  if (url.port) return url.port;
  if (url.protocol === 'http:') return '80';
  if (url.protocol === 'https:') return '443';
  return '';
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized === '0.0.0.0' ||
    normalized.startsWith('127.') ||
    normalized.endsWith('.localhost')
  );
}

function shouldTreatAsSameOrigin(url: URL, reference: URL): boolean {
  if (url.origin === reference.origin) {
    return true;
  }

  if (url.protocol !== reference.protocol) {
    return false;
  }

  if (!isLoopbackHostname(url.hostname) || !isLoopbackHostname(reference.hostname)) {
    return false;
  }

  return getEffectivePort(url) === getEffectivePort(reference);
}

function normalizeLoopbackUrl(url: URL, reference: URL): URL {
  if (shouldTreatAsSameOrigin(url, reference)) {
    return new URL(url.pathname + url.search, reference.origin);
  }
  return url;
}

function shouldUseAnonymousCors(src: string | null | undefined): boolean {
  if (!src) return false;
  if (src.startsWith('data:') || src.startsWith('blob:')) return false;

  try {
    const reference = new URL(window.location.href);
    const absolute = new URL(src, reference);
    return !shouldTreatAsSameOrigin(absolute, reference);
  } catch {
    return false;
  }
}

function cloneNodeDeep(node: Element, filter?: (node: HTMLElement) => boolean): Element | null {
  if (filter && isHTMLElement(node) && !filter(node)) {
    return null;
  }

  const clone = node.cloneNode(false) as Element;

  if (clone instanceof HTMLImageElement) {
    if (shouldUseAnonymousCors((node as HTMLImageElement).getAttribute('src'))) {
      clone.crossOrigin = 'anonymous';
      clone.referrerPolicy = 'no-referrer';
    } else {
      clone.removeAttribute('crossorigin');
      clone.removeAttribute('referrerpolicy');
    }
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
    if (ctx) {
      try {
        ctx.drawImage(source, 0, 0);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'SecurityError') {
          console.warn('Пропуск копирования canvas из-за tainted-состояния', error);
        } else {
          console.warn('Не удалось скопировать содержимое canvas', error);
        }
      }
    }
  }
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
    const reference = new URL(window.location.href);
    const absolute = new URL(url, reference);
    const normalized = normalizeLoopbackUrl(absolute, reference);
    const sameOrigin = shouldTreatAsSameOrigin(normalized, reference);
    const response = await fetch(normalized.toString(), {
      cache: 'no-store',
      mode: sameOrigin ? 'same-origin' : 'cors',
      signal: controller.signal,
      credentials: sameOrigin ? 'same-origin' : 'omit',
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
    const reference = new URL(window.location.href);
    const absolute = new URL(src, reference);
    const normalized = normalizeLoopbackUrl(absolute, reference).toString();
    const dataUrl = await resourceToDataUrl(normalized);
    img.setAttribute('src', dataUrl);
    img.removeAttribute('crossorigin');
    img.removeAttribute('srcset');
  } catch (error) {
    console.warn('Не удалось встроить изображение', src, error);
    img.removeAttribute('srcset');
    img.setAttribute('src', TRANSPARENT_PIXEL);
    img.style.visibility = 'hidden';
  }
}

async function inlineStyleUrls(element: Element): Promise<void> {
  if (!(isHTMLElement(element) || isSVGElement(element))) return;

  const style = element.style;
  const tasks: Promise<void>[] = [];
  const properties: string[] = [];

  for (let i = 0; i < style.length; i += 1) {
    const property = style.item(i);
    if (!property) continue;
    const value = style.getPropertyValue(property);
    if (!value || value.indexOf('url(') === -1) continue;
    properties.push(property);
  }

  for (const property of properties) {
    const priority = style.getPropertyPriority(property);
    const value = style.getPropertyValue(property);
    if (!value) continue;

    tasks.push(
      (async () => {
        let result = value;
        URL_REGEX.lastIndex = 0;
        const matches = Array.from(value.matchAll(URL_REGEX));
        for (const match of matches) {
          const raw = match[2];
          if (!raw || raw.startsWith('data:') || raw.startsWith('#')) continue;
          try {
            const absolute = new URL(raw, window.location.href).toString();
            const dataUrl = await resourceToDataUrl(absolute);
            result = result.replace(match[0], `url("${dataUrl}")`);
          } catch (error) {
            console.warn('Не удалось встроить ресурс стиля', property, raw, error);
            result = result.replace(match[0], 'none');
          }
        }

        style.setProperty(property, result, priority);
      })(),
    );
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}

async function embedImages(root: Element): Promise<void> {
  const imageTasks: Promise<void>[] = [];
  const visitedImages = new Set<HTMLImageElement>();
  const svgImages: SVGImageElement[] = [];

  if (root instanceof HTMLImageElement) {
    visitedImages.add(root);
  } else if (typeof SVGImageElement !== 'undefined' && root instanceof SVGImageElement) {
    svgImages.push(root);
  }

  root.querySelectorAll('img').forEach((img) => {
    if (img instanceof HTMLImageElement) {
      visitedImages.add(img);
    }
  });

  if (typeof SVGImageElement !== 'undefined') {
    root.querySelectorAll('image').forEach((img) => {
      if (img instanceof SVGImageElement) {
        svgImages.push(img);
      }
    });
  }

  visitedImages.forEach((img) => {
    imageTasks.push(inlineImageSource(img));
  });

  svgImages.forEach((image) => {
    imageTasks.push(inlineSvgImageSource(image));
  });

  const cssElements: Element[] = [];

  if (isHTMLElement(root) || isSVGElement(root)) {
    cssElements.push(root);
  }

  root.querySelectorAll('*').forEach((node) => {
    if (isHTMLElement(node) || isSVGElement(node)) {
      cssElements.push(node);
    }
  });

  for (const element of cssElements) {
    imageTasks.push(inlineStyleUrls(element));
  }

  await Promise.all(imageTasks);
}

async function inlineSvgImageSource(image: SVGImageElement) {
  const href = image.getAttribute('href') ?? image.getAttribute('xlink:href');
  if (!href || href.startsWith('data:') || href.startsWith('#')) return;

  try {
    const absolute = new URL(href, window.location.href).toString();
    const dataUrl = await resourceToDataUrl(absolute);
    image.setAttribute('href', dataUrl);
    image.setAttribute('xlink:href', dataUrl);
  } catch (error) {
    console.warn('Не удалось встроить SVG-изображение', href, error);
    image.removeAttribute('href');
    image.removeAttribute('xlink:href');
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (shouldUseAnonymousCors(url)) {
      img.crossOrigin = 'anonymous';
    } else {
      img.removeAttribute('crossorigin');
    }
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });
}

function isSafeResourceUrl(value: string | null): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('about:blank') ||
    trimmed.startsWith('#')
  ) {
    return true;
  }

  try {
    const reference = new URL(window.location.href);
    const absolute = new URL(trimmed, reference);
    return shouldTreatAsSameOrigin(absolute, reference);
  } catch {
    return false;
  }
}

function sanitizeExternalResources(root: Element) {
  const elements: Element[] = [];

  if (root instanceof Element) {
    elements.push(root);
  }

  root.querySelectorAll('*').forEach((node) => {
    elements.push(node);
  });

  elements.forEach((element) => {
    if (element instanceof HTMLImageElement) {
      if (!isSafeResourceUrl(element.getAttribute('src'))) {
        console.warn('Заменяю небезопасный src у <img>', element.getAttribute('src'));
        element.setAttribute('src', TRANSPARENT_PIXEL);
        element.style.visibility = 'hidden';
      }
      element.removeAttribute('srcset');
    } else if (typeof SVGImageElement !== 'undefined' && element instanceof SVGImageElement) {
      const href = element.getAttribute('href') ?? element.getAttribute('xlink:href');
      if (!isSafeResourceUrl(href)) {
        console.warn('Удаляю небезопасный href у <image>', href);
        element.setAttribute('href', TRANSPARENT_PIXEL);
        element.setAttribute('xlink:href', TRANSPARENT_PIXEL);
      }
    } else if (element instanceof HTMLVideoElement || element instanceof HTMLAudioElement) {
      if (!isSafeResourceUrl(element.getAttribute('src'))) {
        element.removeAttribute('src');
      }
      if (element instanceof HTMLVideoElement && !isSafeResourceUrl(element.getAttribute('poster'))) {
        element.removeAttribute('poster');
      }
      element.querySelectorAll('source,track').forEach((child) => {
        if (child instanceof HTMLSourceElement || child instanceof HTMLTrackElement) {
          if (!isSafeResourceUrl(child.getAttribute('src'))) {
            child.removeAttribute('src');
          }
          child.removeAttribute('srcset');
        }
      });
    } else if (element instanceof HTMLSourceElement || element instanceof HTMLTrackElement) {
      if (!isSafeResourceUrl(element.getAttribute('src'))) {
        element.removeAttribute('src');
      }
      element.removeAttribute('srcset');
    } else if (element instanceof HTMLLinkElement) {
      if (!isSafeResourceUrl(element.getAttribute('href'))) {
        element.remove();
      }
    } else if (
      element instanceof HTMLObjectElement ||
      element instanceof HTMLEmbedElement ||
      element instanceof HTMLIFrameElement
    ) {
      if (!isSafeResourceUrl(element.getAttribute('data'))) {
        element.removeAttribute('data');
      }
      if (!isSafeResourceUrl(element.getAttribute('src'))) {
        element.removeAttribute('src');
      }
    } else if (element instanceof SVGUseElement) {
      const href = element.getAttribute('href') ?? element.getAttribute('xlink:href');
      if (href && !href.startsWith('#') && !isSafeResourceUrl(href)) {
        element.removeAttribute('href');
        element.removeAttribute('xlink:href');
      }
    }
  });
}

function stripRemainingExternalReferences(root: Element) {
  const processElement = (element: Element) => {
    if (element instanceof HTMLImageElement) {
      const src = element.getAttribute('src');
      if (src && HTTP_URL_REGEX.test(src)) {
        console.warn('Заменяю оставшийся http(s)-src у <img>', src);
        element.setAttribute('src', TRANSPARENT_PIXEL);
        element.style.visibility = 'hidden';
      }
      element.removeAttribute('srcset');
    } else if (typeof SVGImageElement !== 'undefined' && element instanceof SVGImageElement) {
      const href = element.getAttribute('href') ?? element.getAttribute('xlink:href');
      if (href && HTTP_URL_REGEX.test(href)) {
        console.warn('Заменяю оставшийся http(s)-href у <image>', href);
        element.setAttribute('href', TRANSPARENT_PIXEL);
        element.setAttribute('xlink:href', TRANSPARENT_PIXEL);
      }
    } else if (element instanceof HTMLVideoElement || element instanceof HTMLAudioElement) {
      const mediaSrc = element.getAttribute('src');
      if (mediaSrc && HTTP_URL_REGEX.test(mediaSrc)) {
        element.removeAttribute('src');
      }
      if (element instanceof HTMLVideoElement) {
        const poster = element.getAttribute('poster');
        if (poster && HTTP_URL_REGEX.test(poster)) {
          element.removeAttribute('poster');
        }
      }
      element.querySelectorAll('source,track').forEach((child) => {
        if (child instanceof HTMLSourceElement || child instanceof HTMLTrackElement) {
          const srcAttr = child.getAttribute('src');
          if (srcAttr && HTTP_URL_REGEX.test(srcAttr)) {
            child.removeAttribute('src');
          }
          child.removeAttribute('srcset');
        }
      });
    } else if (element instanceof HTMLSourceElement || element instanceof HTMLTrackElement) {
      const srcAttr = element.getAttribute('src');
      if (srcAttr && HTTP_URL_REGEX.test(srcAttr)) {
        element.removeAttribute('src');
      }
      element.removeAttribute('srcset');
    } else if (element instanceof HTMLLinkElement) {
      const href = element.getAttribute('href');
      if (href && HTTP_URL_REGEX.test(href)) {
        element.remove();
        return;
      }
    } else if (
      element instanceof HTMLObjectElement ||
      element instanceof HTMLEmbedElement ||
      element instanceof HTMLIFrameElement
    ) {
      const dataAttr = element.getAttribute('data');
      if (dataAttr && HTTP_URL_REGEX.test(dataAttr)) {
        element.removeAttribute('data');
      }
      const srcAttr = element.getAttribute('src');
      if (srcAttr && HTTP_URL_REGEX.test(srcAttr)) {
        element.removeAttribute('src');
      }
    }

    if (isHTMLElement(element) || isSVGElement(element)) {
      const style = element.style;
      const properties: string[] = [];
      for (let i = 0; i < style.length; i += 1) {
        const property = style.item(i);
        if (!property) continue;
        const value = style.getPropertyValue(property);
        if (!value || value.indexOf('url(') === -1) continue;
        properties.push(property);
      }

      for (const property of properties) {
        const priority = style.getPropertyPriority(property);
        const value = style.getPropertyValue(property);
        if (!value) continue;

        let mutated = value;
        URL_REGEX.lastIndex = 0;
        const matches = Array.from(mutated.matchAll(URL_REGEX));
        for (const match of matches) {
          const raw = match[2];
          if (!raw) continue;
          const trimmed = raw.trim();
          if (
            trimmed.startsWith('data:') ||
            trimmed.startsWith('blob:') ||
            trimmed.startsWith('#') ||
            trimmed.toLowerCase().startsWith('about:blank')
          ) {
            continue;
          }

          if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('//')) {
            mutated = mutated.replace(match[0], 'none');
          } else {
            try {
              const reference = new URL(window.location.href);
              const absolute = new URL(trimmed, reference);
              if (!shouldTreatAsSameOrigin(absolute, reference)) {
                mutated = mutated.replace(match[0], 'none');
              }
            } catch {
              mutated = mutated.replace(match[0], 'none');
            }
          }
        }

        if (mutated !== value) {
          style.setProperty(property, mutated, priority);
        }
      }
    }
  };

  processElement(root);
  root.querySelectorAll('*').forEach((element) => {
    processElement(element);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Не удалось сформировать изображение.'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') {
        reject(
          new DOMException(
            'Canvas оказался tainted при формировании PNG. Убедитесь, что все изображения и фоновые ресурсы доступны с текущего origin.',
            'SecurityError',
          ),
        );
        return;
      }
      reject(error instanceof Error ? error : new Error(String(error)));
    }
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
  sanitizeExternalResources(wrapper);
  stripRemainingExternalReferences(wrapper);

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
