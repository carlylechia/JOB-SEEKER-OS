'use client';

import { useEffect, useRef, useState } from 'react';

export function DemoVideo() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShouldLoad(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: '220px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="relative overflow-hidden rounded-[1.5rem] border border-[#DFE3E9] bg-[#FFFFFF]">
      {shouldLoad ? (
        <video
          className="h-auto w-full"
          autoPlay
          loop
          muted
          playsInline
          preload="none"
          poster="/marketing/demo-video-poster.png"
        >
          <source src="/marketing/demo-loop.mp4" type="video/mp4" />
        </video>
      ) : (
        <img
          src="/marketing/demo-video-poster.png"
          alt="Product demo preview"
          className="h-auto w-full"
          loading="lazy"
        />
      )}
    </div>
  );
}
