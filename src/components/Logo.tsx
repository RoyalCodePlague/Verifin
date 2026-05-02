type LogoProps = {
  className?: string;
  title?: string;
};

export function Logo({ className = "h-10 w-auto", title = "Verifin" }: LogoProps) {
  return (
    <svg
      viewBox="0 0 560 140"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={className}
    >
      <polygon points="20,30 60,110 100,30 80,30 60,75 40,30" fill="hsl(var(--primary))" />
      <polygon points="60,75 70,110 60,110 52,90" fill="hsl(var(--accent))" />
      <text
        x="130"
        y="95"
        fontSize="64"
        fontWeight="700"
        letterSpacing="6"
        fill="currentColor"
        fontFamily="Arial, sans-serif"
      >
        VERIFIN
      </text>
    </svg>
  );
}
