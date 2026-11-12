import { forwardRef, useEffect, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';

const CONTROL =
  'rounded-ctl border bg-white px-3 text-base text-deep placeholder:text-slate transition-colors duration-120 focus:border-tide focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-0 disabled:bg-mist disabled:text-slate';

export function Field({
  label,
  helper,
  error,
  children,
  htmlFor,
  className = '',
  required,
}: {
  label: string;
  helper?: ReactNode;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="label">
        {label}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-meta text-danger" role="alert">
          {error}
        </p>
      ) : helper ? (
        <p className="helper">{helper}</p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; align?: 'left' | 'right' };

const widthOf = (className: string) => (/(^|\s)w-/.test(className) ? '' : 'w-full');

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, align = 'left', className = '', ...rest }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={`h-9 ${widthOf(className)} ${CONTROL} ${invalid ? 'border-danger' : 'border-hairline'} ${align === 'right' ? 'text-right' : ''} ${className}`} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ invalid, className = '', children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`h-9 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9 ${widthOf(className)} ${CONTROL} ${invalid ? 'border-danger' : 'border-hairline'} ${className}`}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235B6878' stroke-width='1.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...rest}
    >
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ invalid, className = '', ...rest }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={`min-h-[76px] w-full py-2 ${CONTROL} ${invalid ? 'border-danger' : 'border-hairline'} ${className}`} {...rest} />;
});

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  const auto = useId();
  const sid = id ?? auto;
  return (
    <div className="flex items-center gap-3">
      <SwitchPrimitive.Root
        id={sid}
        checked={checked}
        onCheckedChange={onChange}
        className="relative h-5 w-9 shrink-0 rounded-full border border-hairline bg-mist transition-colors duration-120 data-[state=checked]:border-tide data-[state=checked]:bg-tide"
      >
        <SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white transition-transform duration-120 ease-std data-[state=checked]:translate-x-[17px]" style={{ border: '1px solid #DCE2EA' }} />
      </SwitchPrimitive.Root>
      <label htmlFor={sid} className="text-base text-deep">
        {label}
      </label>
    </div>
  );
}

export function Checkbox({ checked, onChange, label, id, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; id?: string; disabled?: boolean }) {
  const auto = useId();
  return (
    <label htmlFor={id ?? auto} className="inline-flex cursor-pointer items-center gap-2 text-base">
      <input id={id ?? auto} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded-[3px] border-hairline accent-tide" />
      {label}
    </label>
  );
}

/** Money is typed in rupees and stored as integer paise. */
export function MoneyInput({ value, onChange, invalid, id, placeholder = '0.00', disabled, allowNegative }: { value: number | undefined; onChange: (paise: number | undefined) => void; invalid?: boolean; id?: string; placeholder?: string; disabled?: boolean; allowNegative?: boolean }) {
  const [text, setText] = useState(value === undefined ? '' : (value / 100).toFixed(2));
  useEffect(() => {
    const cur = text.trim() === '' ? undefined : Math.round(Number(text) * 100);
    if (cur !== value) setText(value === undefined ? '' : (value / 100).toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate">₹</span>
      <Input
        id={id}
        inputMode="decimal"
        align="right"
        invalid={invalid}
        disabled={disabled}
        placeholder={placeholder}
        className="pl-7"
        value={text}
        onChange={(e) => {
          const v = e.target.value.replace(allowNegative ? /[^0-9.-]/g : /[^0-9.]/g, '');
          setText(v);
          const n = Number(v);
          onChange(v === '' || v === '-' || Number.isNaN(n) ? undefined : Math.round(n * 100));
        }}
        onBlur={() => {
          if (value !== undefined) setText((value / 100).toFixed(2));
        }}
      />
    </div>
  );
}

export function QtyInput({ value, onChange, invalid, id, ariaLabel, disabled, inputRef }: { value: number | undefined; onChange: (v: number | undefined) => void; invalid?: boolean; id?: string; ariaLabel?: string; disabled?: boolean; inputRef?: (el: HTMLInputElement | null) => void }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    if (value !== (text === '' ? undefined : Number(text))) setText(value === undefined ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      ref={inputRef}
      id={id}
      aria-label={ariaLabel}
      inputMode="decimal"
      align="right"
      invalid={invalid}
      disabled={disabled}
      value={text}
      onChange={(e) => {
        const v = e.target.value.replace(/[^0-9.]/g, '');
        setText(v);
        const n = Number(v);
        onChange(v === '' || Number.isNaN(n) ? undefined : Math.round(n * 1000) / 1000);
      }}
    />
  );
}

export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 | 4 }) {
  const c = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[cols];
  return <div className={`grid grid-cols-1 gap-x-6 gap-y-5 ${c}`}>{children}</div>;
}
