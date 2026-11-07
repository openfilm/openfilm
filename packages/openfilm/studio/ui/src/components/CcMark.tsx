/** "CC" in a rounded box: a sound whose words are known (a transcript beside it), the captions' own mark. */
export function CcMark({ size = 13, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden className={className}>
      <rect x="1" y="3" width="14" height="10" rx="2.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7 6.4a2 2 0 1 0 0 3.2M12 6.4a2 2 0 1 0 0 3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
