import { Image } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { IMAGE_FALLBACK_SRC } from '@/utils/clothingLabels';
import {
  isImageSessionReady,
  markImageSessionFailed,
  markImageSessionReady,
  recordImageSessionMount,
  subscribeImageSession,
} from '@/utils/imageSessionCache';

interface SafeImageProps {
  className?: string;
  src?: string;
  cacheIdentity?: string;
  mode?: 'aspectFit' | 'aspectFill' | 'scaleToFill' | 'widthFix' | 'heightFix';
  lazyLoad?: boolean;
  onClick?: () => void;
}

export function SafeImage({
  className,
  src,
  cacheIdentity,
  mode = 'aspectFill',
  lazyLoad,
  onClick,
}: SafeImageProps) {
  const [currentSrc, setCurrentSrc] = useState(src || IMAGE_FALLBACK_SRC);
  const [ready, setReady] = useState(() => isImageSessionReady(src, cacheIdentity));
  const sourceRef = useRef(src);

  useEffect(() => {
    sourceRef.current = src;
    setCurrentSrc(src || IMAGE_FALLBACK_SRC);
    setReady(isImageSessionReady(src, cacheIdentity));
    return subscribeImageSession(src, cacheIdentity, (state) => {
      if (state === 'ready') setReady(true);
    });
  }, [cacheIdentity, src]);

  useEffect(() => recordImageSessionMount(), []);

  return (
    <Image
      className={`${className || ''}${ready ? ' image-session-ready' : ''}`.trim()}
      src={currentSrc}
      mode={mode}
      lazyLoad={lazyLoad}
      onClick={onClick}
      onLoad={() => {
        if (currentSrc === sourceRef.current) {
          markImageSessionReady(src, cacheIdentity);
          setReady(true);
        }
      }}
      onError={() => {
        markImageSessionFailed(src, cacheIdentity);
        setCurrentSrc(IMAGE_FALLBACK_SRC);
      }}
    />
  );
}
