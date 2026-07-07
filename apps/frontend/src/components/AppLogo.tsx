type AppLogoProps = {
  size?: number;
  className?: string;
  showWordmark?: boolean;
};

export default function AppLogo({ size = 28, className = "", showWordmark = false }: AppLogoProps) {
  return (
    <span className={`app-logo${className ? ` ${className}` : ""}`}>
      <svg
        className="app-logo-mark"
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <rect width="32" height="32" rx="8" fill="var(--color-brand, #354168)" />
        <path
          fill="var(--color-accent, #F1D664)"
          d="M8.5 8h4.2v6.4h6.6V8h4.2v16h-4.2v-6.8h-6.6V24H8.5V8z"
        />
      </svg>
      {showWordmark ? <span className="app-logo-wordmark">HKJC</span> : null}
    </span>
  );
}
