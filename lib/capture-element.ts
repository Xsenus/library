export interface CaptureOptions {
  /** Масштаб рендеринга */
  pixelRatio?: number;
  /** Цвет фона для SVG */
  backgroundColor?: string;
  /** Исключить элемент из снимка */
  exclude?: (element: Element) => boolean;
}

interface PrepareContext {
  resources: Promise<void>[];
  pseudoCss: string[];
  exclude?: (element: Element) => boolean;
}

const resourceCache = new Map<string, Promise<string | null>>();

function cssTextFromStyle(style: CSSStyleDeclaration): string {
  if (style.cssText && style.cssText !== '') return style.cssText;
  const declarations: string[] = [];
  for (let i = 0; i < style.length; i += 1) {
    const prop = style.item(i);
    const value = style.getPropertyValue(prop);
    declarations.push(`${prop}: ${value};`);
  }
  return declarations.join(' ');
}

function shouldExclude(element: Element, ctx: PrepareContext): boolean {
  if (ctx.exclude && ctx.exclude(element)) return true;
  if (element instanceof HTMLScriptElement) return true;
  return false;
}

function serializeCssValue(value: string): string {
  return value.replace(/\n+/g, ' ');
}

let pseudoIdCounter = 0;

function ensurePseudoSelector(clone: Element): string {
  const existing = clone.getAttribute('data-capture-id');
  if (existing) return existing;
  pseudoIdCounter += 1;
  const id = `capture-${pseudoIdCounter}`;
  clone.setAttribute('data-capture-id', id);
  return id;
}

function collectPseudoCss(original: Element, clone: Element, ctx: PrepareContext) {
  const pseudoTypes: Array<'::before' | '::after'> = ['::before', '::after'];
  for (const pseudo of pseudoTypes) {
    const style = window.getComputedStyle(original, pseudo);
    const content = style.getPropertyValue('content');
    if (!content || content === 'none') continue;
    const selectorId = ensurePseudoSelector(clone);
    ctx.pseudoCss.push(
      `[data-capture-id="${selectorId}"]${pseudo} { ${serializeCssValue(
        cssTextFromStyle(style),
      )} }`,
    );
  }
}

function cloneCanvas(original: HTMLCanvasElement, clone: Element) {
  try {
    const dataUrl = original.toDataURL();
    if (clone instanceof HTMLImageElement) {
      clone.src = dataUrl;
      clone.removeAttribute('srcset');
    } else if (clone instanceof HTMLCanvasElement) {
      const ctx = clone.getContext('2d');
      if (ctx) {
        const img = new Image();
        img.src = dataUrl;
        img.onload = () => {
          ctx.drawImage(img, 0, 0);
        };
      }
    }
  } catch (error) {
    console.error('Failed to clone canvas', error);
  }
}

function absoluteUrl(url: string): string {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

async function resourceToDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  const abs = absoluteUrl(url);
  if (resourceCache.has(abs)) return resourceCache.get(abs) ?? null;
  const promise = (async () => {
    try {
      const response = await fetch(abs, { mode: 'cors', credentials: 'include' });
      if (!response.ok) return null;
      const blob = await response.blob();
      return await blobToDataUrl(blob);
    } catch (error) {
      console.warn('Unable to inline resource', abs, error);
      return null;
    }
  })();
  resourceCache.set(abs, promise);
  return promise;
}

async function inlineImage(original: HTMLImageElement, clone: HTMLImageElement) {
  const src = original.currentSrc || original.src;
  const dataUrl = await resourceToDataUrl(src);
  if (dataUrl) {
    clone.src = dataUrl;
  }
  clone.removeAttribute('srcset');
  clone.removeAttribute('sizes');
}

const urlRegex = /url\((['"]?)(.*?)\1\)/g;

function inlineBackground(
  clone: HTMLElement,
  computedStyle: CSSStyleDeclaration,
  ctx: PrepareContext,
) {
  const value = computedStyle.getPropertyValue('background-image');
  if (!value || value === 'none') return;
  const matches = Array.from(value.matchAll(urlRegex));
  if (!matches.length) return;
  const tasks = matches.map(async (match) => {
    const raw = match[2];
    const dataUrl = await resourceToDataUrl(raw);
    return { raw: match[0], dataUrl };
  });
  ctx.resources.push(
    (async () => {
      const results = await Promise.all(tasks);
      let nextValue = value;
      for (const { raw, dataUrl } of results) {
        if (dataUrl) {
          nextValue = nextValue.replace(raw, `url("${dataUrl}")`);
        } else {
          nextValue = nextValue.replace(raw, 'none');
        }
      }
      clone.style.setProperty('background-image', nextValue);
    })(),
  );
}

function copyFormValue(original: Element, clone: Element) {
  if (original instanceof HTMLTextAreaElement) {
    clone.textContent = original.value;
  }
  if (original instanceof HTMLInputElement) {
    const inputClone = clone as HTMLInputElement;
    inputClone.value = original.value;
    if (original.checked) {
      inputClone.setAttribute('checked', 'true');
    } else {
      inputClone.removeAttribute('checked');
    }
  }
  if (original instanceof HTMLSelectElement) {
    const selectClone = clone as HTMLSelectElement;
    const options = Array.from(original.options);
    options.forEach((option) => {
      const cloneOption = Array.from(selectClone.options).find(
        (o) => o.value === option.value,
      );
      if (cloneOption) cloneOption.selected = option.selected;
    });
  }
}

function applyStyles(original: Element, clone: Element, ctx: PrepareContext) {
  const style = window.getComputedStyle(original);
  clone.setAttribute('style', serializeCssValue(cssTextFromStyle(style)));
  collectPseudoCss(original, clone, ctx);
  if (clone instanceof HTMLElement) {
    inlineBackground(clone, style, ctx);
  }
}

function prepareNode(original: Element, clone: Element, ctx: PrepareContext) {
  if (shouldExclude(original, ctx)) {
    clone.remove();
    return;
  }

  applyStyles(original, clone, ctx);
  copyFormValue(original, clone);

  if (original instanceof HTMLCanvasElement) {
    cloneCanvas(original, clone);
  }

  if (original instanceof HTMLImageElement && clone instanceof HTMLImageElement) {
    ctx.resources.push(inlineImage(original, clone));
  }

  const originalChildren = Array.from(original.childNodes);
  const cloneChildren = Array.from(clone.childNodes);

  originalChildren.forEach((child, index) => {
    const cloneChild = cloneChildren[index];
    if (!cloneChild) return;
    if (child.nodeType === Node.ELEMENT_NODE) {
      prepareNode(child as Element, cloneChild as Element, ctx);
    } else if (child.nodeType === Node.TEXT_NODE) {
      cloneChild.textContent = child.textContent ?? '';
    } else {
      cloneChild.parentNode?.removeChild(cloneChild);
    }
  });
}

function collectFontFaceCss(): string {
  const css: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | undefined;
    try {
      rules = sheet.cssRules;
    } catch (error) {
      continue;
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSFontFaceRule) {
        css.push(rule.cssText);
      }
    }
  }
  return css.join('\n');
}

function createSvgMarkup(
  width: number,
  height: number,
  clone: HTMLElement,
  backgroundColor: string,
  fontCss: string,
  pseudoCss: string,
): string {
  const serializer = new XMLSerializer();
  const serialized = serializer.serializeToString(clone);
  const styles = `${fontCss}\n${pseudoCss}`.trim();
  const styleTag = styles ? `<style>${styles}</style>` : '';
  const wrapper = `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;background:${backgroundColor};">${styleTag}${serialized}</div>`;
  const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%">${wrapper}</foreignObject></svg>`;
  return svg;
}

async function svgToPngBlob(svgMarkup: string, width: number, height: number, pixelRatio: number) {
  const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const loadPromise = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (event) => reject(event);
    });
    img.src = url;
    await loadPromise;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');
    ctx.scale(pixelRatio, pixelRatio);
    ctx.drawImage(img, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png', 1),
    );
    if (!blob) throw new Error('Не удалось создать изображение');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function captureElementToBlob(
  element: HTMLElement,
  options: CaptureOptions = {},
): Promise<Blob> {
  if (typeof window === 'undefined') {
    throw new Error('captureElementToBlob доступна только в браузере');
  }
  const rect = element.getBoundingClientRect();
  const width = Math.ceil(rect.width || element.offsetWidth || element.scrollWidth);
  const height = Math.ceil(rect.height || element.offsetHeight || element.scrollHeight);

  const clone = element.cloneNode(true) as HTMLElement;
  clone.style.margin = '0';
  clone.style.boxSizing = 'border-box';
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;

  const ctx: PrepareContext = {
    resources: [],
    pseudoCss: [],
    exclude: options.exclude,
  };

  prepareNode(element, clone, ctx);

  await Promise.all(ctx.resources);
  if ((document as Document & { fonts?: FontFaceSet }).fonts) {
    try {
      await (document as Document & { fonts: FontFaceSet }).fonts.ready;
    } catch {
      /* ignore */
    }
  }

  const pixelRatio = options.pixelRatio && options.pixelRatio > 0 ? options.pixelRatio : 2;
  const backgroundColor = options.backgroundColor || '#ffffff';
  const fontCss = collectFontFaceCss();
  const pseudoCss = ctx.pseudoCss.join('\n');
  const svgMarkup = createSvgMarkup(width, height, clone, backgroundColor, fontCss, pseudoCss);

  return svgToPngBlob(svgMarkup, width, height, pixelRatio);
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = (error) => {
      reject(error);
    };
    reader.readAsDataURL(blob);
  });
}
