import { Image } from '@tarojs/components';
import { useEffect, useState } from 'react';
import { IMAGE_FALLBACK_SRC } from '@/utils/clothingLabels';

interface SafeImageProps {
  className?: string;
  src?: string;
  mode?: 'aspectFit' | 'aspectFill' | 'scaleToFill' | 'widthFix' | 'heightFix';
  lazyLoad?: boolean;
  onClick?: () => void;
}

export function SafeImage({
  className,
  src,
  mode = 'aspectFill',
  lazyLoad,
  onClick,
}: SafeImageProps) {
  const [currentSrc, setCurrentSrc] = useState(src || IMAGE_FALLBACK_SRC);

  useEffect(() => {
    setCurrentSrc(src || IMAGE_FALLBACK_SRC);
  }, [src]);

  return (
    <Image
      className={className}
      src={currentSrc}
      mode={mode}
      lazyLoad={lazyLoad}
      onClick={onClick}
      onError={() => setCurrentSrc(IMAGE_FALLBACK_SRC)}
    />
  );
}
