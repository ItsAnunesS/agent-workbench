import symbol from "../../assets/branding/brand-kit-v1/01-logos/svg/awb-symbol-orange.svg";
import wordmark from "../../assets/branding/brand-kit-v1/01-logos/svg/awb-lockup-light.svg";

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <img
      className={`brand-symbol ${className}`}
      src={symbol}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

export function BrandWordmark({ className = "" }: { className?: string }) {
  return (
    <img
      className={`brand-wordmark ${className}`}
      src={wordmark}
      alt="Agent Workbench"
      draggable={false}
    />
  );
}
