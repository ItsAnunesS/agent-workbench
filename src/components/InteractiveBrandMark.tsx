import { useEffect, useRef } from "react";
import { BrandMark } from "./Brand";

export function InteractiveBrandMark() {
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    import("./brand-scene")
      .then(({ mountBrandScene }) => {
        if (!cancelled && host.current) dispose = mountBrandScene(host.current);
      })
      .catch(() => {
        // Keep the bundled SVG visible if the optional renderer cannot load.
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);
  return (
    <span ref={host} className="interactive-brand" aria-hidden="true">
      <BrandMark />
    </span>
  );
}
