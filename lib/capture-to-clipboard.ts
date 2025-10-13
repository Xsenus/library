const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const CSS_URL_PROPERTIES = [
  'background-image',
  'mask-image',
  'mask',
  'border-image-source',
  'list-style-image',
  'cursor',
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

    if (source instanceof HTMLSourceElement && target instanceof HTMLSourceElement) {
      tasks.push(inlineSourceElement(source, target, cache));
    }

    if (source instanceof HTMLElement && target instanceof HTMLElement) {
      tasks.push(inlineCssResourceReferences(source, target, cache));
    }
  }

  await Promise.all(tasks);
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

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
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

async function inlineSourceElement(
  source: HTMLSourceElement,
  target: HTMLSourceElement,
  cache: Map<string, Promise<string>>,
): Promise<void> {
  const tasks: Promise<void>[] = [];

  const rawSrc = source.getAttribute('src');
  if (rawSrc) {
    tasks.push(
      (async () => {
        const absolute = toAbsoluteUrl(rawSrc);
        if (!absolute) return;

        if (absolute.startsWith('data:')) {
          target.setAttribute('src', absolute);
          return;
        }

        if (!cache.has(absolute)) {
          cache.set(absolute, fetchAsDataUrl(absolute));
        }

        try {
          const dataUrl = await cache.get(absolute)!;
          target.setAttribute('src', dataUrl);
        } catch (error) {
          console.error('Failed to inline <source> src for snapshot', error);
          target.setAttribute('src', TRANSPARENT_PIXEL);
        }
      })(),
    );
  }

  const rawSrcset = source.getAttribute('srcset');
  if (rawSrcset) {
    tasks.push(
      (async () => {
        const entries = parseSrcset(rawSrcset);
        if (!entries.length) {
          target.removeAttribute('srcset');
          return;
        }

        const rewritten = await Promise.all(
          entries.map(async ({ url, descriptor }) => {
            const absolute = toAbsoluteUrl(url);
            if (!absolute) {
              return { url, descriptor };
            }

            if (absolute.startsWith('data:')) {
              return { url: absolute, descriptor };
            }

            if (!cache.has(absolute)) {
              cache.set(absolute, fetchAsDataUrl(absolute));
            }

            try {
              const dataUrl = await cache.get(absolute)!;
              return { url: dataUrl, descriptor };
            } catch (error) {
              console.error('Failed to inline <source> srcset for snapshot', error);
              return { url: TRANSPARENT_PIXEL, descriptor };
            }
          }),
        );

        const value = rewritten
          .map(({ url, descriptor }) => (descriptor ? `${url} ${descriptor}` : url))
          .join(', ');

        if (value) {
          target.setAttribute('srcset', value);
        } else {
          target.removeAttribute('srcset');
        }
      })(),
    );
  }

  await Promise.all(tasks);
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
  target: HTMLElement,
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

  if (changed) {
    target.style.setProperty(property, result, prioritySafe);
  }
}

function toAbsoluteUrl(url: string): string | null {
  try {
    return new URL(url, window.location.href).toString();
  } catch {
    return null;
  }
}

type SrcsetEntry = { url: string; descriptor: string };

function parseSrcset(value: string): SrcsetEntry[] {
  return value
    .split(',')
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .map((candidate) => {
      const [url, ...descriptorParts] = candidate.split(/\s+/).filter(Boolean);
      return { url, descriptor: descriptorParts.join(' ') } as SrcsetEntry;
    })
    .filter((entry) => !!entry.url);
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
