const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
type StylableElement = Element & { style?: CSSStyleDeclaration };

const CSS_URL_PROPERTIES = [
  'background',
  'background-image',
  'mask-image',
  'mask',
  'border-image-source',
  'border-image',
  'list-style-image',
  'cursor',
  'content',
];

type SnapshotOptions = {
  backgroundColor?: string;
  pixelRatio?: number;
  filter?: (element: Element) => boolean;
};

type ElementPair = [Element, Element];

function cloneNodeWithInlineStyles(source: Element): { clone: Element; pairs: ElementPair[] } {
  const clone = source.cloneNode(true) as Element;

  const walker = document.createTreeWalker(source, NodeFilter.SHOW_ELEMENT, null);
  const cloneWalker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT, null);

  let currentSource: Element | null = source;
  let currentClone: Element | null = clone;

  const pairs: ElementPair[] = [];

  while (currentSource && currentClone) {
    inlineComputedStyles(currentSource, currentClone);
    pairs.push([currentSource, currentClone]);

    currentSource = walker.nextNode() as Element | null;
    currentClone = cloneWalker.nextNode() as Element | null;
  }

  return { clone, pairs };
}

function inlineComputedStyles(source: Element, target: Element) {
  if (!(target instanceof HTMLElement) || !(source instanceof HTMLElement)) return;

  const computed = window.getComputedStyle(source);
  target.style.cssText = '';
  for (const name of Array.from(computed)) {
    target.style.setProperty(name, computed.getPropertyValue(name), computed.getPropertyPriority(name));
  }
}

function pruneNodes(root: Element, filter?: (element: Element) => boolean) {
  if (!filter) return;

  const toRemove: Element[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  let current = walker.currentNode as Element;
  while (current) {
    if (current !== root && !filter(current)) {
      toRemove.push(current);
    }
    current = walker.nextNode() as Element;
  }

  for (const el of toRemove) {
    el.remove();
  }
}

async function inlineExternalResources(pairs: ElementPair[], root: Element) {
  const cache = new Map<string, Promise<string>>();

  const tasks: Promise<void>[] = [];

  for (const [source, target] of pairs) {
    if (!root.contains(target)) continue;

    if (source instanceof HTMLImageElement && target instanceof HTMLImageElement) {
      tasks.push(inlineImageElement(source, target, cache));
    }

    if (source instanceof HTMLElement && target instanceof HTMLElement) {
      tasks.push(inlineCssResourceReferences(source, target, cache));
    }
  }

  await Promise.all(tasks);

  await inlineInlineStyleResources(root, cache);

  sanitizeClonedTree(root);
}

async function elementToBlob(element: HTMLElement, options: SnapshotOptions = {}): Promise<Blob> {
  const { backgroundColor = '#ffffff', pixelRatio = Math.min(window.devicePixelRatio || 1, 2), filter } = options;

  const rect = element.getBoundingClientRect();
  const width = Math.max(Math.ceil(rect.width), 1);
  const height = Math.max(Math.ceil(rect.height), 1);

  const { clone: cloned, pairs } = cloneNodeWithInlineStyles(element);
  const clonedElement = cloned as HTMLElement;
  pruneNodes(clonedElement, filter);

  await inlineExternalResources(pairs, clonedElement);

  clonedElement.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  clonedElement.style.width = `${width}px`;
  clonedElement.style.height = `${height}px`;
  clonedElement.style.boxSizing = 'border-box';

  try {
    return await rasterizeClonedElement(clonedElement, {
      width,
      height,
      backgroundColor,
      pixelRatio,
    });
  } catch (error) {
    if (isSecurityError(error)) {
      console.warn('Snapshot rasterization hit a security error, retrying with stripped assets.', error);
      purgeExternalResources(clonedElement);
      return rasterizeClonedElement(clonedElement, {
        width,
        height,
        backgroundColor,
        pixelRatio,
      });
    }
    throw error;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function sanitizeClonedTree(root: Element) {
  if (!(root instanceof HTMLElement)) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  let current = walker.currentNode as Element | null;

  while (current) {
    if (current instanceof HTMLImageElement) {
      sanitizeImageElement(current);
    }

    if (current instanceof HTMLPictureElement) {
      sanitizePictureElement(current);
    }

    if (current instanceof HTMLElement) {
      scrubInlineStyle(current);
    }

    if (current instanceof SVGElement) {
      scrubSvgAttributes(current);
    }

    current = walker.nextNode() as Element | null;
  }
}

function sanitizeImageElement(image: HTMLImageElement) {
  const src = image.getAttribute('src') ?? '';

  image.removeAttribute('srcset');
  image.removeAttribute('sizes');
  image.setAttribute('crossorigin', 'anonymous');

  if (!src || src === 'about:blank' || src === window.location.href) {
    image.setAttribute('src', TRANSPARENT_PIXEL);
    return;
  }

  if (!src.startsWith('data:')) {
    image.setAttribute('src', TRANSPARENT_PIXEL);
  }
}

function sanitizePictureElement(picture: HTMLPictureElement) {
  const sources = picture.querySelectorAll('source');
  sources.forEach((source) => {
    source.removeAttribute('sizes');
    const srcset = source.getAttribute('srcset');
    if (srcset && /https?:/i.test(srcset)) {
      source.setAttribute('srcset', TRANSPARENT_PIXEL);
    }
  });
}

function scrubInlineStyle(element: HTMLElement) {
  const styleAttr = element.getAttribute('style');
  if (!styleAttr || !styleAttr.includes('url(')) return;

  const sanitized = styleAttr.replace(/url\((['"]?)(?!data:)(?!#)([^'"\)]+)\1\)/gi, `url("${TRANSPARENT_PIXEL}")`);
  if (sanitized !== styleAttr) {
    element.setAttribute('style', sanitized);
  }
}

const SVG_URL_ATTRIBUTES = ['fill', 'stroke', 'filter', 'mask', 'clip-path'];

function scrubSvgAttributes(element: SVGElement) {
  for (const attr of SVG_URL_ATTRIBUTES) {
    const value = element.getAttribute(attr);
    if (!value) continue;
    if (!value.includes('url(')) continue;
    if (/#/.test(value)) continue;
    element.setAttribute(attr, 'none');
  }

  const href = element.getAttribute('href') ?? element.getAttribute('xlink:href');
  if (href && /https?:/i.test(href) && !href.startsWith('data:')) {
    element.removeAttribute('href');
    element.removeAttribute('xlink:href');
  }
}

async function inlineImageElement(
  source: HTMLImageElement,
  target: HTMLImageElement,
  cache: Map<string, Promise<string>>,
) {
  const resolved = source.currentSrc || source.src;
  if (!resolved) return;

  target.crossOrigin = 'anonymous';
  target.setAttribute('crossorigin', 'anonymous');

  if (resolved.startsWith('data:')) {
    target.removeAttribute('srcset');
    target.removeAttribute('sizes');
    target.src = resolved;
    target.loading = 'eager';
    return;
  }

  const absoluteUrl = toAbsoluteUrl(resolved);
  if (!absoluteUrl) return;

  if (!cache.has(absoluteUrl)) {
    cache.set(absoluteUrl, fetchAsDataUrl(absoluteUrl));
  }

  try {
    const dataUrl = await cache.get(absoluteUrl)!;
    target.removeAttribute('srcset');
    target.removeAttribute('sizes');
    target.setAttribute('src', dataUrl);
    target.loading = 'eager';
    if (typeof target.decode === 'function') {
      try {
        await target.decode();
      } catch {
        /* ignore */
      }
    }
  } catch (error) {
    console.error('Failed to inline image for snapshot', error);
    target.removeAttribute('srcset');
    target.removeAttribute('sizes');
    target.setAttribute('src', TRANSPARENT_PIXEL);
    target.loading = 'eager';
  }
}

async function inlineCssResourceReferences(
  source: HTMLElement,
  target: HTMLElement,
  cache: Map<string, Promise<string>>,
): Promise<void> {
  const computed = window.getComputedStyle(source);

  await Promise.all(
    CSS_URL_PROPERTIES.map(async (property) => {
      const value = computed.getPropertyValue(property);
      if (!value || value === 'none') return;

      await inlineCssUrls(target, property, value, computed.getPropertyPriority(property), cache);
    }),
  );
}

async function inlineCssUrls(
  target: StylableElement,
  property: string,
  value: string,
  priority: string,
  cache: Map<string, Promise<string>>,
): Promise<void> {
  const regex = /url\((['"]?)(.*?)\1\)/gi;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let result = '';
  let changed = false;
  const prioritySafe = priority ?? '';

  while ((match = regex.exec(value)) !== null) {
    const [, , rawUrl] = match;
    const original = rawUrl.trim();
    result += value.slice(lastIndex, match.index);

    const absolute = toAbsoluteUrl(original);
    if (!absolute) {
      result += match[0];
    } else if (absolute.startsWith('data:')) {
      result += `url("${absolute}")`;
      changed = true;
    } else {
      if (!cache.has(absolute)) {
        cache.set(absolute, fetchAsDataUrl(absolute));
      }

      try {
        const dataUrl = await cache.get(absolute)!;
        result += `url("${dataUrl}")`;
        changed = true;
      } catch (error) {
        console.error('Failed to inline CSS image for snapshot', error);
        result += `url("${TRANSPARENT_PIXEL}")`;
        changed = true;
      }
    }

    lastIndex = regex.lastIndex;
  }

  result += value.slice(lastIndex);

  if (changed && target.style) {
    target.style.setProperty(property, result, prioritySafe);
  }
}

async function inlineInlineStyleResources(root: Element, cache: Map<string, Promise<string>>): Promise<void> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  const tasks: Promise<void>[] = [];

  let current = walker.currentNode as Element | null;
  while (current) {
    const stylable = current as StylableElement;
    const style = stylable.style;
    if (style) {
      for (let i = 0; i < style.length; i += 1) {
        const property = style.item(i);
        if (!property) continue;
        const value = style.getPropertyValue(property);
        if (!value || !value.includes('url(')) continue;
        tasks.push(
          inlineCssUrls(stylable, property, value, style.getPropertyPriority(property), cache),
        );
      }
    }

    current = walker.nextNode() as Element | null;
  }

  await Promise.all(tasks);
}

function toAbsoluteUrl(url: string): string | null {
  try {
    return new URL(url, window.location.href).toString();
  } catch {
    return null;
  }
}

function isSameOrigin(url: string): boolean {
  try {
    const target = new URL(url, window.location.href);
    return target.origin === window.location.origin;
  } catch {
    return false;
  }
}

async function fetchAsDataUrl(url: string): Promise<string> {
  if (isSameOrigin(url)) {
    const response = await fetch(url, { cache: 'no-store', credentials: 'include' });
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    const blob = await response.blob();
    return blobToDataUrl(blob);
  }

  const proxied = `/api/snapshot-proxy?url=${encodeURIComponent(url)}`;
  const response = await fetch(proxied, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to proxy image: ${response.status}`);
  }

  const payload = (await response.json()) as { dataUrl?: unknown };
  if (typeof payload?.dataUrl !== 'string') {
    throw new Error('Proxy response is malformed');
  }

  return payload.dataUrl;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert blob to data URL'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

export async function copyElementAsImageToClipboard(
  element: HTMLElement,
  options: SnapshotOptions = {},
): Promise<void> {
  const blob = await elementToBlob(element, options);
  const ClipboardItemCtor = (window as typeof window & { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (!navigator.clipboard || !ClipboardItemCtor) {
    throw new Error('Clipboard API is not available');
  }
  await navigator.clipboard.write([new ClipboardItemCtor({ [blob.type]: blob })]);
}

export type { SnapshotOptions };

type RasterizeOptions = {
  width: number;
  height: number;
  backgroundColor: string;
  pixelRatio: number;
};

async function rasterizeClonedElement(
  clonedElement: HTMLElement,
  { width, height, backgroundColor, pixelRatio }: RasterizeOptions,
): Promise<Blob> {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('xmlns:xlink', XLINK_NS);
  svg.setAttribute('width', `${width}`);
  svg.setAttribute('height', `${height}`);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const foreignObject = document.createElementNS(SVG_NS, 'foreignObject');
  foreignObject.setAttribute('width', '100%');
  foreignObject.setAttribute('height', '100%');
  foreignObject.setAttribute('x', '0');
  foreignObject.setAttribute('y', '0');

  foreignObject.appendChild(clonedElement);
  svg.appendChild(foreignObject);

  const svgData = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(url);

    const canvas = document.createElement('canvas');
    const ratio = Math.max(pixelRatio, 1);
    canvas.width = width * ratio;
    canvas.height = height * ratio;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');

    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(ratio, ratio);
    ctx.drawImage(image, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
    if (!blob) throw new Error('Canvas is empty');

    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function isSecurityError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === 'SecurityError';
}

function purgeExternalResources(root: Element) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  let current = walker.currentNode as Element | null;

  while (current) {
    if (current instanceof HTMLImageElement) {
      current.removeAttribute('srcset');
      current.removeAttribute('sizes');
      current.setAttribute('crossorigin', 'anonymous');
      if (!current.src.startsWith('data:')) {
        current.src = TRANSPARENT_PIXEL;
      }
    } else if (current instanceof HTMLPictureElement) {
      current.querySelectorAll('source').forEach((source) => {
        source.removeAttribute('srcset');
        source.removeAttribute('sizes');
      });
    } else if (current instanceof HTMLVideoElement) {
      current.removeAttribute('poster');
      current.removeAttribute('src');
      const sources = current.querySelectorAll('source');
      sources.forEach((source) => {
        source.removeAttribute('src');
        source.removeAttribute('srcset');
      });
    } else if (current instanceof HTMLSourceElement) {
      current.removeAttribute('src');
      current.removeAttribute('srcset');
    }

    if (current instanceof HTMLElement) {
      const styleAttr = current.getAttribute('style');
      if (styleAttr?.includes('url(')) {
        const sanitized = styleAttr.replace(
          /url\((['"]?)(?!data:)(?!#)([^'"\)]+)\1\)/gi,
          `url("${TRANSPARENT_PIXEL}")`,
        );
        current.setAttribute('style', sanitized);
      }

      const background = current.getAttribute('background');
      if (background && !background.startsWith('data:')) {
        current.setAttribute('background', TRANSPARENT_PIXEL);
      }
    }

    if (current instanceof SVGImageElement) {
      const href = current.getAttribute('href') ?? current.getAttribute('xlink:href');
      if (href && !href.startsWith('data:')) {
        current.setAttribute('href', TRANSPARENT_PIXEL);
        current.setAttribute('xlink:href', TRANSPARENT_PIXEL);
      }
    }

    if (current instanceof SVGElement) {
      scrubSvgAttributes(current);
    }

    current = walker.nextNode() as Element | null;
  }
}
