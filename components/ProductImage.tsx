import React, { useEffect, useState } from 'react';

interface ProductImageProps {
  src?: string;
  /** Что показать, если фото нет или оно не загрузилось */
  fallback: React.ReactNode;
  className?: string;
  alt?: string;
  loading?: 'lazy' | 'eager';
  draggable?: boolean;
}

/**
 * Фото товара с заглушкой.
 *
 * Без интернета фото, которого нет в кеше, не загрузится — и браузер нарисовал
 * бы на его месте значок «битой» картинки. Вместо него показываем ту же
 * заглушку, что у товара без фото, а когда сеть возвращается, пробуем снова:
 * фото появится само, без перезагрузки экрана.
 */
const ProductImage: React.FC<ProductImageProps> = ({
  src, fallback, className = '', alt = '', loading, draggable,
}) => {
  const [failed, setFailed] = useState(false);

  // Новый адрес — новая попытка
  useEffect(() => { setFailed(false); }, [src]);

  useEffect(() => {
    if (!failed) return;
    const retry = () => setFailed(false);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [failed]);

  if (!src || failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      decoding="sync"
      draggable={draggable}
      onError={() => setFailed(true)}
    />
  );
};

export default ProductImage;
