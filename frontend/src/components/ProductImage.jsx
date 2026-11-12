import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

// Product photo with a graceful fallback (store initial) when the URL is
// missing or the image fails to load. Store CDNs (Amazon, Flipkart) can reject
// hotlinked images that send a Referer, so we don't send one.
export default function ProductImage({ src, alt = '', fallbackText = '?', className, imgClassName }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])

  if (!src || failed) {
    return (
      <div className={cn('flex items-center justify-center bg-dark-600/60 overflow-hidden', className)}>
        <span className="text-3xl font-bold text-slate-700 select-none">
          {String(fallbackText || '?').charAt(0).toUpperCase()}
        </span>
      </div>
    )
  }

  return (
    <div className={cn('flex items-center justify-center bg-white overflow-hidden', className)}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn('max-h-full max-w-full object-contain', imgClassName)}
      />
    </div>
  )
}
