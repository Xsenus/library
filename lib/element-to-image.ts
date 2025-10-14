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

type DebugLevel = 'info' | 'warn' | 'error';

type DebugDetails = Record<string, unknown> | undefined;

interface CaptureDebugger {
  enabled: boolean;
  log: (level: DebugLevel, message: string, details?: DebugDetails) => void;
}

const DATA_URL_REGEX = /^data:/i;
const URL_FUNCTION_REGEX = /url\(("|'|)([^"')]+)\1\)/gi;
const URL_FUNCTION_SIMPLE_REGEX = /url\(/gi;
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const ABSOLUTE_HTTP_REGEX = /https?:\/\//i;
const GOOGLE_TOKEN_REGEX = /(google|gstatic|googleapis|googleusercontent|googletag|doubleclick)/i;

function createCaptureDebugger(element: HTMLElement): CaptureDebugger {
  const win = typeof window === 'undefined' ? undefined : window;
  if (!win) {
    return { enabled: false, log: () => undefined };
  }

  let enabled = true;
  const flag = (win as any).__EQUIPMENT_CAPTURE_DEBUG__;
  if (typeof flag === 'boolean') {
    enabled = flag;
  } else if (
    typeof process !== 'undefined' &&
    process.env &&
    process.env.NODE_ENV === 'production'
  ) {
    enabled = false;
  }

  const elementInfo = `${element.tagName.toLowerCase()}${
    element.id ? `#${element.id}` : ''
  }${element.className ? `.${String(element.className).replace(/\s+/g, '.')}` : ''}`;

  return {
    enabled,
    log(level, message, details) {
      if (!enabled) return;
      const prefix = `[equipment-copy:${elementInfo}]`;
      const payload = details ? [`${prefix} ${message}`, details] : [`${prefix} ${message}`];
      if (level === 'error') {
        console.error(...payload);
      } else if (level === 'warn') {
        console.warn(...payload);
      } else {
        console.debug(...payload);
      }
    },
  };
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

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
  debug: CaptureDebugger;
};

type PreparedClone = {
  node: HTMLElement;
  width: number;
  height: number;
};

async function processCssUrls(
  value: string,
  counters: Counters,
  stripAllImages: boolean,
  debug: CaptureDebugger,
  propertyName: string,
): Promise<string | null> {
  if (!value || !value.includes('url(')) return value;

  if (stripAllImages) {
    const matches = value.match(URL_FUNCTION_SIMPLE_REGEX);
    if (matches?.length) {
      counters.backgrounds += matches.length;
    }
    debug.log('info', 'Stripped CSS url due to strict mode', {
      property: propertyName,
      original: value,
    });
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
        debug.log('warn', 'Removed extension url from CSS', {
          property: propertyName,
          url: rawUrl,
        });
        continue;
      }
      if (isLikelyGoogleUrl(parsed)) {
        counters.backgrounds += 1;
        result = result.replace(match[0], 'none');
        debug.log('info', 'Removed Google url from CSS', {
          property: propertyName,
          url: parsed.href,
        });
        continue;
      }
      absolute = parsed.href;
    } catch {
      counters.backgrounds += 1;
      result = result.replace(match[0], 'none');
      debug.log('warn', 'Removed unparseable CSS url', {
        property: propertyName,
        url: rawUrl,
      });
      continue;
    }

    try {
      const dataUrl = await fetchAsDataUrl(absolute);
      result = result.replace(match[0], `url("${dataUrl}")`);
      debug.log('info', 'Inlined CSS url', {
        property: propertyName,
        source: absolute,
      });
    } catch (error) {
      counters.backgrounds += 1;
      result = result.replace(match[0], 'none');
      debug.log('warn', 'Failed to inline CSS url', {
        property: propertyName,
        source: absolute,
        error: error instanceof Error ? error.message : String(error),
      });
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
    options.debug.log('info', 'Removed element due to skip attribute', {
      tag: clone.tagName,
      reason: options.skipDataAttribute,
    });
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
    options.debug.log('info', 'Removed media element during inline styles', {
      tag: clone.tagName,
    });
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
      value =
        (await processCssUrls(
          value,
          counters,
          options.stripAllImages,
          options.debug,
          name,
        )) ?? value;
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
    clone.setAttribute('src', TRANSPARENT_PIXEL);
    clone.setAttribute('data-skipped-image', src || '');
    clone.style.backgroundColor = '#f8fafc';
    clone.style.border = '1px solid rgba(148, 163, 184, 0.4)';
    options.debug.log('info', 'Replaced image with transparent pixel in strict mode', {
      source: src,
    });
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

  if (isLikelyGoogleUrl(absolute)) {
    counters.images += 1;
    clone.removeAttribute('srcset');
    clone.setAttribute('src', '');
    clone.setAttribute('data-skipped-image', absolute);
    clone.style.backgroundColor = '#f8fafc';
    clone.style.border = '1px solid rgba(148, 163, 184, 0.4)';
    options.debug.log('info', 'Skipped Google hosted image', {
      source: absolute,
    });
    return;
  }

  try {
    const dataUrl = await fetchAsDataUrl(absolute);
    clone.setAttribute('src', dataUrl);
    clone.removeAttribute('srcset');
    options.debug.log('info', 'Inlined image as data URL', {
      source: absolute,
    });
  } catch (error) {
    counters.images += 1;
    clone.removeAttribute('srcset');
    clone.setAttribute('src', '');
    clone.setAttribute('data-skipped-image', absolute);
    clone.style.backgroundColor = '#f8fafc';
    clone.style.border = '1px solid rgba(148, 163, 184, 0.4)';
    options.debug.log('warn', 'Failed to inline image', {
      source: absolute,
      error: error instanceof Error ? error.message : String(error),
    });
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
    options.debug.log('info', 'Removed SVG image in strict mode', {
      href: getSvgHref(original),
    });
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
    options.debug.log('warn', 'Failed to resolve SVG image href', {
      href: rawHref,
    });
    return;
  }

  try {
    if (isLikelyGoogleUrl(absolute)) {
      throw new Error('Google asset skipped');
    }
    const dataUrl = await fetchAsDataUrl(absolute);
    clone.setAttribute('href', dataUrl);
    clone.setAttributeNS(XLINK_NS, 'href', dataUrl);
    options.debug.log('info', 'Inlined SVG image as data URL', {
      source: absolute,
    });
  } catch (error) {
    counters.images += 1;
    clone.removeAttribute('href');
    clone.removeAttributeNS(XLINK_NS, 'href');
    clone.remove();
    options.debug.log('warn', 'Failed to inline SVG image', {
      source: absolute,
      error: error instanceof Error ? error.message : String(error),
    });
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
      options.debug.log('info', 'Removed nested SVG image in strict mode', {
        href: getSvgHref(element),
      });
      return;
    }
    const href = getSvgHref(element);
    if (!href || DATA_URL_REGEX.test(href) || href.startsWith('blob:')) {
      // nothing to inline
    } else {
      try {
        const absolute = new URL(href, getWindow().location.href);
        if (isLikelyGoogleUrl(absolute)) {
          throw new Error('Google asset skipped');
        }
        const dataUrl = await fetchAsDataUrl(absolute.href);
        element.setAttribute('href', dataUrl);
        element.setAttributeNS(XLINK_NS, 'href', dataUrl);
        options.debug.log('info', 'Inlined nested SVG image', {
          source: absolute.href,
        });
      } catch (error) {
        counters.images += 1;
        element.remove();
        options.debug.log('warn', 'Failed to inline nested SVG image', {
          source: href,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }
  } else if (element instanceof SVGUseElement) {
    counters.images += 1;
    element.remove();
    options.debug.log('info', 'Removed nested <use> element', {
      href: getSvgHref(element),
    });
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
    options.debug.log('info', 'Removed <use> element in strict mode', {
      href: getSvgHref(original),
    });
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
      options.debug.log('warn', 'Failed to resolve local <use> reference', {
        href: rawHref,
      });
      return true;
    }
    const replacement = target.cloneNode(true) as Element;
    if (transform) {
      replacement.setAttribute('transform', transform);
    }
    parent.replaceChild(replacement, clone);
    await inlineElementStyles(target, replacement, counters, options);
    options.debug.log('info', 'Expanded local <use> reference', {
      href: rawHref,
    });
    return true;
  }

  let absoluteUrl: URL;
  try {
    absoluteUrl = new URL(rawHref, getWindow().location.href);
  } catch {
    counters.images += 1;
    clone.remove();
    options.debug.log('warn', 'Failed to parse external <use> href', {
      href: rawHref,
    });
    return true;
  }

  if (isLikelyGoogleUrl(absoluteUrl)) {
    counters.images += 1;
    clone.remove();
    options.debug.log('info', 'Skipped Google hosted <use> reference', {
      href: absoluteUrl.href,
    });
    return true;
  }

  const hrefString = absoluteUrl.href;
  const hashIndex = hrefString.indexOf('#');
  const resourceUrl = hashIndex >= 0 ? hrefString.slice(0, hashIndex) : hrefString;
  const fragmentId = hashIndex >= 0 ? hrefString.slice(hashIndex + 1) : null;

  try {
    if (isLikelyGoogleUrl(resourceUrl)) {
      throw new Error('Google asset skipped');
    }

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
    options.debug.log('info', 'Expanded external <use> reference', {
      href: resourceUrl,
      fragment: fragmentId,
    });
    return true;
  } catch (error) {
    counters.images += 1;
    clone.remove();
    options.debug.log('warn', 'Failed to inline external <use> reference', {
      href: resourceUrl,
      fragment: fragmentId,
      error: error instanceof Error ? error.message : String(error),
    });
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

function isCrossOriginUrl(url: string, origin: string): boolean {
  if (!url) return false;
  if (DATA_URL_REGEX.test(url)) return false;
  if (url.startsWith('blob:')) return false;
  if (url.startsWith('#')) return false;

  try {
    const parsed = new URL(url, getWindow().location.href);
    if (parsed.protocol === 'javascript:') return true;
    if (parsed.protocol === 'data:') return false;
    return parsed.origin !== origin;
  } catch {
    return true;
  }
}

function isLikelyGoogleUrl(input: string | URL): boolean {
  if (!input) return false;

  let url: URL;
  if (typeof input === 'string') {
    try {
      url = new URL(input, getWindow().location.href);
    } catch {
      return /google|gstatic|googleapis|googleusercontent|googletag/i.test(input);
    }
  } else {
    url = input;
  }

  const hostname = url.hostname.toLowerCase();
  return (
    hostname === 'google.com' ||
    hostname.endsWith('.google.com') ||
    hostname.endsWith('.google.ru') ||
    hostname.endsWith('.google.by') ||
    hostname.endsWith('.google.kz') ||
    hostname.endsWith('.google.ua') ||
    hostname.endsWith('.google') ||
    hostname.includes('googleusercontent.') ||
    hostname.includes('.gstatic.') ||
    hostname.endsWith('gstatic.com') ||
    hostname.includes('googleapis.') ||
    hostname.includes('googletagmanager.') ||
    hostname.includes('googletagservices.') ||
    hostname.includes('doubleclick.')
  );
}

function extractSrcsetUrls(srcset: string): string[] {
  return srcset
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split(/\s+/)[0])
    .filter(Boolean);
}

function purgeExternalResourceAttributes(
  root: HTMLElement,
  counters: Counters,
  debug: CaptureDebugger,
): void {
  const win = getWindow();
  const origin = win.location.origin;
  const stack: Element[] = [root];

  while (stack.length) {
    const el = stack.pop();
    if (!el) continue;

    for (let i = 0; i < el.children.length; i += 1) {
      const child = el.children.item(i);
      if (child) {
        stack.push(child);
      }
    }

    if (el instanceof HTMLStyleElement) {
      const text = el.textContent || '';
      if (!text) {
        continue;
      }
      const matches = text.match(URL_FUNCTION_SIMPLE_REGEX);
      if (matches?.length) {
        counters.backgrounds += matches.length;
        debug.log('info', 'Removed <style> tag with url() in strict mode', {
          text: text.slice(0, 200),
        });
        el.remove();
        continue;
      }
      if (/@import\s+/i.test(text)) {
        counters.backgrounds += 1;
        debug.log('info', 'Removed <style> tag with @import in strict mode', {});
        el.remove();
      }
      continue;
    }

    if (el instanceof HTMLLinkElement) {
      const rel = el.rel ? el.rel.toLowerCase() : '';
      if (rel.includes('stylesheet') || rel.includes('preload')) {
        counters.backgrounds += 1;
        debug.log('info', 'Removed linked stylesheet in strict mode', {
          href: el.href,
        });
        el.remove();
        continue;
      }
    }

    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      const name = attr.name;
      const lower = name.toLowerCase();
      const value = attr.value;
      if (!value || lower === 'style') continue;

      let shouldRemove = false;
      let treatAsImage = false;

      if (lower === 'srcset') {
        const urls = extractSrcsetUrls(value);
        if (urls.some((u) => isCrossOriginUrl(u, origin))) {
          shouldRemove = true;
          treatAsImage = true;
        }
      } else if (lower === 'src' || lower === 'poster' || lower === 'data') {
        if (isCrossOriginUrl(value, origin)) {
          shouldRemove = true;
          treatAsImage = true;
        }
      } else if (lower === 'href' || lower === 'xlink:href') {
        if (el instanceof SVGElement && !(el instanceof SVGAElement)) {
          if (isCrossOriginUrl(value, origin)) {
            shouldRemove = true;
            treatAsImage = true;
          }
        }
      } else if (value.includes('url(')) {
        shouldRemove = true;
      }

      if (!shouldRemove) continue;

      if (treatAsImage) {
        counters.images += 1;
      } else {
        counters.backgrounds += 1;
      }

      if (lower === 'src' && el instanceof HTMLImageElement) {
        el.removeAttribute('srcset');
        el.setAttribute('src', TRANSPARENT_PIXEL);
        el.setAttribute('data-skipped-image', value);
        el.style.backgroundColor = '#f8fafc';
        el.style.border = '1px solid rgba(148, 163, 184, 0.4)';
        debug.log('info', 'Replaced external image attribute in strict mode', {
          tag: el.tagName,
          attr: name,
          value,
        });
      } else if (lower === 'src' && el instanceof HTMLVideoElement) {
        el.removeAttribute('src');
        debug.log('info', 'Removed video src attribute in strict mode', {
          value,
        });
      } else if (lower === 'src' && el instanceof HTMLSourceElement) {
        el.removeAttribute('src');
        el.removeAttribute('srcset');
        debug.log('info', 'Removed <source> references in strict mode', {
          value,
        });
      } else if (lower === 'srcset') {
        el.removeAttribute('srcset');
        debug.log('info', 'Removed srcset attribute in strict mode', {
          tag: el.tagName,
          value,
        });
      } else if (lower === 'poster') {
        el.removeAttribute('poster');
        debug.log('info', 'Removed poster attribute in strict mode', {
          value,
        });
      } else if (lower === 'data') {
        el.removeAttribute('data');
        debug.log('info', 'Removed data attribute in strict mode', {
          tag: el.tagName,
        });
      } else if (lower === 'href' && el instanceof SVGUseElement) {
        el.remove();
        debug.log('info', 'Removed SVG <use> referencing external resource', {
          value,
        });
        continue;
      } else if (lower === 'href' && el instanceof SVGImageElement) {
        el.remove();
        debug.log('info', 'Removed SVG <image> referencing external resource', {
          value,
        });
        continue;
      } else if (lower === 'xlink:href' && el instanceof SVGImageElement) {
        el.remove();
        debug.log('info', 'Removed SVG xlink:image reference', {
          value,
        });
        continue;
      } else if (lower === 'xlink:href' && el instanceof SVGUseElement) {
        el.remove();
        debug.log('info', 'Removed SVG xlink:use reference', {
          value,
        });
        continue;
      } else {
        el.removeAttribute(name);
        debug.log('info', 'Removed attribute referencing external resource', {
          tag: el.tagName,
          attr: name,
          value,
        });
      }
    }
  }
}

function forceStripResidualUrls(
  root: HTMLElement,
  counters: Counters,
  debug: CaptureDebugger,
): void {
  removeGoogleElements(root, counters, debug);
  stripAbsoluteHttpAttributes(root, counters, debug);

  const stack: Element[] = [root];

  while (stack.length) {
    const el = stack.pop();
    if (!el) continue;

    for (let i = 0; i < el.children.length; i += 1) {
      const child = el.children.item(i);
      if (child) {
        stack.push(child);
      }
    }

    if (el instanceof HTMLImageElement) {
      if (el.src && !DATA_URL_REGEX.test(el.src) && !el.src.startsWith('blob:')) {
        counters.images += 1;
      }
      el.removeAttribute('srcset');
      el.setAttribute('src', TRANSPARENT_PIXEL);
      el.style.backgroundColor = '#f8fafc';
      el.style.border = '1px solid rgba(148, 163, 184, 0.4)';
      debug.log('info', 'Replaced residual image with transparent pixel', {
        tag: el.tagName,
      });
      continue;
    }

    if (
      el instanceof HTMLVideoElement ||
      el instanceof HTMLCanvasElement ||
      el instanceof HTMLIFrameElement ||
      el instanceof HTMLEmbedElement ||
      el instanceof HTMLObjectElement
    ) {
      counters.images += 1;
      if (el instanceof HTMLElement) {
        const placeholder = el.ownerDocument.createElement('div');
        const originalStyle = el.getAttribute('style');
        if (originalStyle) {
          placeholder.setAttribute('style', originalStyle);
        }
        placeholder.style.backgroundColor = '#f8fafc';
        placeholder.style.border = '1px solid rgba(148, 163, 184, 0.4)';
        placeholder.style.display = placeholder.style.display || 'inline-block';
        el.replaceWith(placeholder);
        stack.push(placeholder);
        debug.log('info', 'Replaced media element with placeholder', {
          tag: el.tagName,
        });
        continue;
      }
    }

    if (el instanceof HTMLSourceElement) {
      counters.images += 1;
      el.remove();
      debug.log('info', 'Removed <source> element in strict cleanup', {});
      continue;
    }

    if (el instanceof SVGImageElement || el instanceof SVGUseElement) {
      counters.images += 1;
      el.remove();
      debug.log('info', 'Removed SVG image/use in strict cleanup', {
        tag: el.tagName,
      });
      continue;
    }

    if (el instanceof HTMLElement || el instanceof SVGElement) {
      const styleAttr = el.getAttribute('style');
      if (styleAttr && styleAttr.includes('url(')) {
        const matchCount = styleAttr.match(URL_FUNCTION_SIMPLE_REGEX)?.length ?? 1;
        counters.backgrounds += matchCount;
        const replaced = styleAttr.replace(URL_FUNCTION_REGEX, 'none');
        el.setAttribute('style', replaced);
        debug.log('info', 'Removed url() from inline style during strict cleanup', {
          tag: el.tagName,
        });
      }
    }

    const attributes = Array.from(el.attributes);
    for (const attr of attributes) {
      if (attr.name === 'style') continue;
      const value = attr.value;
      if (!value) continue;
      if (attr.name === 'src' || attr.name === 'srcset') {
        if (!(el instanceof HTMLImageElement)) {
          counters.images += 1;
          el.removeAttribute(attr.name);
          debug.log('info', 'Removed residual src/srcset attribute', {
            tag: el.tagName,
            attr: attr.name,
          });
        }
        continue;
      }
      if (value.includes('url(')) {
        const matchCount = value.match(URL_FUNCTION_SIMPLE_REGEX)?.length ?? 1;
        counters.backgrounds += matchCount;
        el.removeAttribute(attr.name);
        debug.log('info', 'Removed attribute with url() during strict cleanup', {
          tag: el.tagName,
          attr: attr.name,
        });
      }
    }
  }
}

function removeGoogleElements(
  root: HTMLElement,
  counters: Counters,
  debug: CaptureDebugger,
): void {
  const stack: Element[] = [];
  for (let i = 0; i < root.children.length; i += 1) {
    const child = root.children.item(i);
    if (child) {
      stack.push(child);
    }
  }

  while (stack.length) {
    const el = stack.pop();
    if (!el) continue;

    let shouldRemove = false;
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      const raw = attr.value;
      if (!raw) continue;
      const lower = raw.toLowerCase();
      if (GOOGLE_TOKEN_REGEX.test(lower)) {
        shouldRemove = true;
        break;
      }
      try {
        const decoded = decodeURIComponent(lower);
        if (GOOGLE_TOKEN_REGEX.test(decoded)) {
          shouldRemove = true;
          break;
        }
      } catch {
        /* ignore decode errors */
      }
    }

    if (!shouldRemove && el instanceof HTMLElement) {
      const style = el.getAttribute('style');
      if (style && GOOGLE_TOKEN_REGEX.test(style.toLowerCase())) {
        shouldRemove = true;
      }
    }

    if (shouldRemove) {
      if (
        el instanceof HTMLImageElement ||
        el instanceof SVGImageElement ||
        el instanceof HTMLVideoElement ||
        el instanceof HTMLIFrameElement
      ) {
        counters.images += 1;
      } else {
        counters.backgrounds += 1;
      }
      el.remove();
      debug.log('info', 'Removed node referencing Google resource', {
        tag: el.tagName,
      });
      continue;
    }

    for (let i = 0; i < el.children.length; i += 1) {
      const child = el.children.item(i);
      if (child) {
        stack.push(child);
      }
    }
  }
}

function stripAbsoluteHttpAttributes(
  root: HTMLElement,
  counters: Counters,
  debug: CaptureDebugger,
): void {
  const stack: Element[] = [root];

  while (stack.length) {
    const el = stack.pop();
    if (!el) continue;

    for (let i = 0; i < el.children.length; i += 1) {
      const child = el.children.item(i);
      if (child) {
        stack.push(child);
      }
    }

    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      const name = attr.name;
      const lower = name.toLowerCase();
      const value = attr.value;
      if (!value) continue;

      if (lower === 'style') {
        let sanitized = value;
        if (sanitized.includes('url(')) {
          const matches = sanitized.match(URL_FUNCTION_SIMPLE_REGEX);
          if (matches?.length) {
            counters.backgrounds += matches.length;
          }
          sanitized = sanitized.replace(URL_FUNCTION_REGEX, 'none');
        }
        if (ABSOLUTE_HTTP_REGEX.test(sanitized)) {
          counters.backgrounds += 1;
          sanitized = sanitized.replace(ABSOLUTE_HTTP_REGEX, '');
        }
        if (sanitized.trim()) {
          el.setAttribute('style', sanitized);
        } else {
          el.removeAttribute('style');
        }
        debug.log('info', 'Sanitized style attribute with absolute url', {
          tag: el.tagName,
        });
        continue;
      }

      if (!ABSOLUTE_HTTP_REGEX.test(value)) {
        continue;
      }

      const treatAsImage =
        lower === 'src' ||
        lower === 'srcset' ||
        lower === 'poster' ||
        lower === 'data' ||
        (lower === 'href' && el instanceof SVGImageElement);

      if (treatAsImage) {
        counters.images += 1;
      } else {
        counters.backgrounds += 1;
      }

      if (lower === 'src' && el instanceof HTMLImageElement) {
        el.removeAttribute('srcset');
        el.setAttribute('src', TRANSPARENT_PIXEL);
        el.setAttribute('data-skipped-image', value);
        el.style.backgroundColor = '#f8fafc';
        el.style.border = '1px solid rgba(148, 163, 184, 0.4)';
        debug.log('info', 'Replaced absolute src attribute', {
          value,
        });
      } else if (lower === 'srcset' && el instanceof HTMLImageElement) {
        el.removeAttribute('srcset');
        debug.log('info', 'Removed absolute srcset attribute', {
          value,
        });
      } else if (lower === 'href' && el instanceof SVGImageElement) {
        el.remove();
        debug.log('info', 'Removed SVG image with absolute href', {
          value,
        });
        break;
      } else {
        el.removeAttribute(name);
        debug.log('info', 'Removed attribute with absolute URL', {
          tag: el.tagName,
          attr: name,
          value,
        });
      }
    }
  }
}

async function prepareElementClone(
  element: HTMLElement,
  counters: Counters,
  options: PrepareOptions,
): Promise<PreparedClone> {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');

  await inlineElementStyles(element, clone, counters, options);

  if (options.stripAllImages) {
    purgeExternalResourceAttributes(clone, counters, options.debug);
    forceStripResidualUrls(clone, counters, options.debug);
  }

  const rect = element.getBoundingClientRect();
  const safeWidth = Math.max(Math.ceil(rect.width), 1);
  const safeHeight = Math.max(Math.ceil(rect.height), 1);

  clone.style.boxSizing = 'border-box';
  clone.style.width = `${safeWidth}px`;
  clone.style.height = `${safeHeight}px`;

  return { node: clone, width: safeWidth, height: safeHeight };
}

async function rasterizeCloneWithForeignObject(
  prepared: PreparedClone,
  element: HTMLElement,
  options: CopyImageOptions,
): Promise<HTMLCanvasElement> {
  const { node, width, height } = prepared;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('xmlns', svgNS);
  svg.setAttribute('width', `${width}`);
  svg.setAttribute('height', `${height}`);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const foreignObject = document.createElementNS(svgNS, 'foreignObject');
  foreignObject.setAttribute('width', `${width}`);
  foreignObject.setAttribute('height', `${height}`);
  foreignObject.appendChild(node);
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
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
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
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function createCanvasFromElement(
  element: HTMLElement,
  options: CopyImageOptions,
  counters: Counters,
  stripAllImages: boolean,
  debug: CaptureDebugger,
): Promise<HTMLCanvasElement> {
  const prepareOptions: PrepareOptions = {
    skipDataAttribute: options.skipDataAttribute ?? 'data-copy-skip',
    stripAllImages,
    debug,
  };

  const prepared = await prepareElementClone(element, counters, prepareOptions);
  return rasterizeCloneWithForeignObject(prepared, element, options);
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

  const debug = createCaptureDebugger(element);
  debug.log('info', 'Starting capture attempt', {
    mode: 'normal',
    elementWidth: element.clientWidth,
    elementHeight: element.clientHeight,
  });

  const firstCounters: Counters = { images: 0, backgrounds: 0 };

  try {
    const canvas = await createCanvasFromElement(element, options, firstCounters, false, debug);
    let blob: Blob;
    try {
      blob = await canvasToBlob(canvas);
    } catch (blobError) {
      debug.log('error', 'Failed to serialize canvas in normal mode', {
        error: errorToMessage(blobError),
      });
      throw blobError;
    }
    await writeBlobToClipboard(blob);
    debug.log('info', 'Capture succeeded', {
      mode: 'normal',
      skippedImages: firstCounters.images,
      skippedBackgrounds: firstCounters.backgrounds,
    });
    return {
      skippedImages: firstCounters.images,
      skippedBackgrounds: firstCounters.backgrounds,
    };
  } catch (error) {
    if (!isSecurityError(error)) {
      debug.log('error', 'Capture failed with non-security error', {
        mode: 'normal',
        error: errorToMessage(error),
      });
      throw error instanceof Error ? error : new Error(String(error));
    }

    console.warn('Falling back to strict capture mode due to canvas security error', error);
    debug.log('warn', 'Security error encountered, switching to strict mode', {
      error: errorToMessage(error),
    });
  }

  const fallbackCounters: Counters = { images: 0, backgrounds: 0 };

  debug.log('info', 'Starting capture attempt', {
    mode: 'strict',
    elementWidth: element.clientWidth,
    elementHeight: element.clientHeight,
  });

  const fallbackCanvas = await createCanvasFromElement(
    element,
    options,
    fallbackCounters,
    true,
    debug,
  );
  let fallbackBlob: Blob;
  try {
    fallbackBlob = await canvasToBlob(fallbackCanvas);
  } catch (blobError) {
    debug.log('error', 'Failed to serialize canvas in strict mode', {
      error: errorToMessage(blobError),
    });
    throw blobError;
  }
  await writeBlobToClipboard(fallbackBlob);
  debug.log('info', 'Capture succeeded', {
    mode: 'strict',
    skippedImages: fallbackCounters.images,
    skippedBackgrounds: fallbackCounters.backgrounds,
  });
  return {
    skippedImages: fallbackCounters.images,
    skippedBackgrounds: fallbackCounters.backgrounds,
  };
}

