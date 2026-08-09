import { useRef, useState, type ReactNode } from "react";

const MARQUEE_SPEED_PX_PER_SECOND = 60;
const MARQUEE_HOVER_DELAY_MS = 250;

// Reveals overflowing text on hover by scrolling it left until the tail end
// is visible, then slides back when the pointer leaves. The idle state keeps
// the usual ellipsis truncation.
export function MarqueeText({ children, className }: { children: ReactNode; className?: string }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [scroll, setScroll] = useState<{ distance: number; durationMs: number } | null>(null);

  const startScroll = () => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    // scrollWidth reports the full text width even while it is ellipsized.
    const distance = content.scrollWidth - container.clientWidth;
    if (distance <= 0) return;
    setScroll({
      distance,
      durationMs: Math.max((distance / MARQUEE_SPEED_PX_PER_SECOND) * 1000, 300),
    });
  };

  return (
    <span
      ref={containerRef}
      onMouseEnter={startScroll}
      onMouseLeave={() => setScroll(null)}
      className={`overflow-hidden ${className ?? ""}`}
    >
      <span
        ref={contentRef}
        className={`whitespace-nowrap transition-transform ease-linear ${
          scroll ? "inline-block" : "block truncate"
        }`}
        style={{
          transform: scroll ? `translateX(-${scroll.distance}px)` : undefined,
          transitionDuration: scroll ? `${scroll.durationMs}ms` : "200ms",
          transitionDelay: scroll ? `${MARQUEE_HOVER_DELAY_MS}ms` : undefined,
        }}
      >
        {children}
      </span>
    </span>
  );
}
