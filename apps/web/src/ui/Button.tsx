import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Check } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-tide text-white hover:bg-deep disabled:bg-hairline disabled:text-slate',
  secondary: 'bg-white text-deep border border-hairline hover:bg-mist disabled:text-slate',
  ghost: 'bg-transparent text-tide hover:bg-mist disabled:text-slate',
  danger: 'bg-white text-danger border border-hairline hover:bg-mist disabled:text-slate',
  quiet: 'bg-transparent text-slate hover:text-deep hover:bg-mist',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  done?: boolean;
  icon?: ReactNode;
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`h-4 w-4 animate-spin ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, done, icon, children, className = '', disabled, type = 'button', ...rest },
  ref,
) {
  const h = size === 'sm' ? 'h-8 px-3 text-sm' : 'h-9 px-4 text-base';
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-ctl font-medium transition-colors duration-120 ease-std disabled:cursor-not-allowed ${h} ${VARIANT[variant]} ${className}`}
      {...rest}
    >
      {loading ? <Spinner /> : done ? <Check className="h-4 w-4" strokeWidth={2} aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-ctl text-slate transition-colors duration-120 hover:bg-mist hover:text-deep ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
