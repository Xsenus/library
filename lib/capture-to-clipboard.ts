const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

type SnapshotOptions = {
  backgroundColor?: string;
  pixelRatio?: number;
  filter?: (element: Element) => boolean;
};

function cloneNodeWithInlineStyles(source: Element): Element {
  const clone = source.cloneNode(true) as Element;

  const walker = document.createTreeWalker(source, NodeFilter.SHOW_ELEMENT, null);
  const cloneWalker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT, null);

  let currentSource: Element | null = source;
  let currentClone: Element | null = clone;

  while (currentSource && currentClone) {
    inlineComputedStyles(currentSource, currentClone);

    currentSource = walker.nextNode() as Element | null;
    currentClone = cloneWalker.nextNode() as Element | null;
  }

  return clone;
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

async function elementToBlob(element: HTMLElement, options: SnapshotOptions = {}): Promise<Blob> {
  const { backgroundColor = '#ffffff', pixelRatio = Math.min(window.devicePixelRatio || 1, 2), filter } = options;

  const rect = element.getBoundingClientRect();
  const width = Math.max(Math.ceil(rect.width), 1);
  const height = Math.max(Math.ceil(rect.height), 1);

  const cloned = cloneNodeWithInlineStyles(element) as HTMLElement;
  pruneNodes(cloned, filter);

  cloned.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  cloned.style.width = `${width}px`;
  cloned.style.height = `${height}px`;
  cloned.style.boxSizing = 'border-box';

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

  foreignObject.appendChild(cloned);
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
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
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
