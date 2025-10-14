'use client';

export interface ElementToImageOptions {
  pixelRatio?: number;
  backgroundColor?: string;
  filter?: (node: HTMLElement) => boolean;
  safeMode?: boolean;
}

const DEFAULT_BACKGROUND = '#ffffff';
const URL_REGEX = /url\(("|')?(.*?)(\1)?\)/g;
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const HTTP_URL_REGEX = /^(https?:)?\/\//i;

const SAFE_MODE_PSEUDO_STYLE = `*::before, *::after {\n  content: none !important;\n  background-image: none !important;\n  mask-image: none !important;\n  border-image-source: none !important;\n  cursor: auto !important;\n  -webkit-mask-image: none !important;\n}`;
const TARGETED_PSEUDO_NEUTRALIZE_STYLE =
  '[data-screenshot-pseudo-neutralize="true"]::before, [data-screenshot-pseudo-neutralize="true"]::after {\\n' +
  '  content: none !important;\\n' +
  '  background-image: none !important;\\n' +
  '  mask-image: none !important;\\n' +
  '  border-image-source: none !important;\\n' +
  '  cursor: auto !important;\\n' +
  '  -webkit-mask-image: none !important;\\n' +
  '}';

const EXTRA_URL_PROPERTIES = [
  'background',
  'background-image',
  'border-image',
  'border-image-source',
  'mask',
  'mask-image',
  'mask-border-source',
  '-webkit-mask-image',
  '-webkit-mask',
  'content',
  'cursor',
  'filter',
  'clip-path',
  'shape-outside',
  'list-style',
  'list-style-image',
];

const COMPUTED_URL_PROPERTIES = [
  'background',
  'background-image',
  'mask',
  'mask-image',
  'mask-border-source',
  '-webkit-mask-image',
  '-webkit-mask',
  'border-image',
  'border-image-source',
  'cursor',
  'content',
  'filter',
  'clip-path',
  'shape-outside',
  'list-style',
  'list-style-image',
];

type ExternalReferenceEntry = {
  type: 'attribute' | 'style' | 'computed' | 'pseudo';
  tagName: string;
  attribute?: string;
  property?: string;
  value: string | null;
};

const LOG_PREFIX = '[element-to-image]';

function debugLog(message: string, payload?: Record<string, unknown>) {
  if (payload) {
    console.log(`${LOG_PREFIX} ${message}`, payload);
  } else {
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

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
  debugLog('Проверяем принадлежность к origin', {
    url: url.toString(),
    reference: reference.toString(),
  });
  if (url.origin === reference.origin) {
    debugLog('URL совпадает по origin напрямую');
    return true;
  }

  if (url.protocol !== reference.protocol) {
    debugLog('Разный протокол, считаем origin отличающимся', {
      urlProtocol: url.protocol,
      referenceProtocol: reference.protocol,
    });
    return false;
  }

  if (!isLoopbackHostname(url.hostname) || !isLoopbackHostname(reference.hostname)) {
    debugLog('Не loopback hostname, origin различается', {
      urlHostname: url.hostname,
      referenceHostname: reference.hostname,
    });
    return false;
  }

  const samePort = getEffectivePort(url) === getEffectivePort(reference);
  debugLog('Loopback origin сравнивает порты', {
    urlPort: getEffectivePort(url),
    referencePort: getEffectivePort(reference),
    samePort,
  });
  return getEffectivePort(url) === getEffectivePort(reference);
}

function normalizeLoopbackUrl(url: URL, reference: URL): URL {
  debugLog('Нормализуем loopback URL', {
    url: url.toString(),
    reference: reference.toString(),
  });
  if (shouldTreatAsSameOrigin(url, reference)) {
    const normalized = new URL(url.pathname + url.search, reference.origin);
    debugLog('URL признан своим origin, подменяем на reference', {
      normalized: normalized.toString(),
    });
    return normalized;
  }
  return url;
}

function shouldUseAnonymousCors(src: string | null | undefined): boolean {
  debugLog('Проверяем необходимость anonymous CORS для изображения', { src });
  if (!src) return false;
  if (src.startsWith('data:') || src.startsWith('blob:')) return false;

  try {
    const reference = new URL(window.location.href);
    const absolute = new URL(src, reference);
    const needCors = !shouldTreatAsSameOrigin(absolute, reference);
    debugLog('Результат проверки anonymous CORS', {
      src,
      absolute: absolute.toString(),
      needCors,
    });
    return needCors;
  } catch {
    debugLog('Не удалось распарсить src, считаем его безопасным', { src });
    return false;
  }
}

function getSafeReplacementValue(property: string): string {
  const lower = property.toLowerCase();
  if (lower === 'cursor') return 'auto';
  if (lower === 'content') return 'none';
  if (lower === 'list-style' || lower === 'list-style-image') return 'none';
  if (lower === 'filter') return 'none';
  if (lower === 'clip-path') return 'none';
  if (lower === 'shape-outside') return 'none';
  return 'none';
}

function collectUrlProperties(style: CSSStyleDeclaration): string[] {
  const properties = new Set<string>();
  for (let i = 0; i < style.length; i += 1) {
    const property = style.item(i);
    if (!property) continue;
    const value = style.getPropertyValue(property);
    if (!value || value.indexOf('url(') === -1) continue;
    properties.add(property);
  }

  for (const candidate of EXTRA_URL_PROPERTIES) {
    const value = style.getPropertyValue(candidate);
    if (!value || value.indexOf('url(') === -1) continue;
    properties.add(candidate);
  }

  return Array.from(properties);
}

function shouldNeutralizeCssValue(value: string): boolean {
  if (!value) return false;

  URL_REGEX.lastIndex = 0;
  const matches = Array.from(value.matchAll(URL_REGEX));
  if (matches.length === 0) return false;

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
      return true;
    }

    try {
      const reference = new URL(window.location.href);
      const absolute = new URL(trimmed, reference);
      if (!shouldTreatAsSameOrigin(absolute, reference)) {
        return true;
      }
    } catch {
      return true;
    }
  }

  return false;
}

function cloneNodeDeep(node: Element, filter?: (node: HTMLElement) => boolean): Element | null {
  debugLog('Клонируем узел', {
    nodeName: node instanceof HTMLElement ? node.tagName : node.nodeName,
  });
  if (filter && isHTMLElement(node) && !filter(node)) {
    debugLog('Фильтр исключил узел из копирования', {
      nodeName: node.tagName,
    });
    return null;
  }

  const clone = node.cloneNode(false) as Element;

  if (clone instanceof HTMLImageElement) {
    debugLog('Обрабатываем <img> при клонировании', {
      originalSrc: (node as HTMLImageElement).getAttribute('src'),
    });
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
  debugLog('Инлайним стили', {
    nodeName: source instanceof HTMLElement ? source.tagName : source.nodeName,
  });
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
  debugLog('Копируем специальные значения', {
    nodeName: source instanceof HTMLElement ? source.tagName : source.nodeName,
  });
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
  debugLog('Конвертируем Blob в dataURL', { size: blob.size, type: blob.type });
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать blob.'));
    reader.readAsDataURL(blob);
  });
}

async function fetchResource(url: string): Promise<Response> {
  debugLog('Пробуем загрузить ресурс напрямую', { url });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const reference = new URL(window.location.href);
    const absolute = new URL(url, reference);
    const normalized = normalizeLoopbackUrl(absolute, reference);
    const sameOrigin = shouldTreatAsSameOrigin(normalized, reference);
    debugLog('Выполняем fetch ресурса', {
      normalized: normalized.toString(),
      sameOrigin,
      credentials: sameOrigin ? 'same-origin' : 'omit',
    });
    const response = await fetch(normalized.toString(), {
      cache: 'no-store',
      mode: sameOrigin ? 'same-origin' : 'cors',
      signal: controller.signal,
      credentials: sameOrigin ? 'same-origin' : 'omit',
    });
    if (!response.ok) {
      debugLog('Ресурс ответил ошибкой', {
        status: response.status,
        statusText: response.statusText,
        url: normalized.toString(),
      });
      throw new Error(`HTTP ${response.status}`);
    }
    debugLog('Ресурс успешно получен', {
      url: normalized.toString(),
      size: response.headers.get('content-length'),
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function proxyResource(url: string): Promise<Response> {
  debugLog('Пробуем загрузить ресурс через прокси', { url });
  const proxyUrl = `/api/screenshot/proxy?url=${encodeURIComponent(url)}`;
  const response = await fetch(proxyUrl, { cache: 'no-store', mode: 'same-origin' });
  if (!response.ok) {
    debugLog('Прокси вернул ошибку', { status: response.status, url });
    throw new Error(`Proxy HTTP ${response.status}`);
  }
  debugLog('Ресурс через прокси успешно получен', {
    url,
    size: response.headers.get('content-length'),
  });
  return response;
}

async function resourceToDataUrl(url: string): Promise<string> {
  debugLog('Инлайним ресурс в dataURL', { url });
  try {
    const response = await fetchResource(url);
    const blob = await response.blob();
    debugLog('Получили blob ресурса', { url, size: blob.size, type: blob.type });
    return await readBlobAsDataUrl(blob);
  } catch (directError) {
    debugLog('Прямой fetch провалился, пробуем прокси', {
      url,
      error: directError instanceof Error ? directError.message : String(directError),
    });
    try {
      const response = await proxyResource(url);
      const blob = await response.blob();
      debugLog('Получили blob через прокси', { url, size: blob.size, type: blob.type });
      return await readBlobAsDataUrl(blob);
    } catch (proxyError) {
      const message = proxyError instanceof Error ? proxyError.message : String(proxyError);
      debugLog('Прокси не помог, ресурс не получится встроить', { url, message });
      throw new Error(`Не удалось загрузить ресурс ${url}: ${message}`);
    }
  }
}

async function inlineImageSource(img: HTMLImageElement) {
  const src = img.getAttribute('src');
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) return;
  debugLog('Инлайним <img>', { src });
  try {
    const reference = new URL(window.location.href);
    const absolute = new URL(src, reference);
    const normalized = normalizeLoopbackUrl(absolute, reference).toString();
    debugLog('Нормализовали src изображения', {
      original: src,
      normalized,
    });
    const dataUrl = await resourceToDataUrl(normalized);
    img.setAttribute('src', dataUrl);
    img.removeAttribute('crossorigin');
    img.removeAttribute('srcset');
    debugLog('Изображение встроено как dataURL', {
      original: src,
      length: dataUrl.length,
    });
  } catch (error) {
    console.warn('Не удалось встроить изображение', src, error);
    img.removeAttribute('srcset');
    img.setAttribute('src', TRANSPARENT_PIXEL);
    img.style.visibility = 'hidden';
  }
}

async function inlineStyleUrls(element: Element): Promise<void> {
  debugLog('Ищем ресурсы в inline-стилях элемента', {
    node: element instanceof HTMLElement ? element.tagName : element.nodeName,
  });
  if (!(isHTMLElement(element) || isSVGElement(element))) return;

  const style = element.style;
  const tasks: Promise<void>[] = [];
  const properties = collectUrlProperties(style);

  for (const property of properties) {
    const priority = style.getPropertyPriority(property);
    const value = style.getPropertyValue(property);
    if (!value) continue;

    tasks.push(
      (async () => {
        URL_REGEX.lastIndex = 0;
        const matches = Array.from(value.matchAll(URL_REGEX));
        if (matches.length === 0) return;

        debugLog('Обрабатываем CSS-свойство', {
          property,
          value,
          matches: matches.map((m) => m[2]),
        });

        let mutated = value;
        let failed = false;

        for (const match of matches) {
          const raw = match[2];
          if (!raw || raw.startsWith('data:') || raw.startsWith('#')) continue;
          try {
            const absolute = new URL(raw, window.location.href).toString();
            debugLog('Инлайним ресурс из CSS', { property, raw, absolute });
            const dataUrl = await resourceToDataUrl(absolute);
            mutated = mutated.replace(match[0], `url("${dataUrl}")`);
          } catch (error) {
            console.warn('Не удалось встроить ресурс стиля', property, raw, error);
            failed = true;
            break;
          }
        }

        if (failed) {
          const safeValue = getSafeReplacementValue(property);
          style.setProperty(property, safeValue, priority);
          debugLog('CSS-свойство заменено безопасным значением', {
            property,
            safeValue,
          });
          return;
        }

        if (mutated !== value) {
          style.setProperty(property, mutated, priority);
          debugLog('CSS-свойство обновлено после инлайна', { property, mutated });
        }
      })(),
    );
  }

  if (tasks.length > 0) {
    debugLog('Ожидаем завершение задач по инлайну стилей', { count: tasks.length });
    await Promise.all(tasks);
    debugLog('Инлайн ресурсов в стилях завершён', {
      node: element instanceof HTMLElement ? element.tagName : element.nodeName,
    });
  }
}

async function embedImages(root: Element): Promise<void> {
  debugLog('Начинаем инлайнинг изображений и ресурсов', {
    root: root instanceof HTMLElement ? root.tagName : root.nodeName,
  });
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

  debugLog('Подготовленные HTML-изображения', { count: visitedImages.size });

  if (typeof SVGImageElement !== 'undefined') {
    root.querySelectorAll('image').forEach((img) => {
      if (img instanceof SVGImageElement) {
        svgImages.push(img);
      }
    });
  }

  debugLog('Подготовленные SVG-изображения', { count: svgImages.length });

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

  debugLog('Всего задач на инлайн ресурсов', { count: imageTasks.length });
  await Promise.all(imageTasks);
  debugLog('Инлайн изображений завершён');
}

async function inlineSvgImageSource(image: SVGImageElement) {
  const href = image.getAttribute('href') ?? image.getAttribute('xlink:href');
  if (!href || href.startsWith('data:') || href.startsWith('#')) return;
  debugLog('Инлайним SVG <image>', { href });

  try {
    const absolute = new URL(href, window.location.href).toString();
    const dataUrl = await resourceToDataUrl(absolute);
    image.setAttribute('href', dataUrl);
    image.setAttribute('xlink:href', dataUrl);
    debugLog('SVG <image> успешно встроен', { href, length: dataUrl.length });
  } catch (error) {
    console.warn('Не удалось встроить SVG-изображение', href, error);
    image.removeAttribute('href');
    image.removeAttribute('xlink:href');
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  debugLog('Создаём объект Image для загрузки', { url });
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (shouldUseAnonymousCors(url)) {
      img.crossOrigin = 'anonymous';
    } else {
      img.removeAttribute('crossorigin');
    }
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = (err) => {
      debugLog('Ошибка загрузки изображения', { url, error: err });
      reject(err);
    };
    img.src = url;
  });
}

function isSafeResourceUrl(value: string | null): boolean {
  debugLog('Проверяем URL на безопасность', { value });
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('about:blank') ||
    trimmed.startsWith('#')
  ) {
    debugLog('URL безопасен по схеме data/blob/about/anchor', { value });
    return true;
  }

  try {
    const reference = new URL(window.location.href);
    const absolute = new URL(trimmed, reference);
    const safe = shouldTreatAsSameOrigin(absolute, reference);
    debugLog('Результат проверки URL', {
      value,
      absolute: absolute.toString(),
      safe,
    });
    return safe;
  } catch {
    debugLog('URL не распарсили, считаем небезопасным', { value });
    return false;
  }
}

function sanitizeExternalResources(root: Element): ExternalReferenceEntry[] {
  debugLog('Начинаем санитарную обработку DOM', {
    root: root instanceof HTMLElement ? root.tagName : root.nodeName,
  });
  const elements: Element[] = [];
  const entries: ExternalReferenceEntry[] = [];

  if (root instanceof Element) {
    elements.push(root);
  }

  root.querySelectorAll('*').forEach((node) => {
    elements.push(node);
  });

  elements.forEach((element) => {
    if (element instanceof HTMLImageElement) {
      const originalSrc = element.getAttribute('src');
      if (!isSafeResourceUrl(originalSrc)) {
        console.warn('Заменяю небезопасный src у <img>', originalSrc);
        element.setAttribute('src', TRANSPARENT_PIXEL);
        element.style.visibility = 'hidden';
        entries.push({
          type: 'attribute',
          tagName: element.tagName,
          attribute: 'src',
          value: originalSrc,
        });
      }
      element.removeAttribute('srcset');
    } else if (typeof SVGImageElement !== 'undefined' && element instanceof SVGImageElement) {
      const href = element.getAttribute('href') ?? element.getAttribute('xlink:href');
      if (!isSafeResourceUrl(href)) {
        console.warn('Удаляю небезопасный href у <image>', href);
        element.setAttribute('href', TRANSPARENT_PIXEL);
        element.setAttribute('xlink:href', TRANSPARENT_PIXEL);
        entries.push({
          type: 'attribute',
          tagName: element.tagName,
          attribute: 'href',
          value: href,
        });
      }
    } else if (element instanceof HTMLVideoElement || element instanceof HTMLAudioElement) {
      const mediaSrc = element.getAttribute('src');
      if (!isSafeResourceUrl(mediaSrc)) {
        element.removeAttribute('src');
        entries.push({
          type: 'attribute',
          tagName: element.tagName,
          attribute: 'src',
          value: mediaSrc,
        });
      }
      if (element instanceof HTMLVideoElement) {
        const poster = element.getAttribute('poster');
        if (!isSafeResourceUrl(poster)) {
          element.removeAttribute('poster');
          entries.push({
            type: 'attribute',
            tagName: element.tagName,
            attribute: 'poster',
            value: poster,
          });
        }
      }
      element.querySelectorAll('source,track').forEach((child) => {
        if (child instanceof HTMLSourceElement || child instanceof HTMLTrackElement) {
          const childSrc = child.getAttribute('src');
          if (!isSafeResourceUrl(childSrc)) {
            child.removeAttribute('src');
            entries.push({
              type: 'attribute',
              tagName: child.tagName,
              attribute: 'src',
              value: childSrc,
            });
          }
          child.removeAttribute('srcset');
        }
      });
    } else if (element instanceof HTMLSourceElement || element instanceof HTMLTrackElement) {
      const ownSrc = element.getAttribute('src');
      if (!isSafeResourceUrl(ownSrc)) {
        element.removeAttribute('src');
        entries.push({
          type: 'attribute',
          tagName: element.tagName,
          attribute: 'src',
          value: ownSrc,
        });
      }
      element.removeAttribute('srcset');
    } else if (element instanceof HTMLLinkElement) {
      const href = element.getAttribute('href');
      if (!isSafeResourceUrl(href)) {
        element.remove();
        entries.push({
          type: 'attribute',
          tagName: element.tagName,
          attribute: 'href',
          value: href,
        });
      }
    } else if (
      element instanceof HTMLObjectElement ||
      element instanceof HTMLEmbedElement ||
      element instanceof HTMLIFrameElement
    ) {
      const dataAttr = element.getAttribute('data');
      if (!isSafeResourceUrl(dataAttr)) {
        element.removeAttribute('data');
        entries.push({
          type: 'attribute',
          tagName: element.tagName,
          attribute: 'data',
          value: dataAttr,
        });
      }
      const srcAttr = element.getAttribute('src');
      if (!isSafeResourceUrl(srcAttr)) {
        element.removeAttribute('src');
        entries.push({
          type: 'attribute',
          tagName: element.tagName,
          attribute: 'src',
          value: srcAttr,
        });
      }
    } else if (element instanceof SVGUseElement) {
      const href = element.getAttribute('href') ?? element.getAttribute('xlink:href');
      if (href && !href.startsWith('#') && !isSafeResourceUrl(href)) {
        element.removeAttribute('href');
        element.removeAttribute('xlink:href');
        entries.push({
          type: 'attribute',
          tagName: element.tagName,
          attribute: 'href',
          value: href,
        });
      }
    }
  });

  debugLog('Санитарная обработка завершена', {
    processed: elements.length,
    sanitizedAttributes: entries.length,
  });
  return entries;
}

function sanitizeCanvasElements(root: Element) {
  const canvases: HTMLCanvasElement[] = [];
  if (root instanceof HTMLCanvasElement) {
    canvases.push(root);
  }

  root.querySelectorAll('canvas').forEach((canvas) => {
    if (canvas instanceof HTMLCanvasElement) {
      canvases.push(canvas);
    }
  });

  canvases.forEach((canvas) => {
    try {
      void canvas.toDataURL('image/png');
    } catch (error) {
      console.warn('Обнаружен tainted canvas, заменяем плейсхолдером', error);
      const placeholder = document.createElement('img');
      placeholder.setAttribute('src', TRANSPARENT_PIXEL);
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.setAttribute('data-screenshot-canvas-placeholder', 'true');
      placeholder.width = canvas.width;
      placeholder.height = canvas.height;
      placeholder.className = canvas.className;
      placeholder.style.cssText = canvas.getAttribute('style') ?? '';
      placeholder.style.visibility = 'hidden';
      canvas.replaceWith(placeholder);
    }
  });
}

function stripRemainingExternalReferences(root: Element): ExternalReferenceEntry[] {
  debugLog('Удаляем оставшиеся внешние ссылки', {
    root: root instanceof HTMLElement ? root.tagName : root.nodeName,
  });
  const processElement = (element: Element) => {
    const records: ExternalReferenceEntry[] = [];
    if (element instanceof HTMLImageElement) {
      const src = element.getAttribute('src');
      if (src && HTTP_URL_REGEX.test(src)) {
        console.warn('Заменяю оставшийся http(s)-src у <img>', src);
        element.setAttribute('src', TRANSPARENT_PIXEL);
        element.style.visibility = 'hidden';
        records.push({
          type: 'attribute',
          tagName: element.tagName,
          attribute: 'src',
          value: src,
        });
      }
      element.removeAttribute('srcset');
    } else if (typeof SVGImageElement !== 'undefined' && element instanceof SVGImageElement) {
      const href = element.getAttribute('href') ?? element.getAttribute('xlink:href');
      if (href && HTTP_URL_REGEX.test(href)) {
        console.warn('Заменяю оставшийся http(s)-href у <image>', href);
        element.setAttribute('href', TRANSPARENT_PIXEL);
        element.setAttribute('xlink:href', TRANSPARENT_PIXEL);
        records.push({
          type: 'attribute',
          tagName: element.tagName,
          attribute: 'href',
          value: href,
        });
      }
    } else if (element instanceof HTMLVideoElement || element instanceof HTMLAudioElement) {
      const mediaSrc = element.getAttribute('src');
      if (mediaSrc && HTTP_URL_REGEX.test(mediaSrc)) {
        element.removeAttribute('src');
        records.push({
          type: 'attribute',
          tagName: element.tagName,
          attribute: 'src',
          value: mediaSrc,
        });
      }
      if (element instanceof HTMLVideoElement) {
        const poster = element.getAttribute('poster');
        if (poster && HTTP_URL_REGEX.test(poster)) {
          element.removeAttribute('poster');
          records.push({
            type: 'attribute',
            tagName: element.tagName,
            attribute: 'poster',
            value: poster,
          });
        }
      }
      element.querySelectorAll('source,track').forEach((child) => {
        if (child instanceof HTMLSourceElement || child instanceof HTMLTrackElement) {
          const srcAttr = child.getAttribute('src');
          if (srcAttr && HTTP_URL_REGEX.test(srcAttr)) {
            child.removeAttribute('src');
            records.push({
              type: 'attribute',
              tagName: child.tagName,
              attribute: 'src',
              value: srcAttr,
            });
          }
          child.removeAttribute('srcset');
        }
      });
    } else if (element instanceof HTMLSourceElement || element instanceof HTMLTrackElement) {
      const srcAttr = element.getAttribute('src');
      if (srcAttr && HTTP_URL_REGEX.test(srcAttr)) {
        element.removeAttribute('src');
        records.push({
          type: 'attribute',
          tagName: element.tagName,
          attribute: 'src',
          value: srcAttr,
        });
      }
      element.removeAttribute('srcset');
    } else if (element instanceof HTMLLinkElement) {
      const href = element.getAttribute('href');
      if (href && HTTP_URL_REGEX.test(href)) {
        records.push({
          type: 'attribute',
          tagName: element.tagName,
          attribute: 'href',
          value: href,
        });
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
        records.push({
          type: 'attribute',
          tagName: element.tagName,
          attribute: 'data',
          value: dataAttr,
        });
      }
      const srcAttr = element.getAttribute('src');
      if (srcAttr && HTTP_URL_REGEX.test(srcAttr)) {
        element.removeAttribute('src');
        records.push({
          type: 'attribute',
          tagName: element.tagName,
          attribute: 'src',
          value: srcAttr,
        });
      }
    }

    if (isHTMLElement(element) || isSVGElement(element)) {
      const style = element.style;
      const properties = collectUrlProperties(style);
      for (const property of properties) {
        const priority = style.getPropertyPriority(property);
        const value = style.getPropertyValue(property);
        if (!value) continue;

        if (shouldNeutralizeCssValue(value)) {
          const safeValue = getSafeReplacementValue(property);
          style.setProperty(property, safeValue, priority);
          records.push({
            type: 'style',
            tagName: element instanceof HTMLElement ? element.tagName : element.nodeName,
            property,
            value,
          });
        }
      }
    }

    return records;
  };

  const entries: ExternalReferenceEntry[] = [];
  entries.push(...processElement(root));
  root.querySelectorAll('*').forEach((element) => {
    entries.push(...processElement(element));
  });

  debugLog('Очистка внешних ссылок завершена', {
    neutralized: entries.length,
  });
  return entries;
}

function neutralizeComputedStyleUrls(root: Element): ExternalReferenceEntry[] {
  debugLog('Проверяем computed-стили на наличие внешних URL');
  const entries: ExternalReferenceEntry[] = [];
  const elements: Element[] = [];

  if (root instanceof Element) {
    elements.push(root);
  }

  root.querySelectorAll('*').forEach((node) => {
    if (node instanceof Element) {
      elements.push(node);
    }
  });

  let pseudoStyle: HTMLStyleElement | null = null;
  const ensurePseudoStyle = () => {
    if (pseudoStyle) return pseudoStyle;
    const style = document.createElement('style');
    style.setAttribute('data-screenshot-pseudo-override', 'true');
    style.textContent = TARGETED_PSEUDO_NEUTRALIZE_STYLE;
    if (root.firstChild) {
      root.insertBefore(style, root.firstChild);
    } else {
      root.appendChild(style);
    }
    pseudoStyle = style;
    return style;
  };

  const pseudoProperties = COMPUTED_URL_PROPERTIES.filter((prop) => prop !== 'content');

  for (const element of elements) {
    const computed = window.getComputedStyle(element);

    for (const property of COMPUTED_URL_PROPERTIES) {
      if (property === 'content') {
        continue;
      }
      const value = computed.getPropertyValue(property);
      if (!value || value === 'none' || value === 'auto') continue;
      if (value.indexOf('url(') === -1) continue;
      if (!shouldNeutralizeCssValue(value)) continue;

      if (isHTMLElement(element) || isSVGElement(element)) {
        const style = (element as HTMLElement | SVGElement).style;
        style.setProperty(property, getSafeReplacementValue(property), 'important');
        entries.push({
          type: 'computed',
          tagName: element instanceof HTMLElement ? element.tagName : element.nodeName,
          property,
          value,
        });
      }
    }

    const pseudoTargets: Array<['::before' | '::after', CSSStyleDeclaration]> = [
      ['::before', window.getComputedStyle(element, '::before')],
      ['::after', window.getComputedStyle(element, '::after')],
    ];

    for (const [pseudo, styles] of pseudoTargets) {
      for (const property of pseudoProperties) {
        const value = styles.getPropertyValue(property);
        if (!value || value === 'none' || value === 'auto') continue;
        if (value.indexOf('url(') === -1) continue;
        if (!shouldNeutralizeCssValue(value)) continue;
        ensurePseudoStyle();
        if (isHTMLElement(element)) {
          element.setAttribute('data-screenshot-pseudo-neutralize', 'true');
        }
        entries.push({
          type: 'pseudo',
          tagName: element instanceof HTMLElement ? element.tagName : element.nodeName,
          property: `${pseudo}:${property}`,
          value,
        });
        break;
      }
    }
  }

  debugLog('Проверка computed-стилей завершена', {
    neutralized: entries.length,
  });
  return entries;
}

function enableSafeMode(wrapper: Element) {
  debugLog('Активируем безопасный режим сериализации DOM');
  const style = document.createElement('style');
  style.setAttribute('data-screenshot-safe-mode', 'pseudo-neutralize');
  style.textContent = SAFE_MODE_PSEUDO_STYLE;
  if (wrapper.firstChild) {
    wrapper.insertBefore(style, wrapper.firstChild);
  } else {
    wrapper.appendChild(style);
  }
  sanitizeCanvasElements(wrapper);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  debugLog('Преобразуем canvas в Blob', {
    width: canvas.width,
    height: canvas.height,
  });
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          debugLog('Canvas вернул пустой Blob');
          reject(new Error('Не удалось сформировать изображение.'));
          return;
        }
        debugLog('Canvas успешно преобразован в Blob', {
          size: blob.size,
          type: blob.type,
        });
        resolve(blob);
      }, 'image/png');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') {
        debugLog('Получили SecurityError при toBlob', { message: error.message });
        reject(
          new DOMException(
            'Canvas оказался tainted при формировании PNG. Убедитесь, что все изображения и фоновые ресурсы доступны с текущего origin.',
            'SecurityError',
          ),
        );
        return;
      }
      debugLog('Неизвестная ошибка при преобразовании canvas', {
        error: error instanceof Error ? error.message : String(error),
      });
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function measure(node: HTMLElement) {
  debugLog('Измеряем элемент', {
    tagName: node.tagName,
  });
  const rect = node.getBoundingClientRect();
  const width = Math.max(Math.ceil(rect.width), node.offsetWidth, node.scrollWidth);
  const height = Math.max(Math.ceil(rect.height), node.offsetHeight, node.scrollHeight);
  debugLog('Результаты измерения элемента', { width, height });
  return { width, height };
}

export async function elementToCanvas(
  node: HTMLElement,
  options: ElementToImageOptions = {}
): Promise<HTMLCanvasElement> {
  debugLog('Запускаем elementToCanvas', {
    tagName: node.tagName,
    options,
  });
  const { filter, pixelRatio: requestedPixelRatio, backgroundColor, safeMode } = options;
  const clone = cloneNodeDeep(node, filter);
  if (!clone) {
    throw new Error('Элемент не содержит содержимого для копирования.');
  }

  const { width, height } = measure(node);
  if (!width || !height) {
    throw new Error('Не удалось определить размер элемента.');
  }

  debugLog('Готовим обёртку для foreignObject', { width, height });
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

  if (safeMode) {
    enableSafeMode(wrapper);
  }

  await embedImages(wrapper);
  const sanitizedAttributes = sanitizeExternalResources(wrapper);
  const sanitizedComputed = neutralizeComputedStyleUrls(wrapper);
  const sanitizedResidual = stripRemainingExternalReferences(wrapper);

  const neutralizedReport = [
    ...sanitizedAttributes,
    ...sanitizedComputed,
    ...sanitizedResidual,
  ];

  debugLog('Отчёт по нейтрализованным ссылкам перед сериализацией', {
    count: neutralizedReport.length,
    entries: neutralizedReport,
  });

  debugLog('Сериализуем DOM в SVG', { width, height });
  const serialized = new XMLSerializer().serializeToString(wrapper);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    debugLog('Загружаем SVG как изображение', { url });
    const img = await loadImage(url);
    const pixelRatio = Math.max(1, Math.min(requestedPixelRatio ?? (window.devicePixelRatio || 1), 3));
    debugLog('Создаём canvas и настраиваем контекст', { pixelRatio, width, height });
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
    debugLog('Canvas заполнен изображением', {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    });

    try {
      void ctx.getImageData(0, 0, 1, 1);
      debugLog('Проверка canvas на taint прошла успешно');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') {
        debugLog('Обнаружили tainted canvas при getImageData', {
          message: error.message,
        });
        throw new DOMException(
          'Canvas оказался tainted при формировании PNG. Убедитесь, что все изображения и фоновые ресурсы доступны с текущего origin.',
          'SecurityError',
        );
      }
      debugLog('Неизвестная ошибка при проверке canvas на taint', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error instanceof Error ? error : new Error(String(error));
    }

    return canvas;
  } finally {
    debugLog('Ревокаем blob URL', { url });
    URL.revokeObjectURL(url);
  }
}

export async function elementToBlob(
  node: HTMLElement,
  options?: ElementToImageOptions
): Promise<Blob> {
  debugLog('Старт elementToBlob', { tagName: node.tagName });
  const canvas = await elementToCanvas(node, options);
  debugLog('Canvas готов, преобразуем в Blob');
  return canvasToBlob(canvas);
}

export async function elementToPng(
  node: HTMLElement,
  options?: ElementToImageOptions
): Promise<string> {
  debugLog('Старт elementToPng', { tagName: node.tagName });
  const canvas = await elementToCanvas(node, options);
  debugLog('Canvas готов, преобразуем в dataURL');
  return canvas.toDataURL('image/png');
}
