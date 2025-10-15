export const GPT_IMAGE_KEYS = ['old', 'cryo'] as const;
export type GptImageKey = (typeof GPT_IMAGE_KEYS)[number];

export const GPT_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;
export type GptImageExtension = (typeof GPT_IMAGE_EXTENSIONS)[number];

const rawBase = process.env.NEXT_PUBLIC_GPT_IMAGES_BASE ?? '/static/';
export const GPT_IMAGES_BASE = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

export function buildGptImageUrl(
  id: string,
  key: GptImageKey,
  ext: GptImageExtension,
): string {
  return `${GPT_IMAGES_BASE}${id}_${key}.${ext}`;
}
