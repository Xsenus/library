'use client';

import React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

type IconName = 'bitrix' | 'catalog' | 'okved' | 'search';

type BaseProps = {
  icon: IconName;
  title?: string;
  className?: string;
  wrapperClassName?: string;
  href?: string;
  target?: string;
  rel?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  bordered?: boolean;
  padding?: number;
  objectFit?: 'contain' | 'cover';
  radiusClassName?: string;
  sizeClassName?: string;
  noHover?: boolean;
};

export default function SquareImgButton({
  icon,
  title,
  className,
  wrapperClassName,
  href,
  target = '_blank',
  rel = 'noopener noreferrer',
  onClick,
  bordered = false,
  padding = 0,
  objectFit = 'contain',
  radiusClassName = 'rounded-md',
  sizeClassName = 'h-7 w-7',
  noHover = false,
}: BaseProps) {
  const wrapperBase = 'relative inline-flex items-center justify-center align-middle select-none';
  const wrapper = cn(wrapperBase, wrapperClassName);

  const frame = cn(
    sizeClassName,
    radiusClassName,
    'relative',
    bordered ? 'border' : 'border-0',
    noHover ? '' : 'bg-background hover:bg-accent active:scale-[.98]',
    className,
  );

  const content = (
    <span className={frame} style={{ padding: padding > 0 ? `${padding}px` : undefined }}>
      <Image
        src={`/icons/${icon}.png`}
        alt={title || icon}
        fill
        sizes="32px"
        className={cn(
          'pointer-events-none',
          objectFit === 'cover' ? 'object-cover' : 'object-contain',
        )}
      />
    </span>
  );

  if (href) {
    return (
      <a href={href} target={target} rel={rel} title={title} aria-label={title} className={wrapper}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className={wrapper}>
      {content}
    </button>
  );
}
