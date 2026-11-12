import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as D from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import * as T from '@radix-ui/react-tabs';
import { X } from 'lucide-react';
import { Button } from './Button';
import { Field, Textarea } from './form';
import { InlineError, useToast } from './feedback';

export function Dialog({ open, onOpenChange, title, description, children, footer, wide }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-deep/20 data-[state=open]:animate-[fadein_180ms]" />
        <D.Content
          className={`fixed left-1/2 top-[8vh] z-50 flex max-h-[84vh] w-[calc(100vw-24px)] -translate-x-1/2 flex-col rounded-dialog border border-hairline bg-white shadow-float focus:outline-none ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
        >
          <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-4">
            <div>
              <D.Title className="text-section font-semibold text-deep">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-slate">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="rounded-ctl p-1 text-slate hover:bg-mist hover:text-deep" aria-label="Close">
              <X className="h-4 w-4" strokeWidth={1.5} />
            </D.Close>
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer ? <div className="flex justify-end gap-2 border-t border-hairline px-6 py-3">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function Drawer({ open, onOpenChange, title, children, footer }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-deep/20" />
        <D.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(560px,100vw)] flex-col border-l border-hairline bg-white shadow-float transition-transform duration-240 ease-std focus:outline-none">
          <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
            <D.Title className="text-section font-semibold text-deep">{title}</D.Title>
            <D.Description className="sr-only">{title}</D.Description>
            <D.Close className="rounded-ctl p-1 text-slate hover:bg-mist hover:text-deep" aria-label="Close">
              <X className="h-4 w-4" strokeWidth={1.5} />
            </D.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer ? <div className="flex justify-end gap-2 border-t border-hairline px-6 py-3">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Confirmation that requires a reason (cancel bill, cancel payslip, reject). */
export function ReasonDialog({ open, onOpenChange, title, description, actionLabel, onConfirm, danger, label = 'Reason', minLength = 3, successText }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: ReactNode; actionLabel: string; onConfirm: (reason: string) => Promise<unknown>; danger?: boolean; label?: string; minLength?: number; successText: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);
  const short = reason.trim().length < minLength;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setReason('');
          setErr(null);
          setTouched(false);
        }
        onOpenChange(v);
      }}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Keep it</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            onClick={async () => {
              setTouched(true);
              if (short) return;
              setBusy(true);
              setErr(null);
              try {
                await onConfirm(reason.trim());
                toast.success(successText);
                void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
                setReason('');
                onOpenChange(false);
              } catch (e) {
                setErr(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {actionLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={label} htmlFor="reason" error={touched && short ? `Enter a ${label.toLowerCase()} of at least ${minLength} characters` : undefined}>
          <Textarea id="reason" autoFocus value={reason} invalid={touched && short} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <InlineError error={err} />
      </div>
    </Dialog>
  );
}

export function DropMenu({ trigger, items, align = 'end' }: { trigger: ReactNode; items: ({ label: string; onSelect: () => void; danger?: boolean } | 'sep')[]; align?: 'start' | 'end' }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align={align} sideOffset={6} className="z-50 min-w-[200px] rounded-panel border border-hairline bg-white p-1 shadow-float">
          {items.map((it, i) =>
            it === 'sep' ? (
              <Menu.Separator key={i} className="my-1 h-px bg-hairline" />
            ) : (
              <Menu.Item key={it.label} onSelect={it.onSelect} className={`cursor-pointer rounded-ctl px-3 py-2 text-base outline-none data-[highlighted]:bg-mist ${it.danger ? 'text-danger' : 'text-deep'}`}>
                {it.label}
              </Menu.Item>
            ),
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function Tabs<V extends string>({ value, onChange, items, label }: { value: V; onChange: (v: V) => void; items: { value: V; label: string; count?: number }[]; label: string }) {
  return (
    <T.Root value={value} onValueChange={(v) => onChange(v as V)}>
      <T.List aria-label={label} className="flex gap-1 overflow-x-auto">
        {items.map((it) => (
          <T.Trigger
            key={it.value}
            value={it.value}
            className="relative h-9 whitespace-nowrap px-3 text-base font-medium text-slate transition-colors duration-180 hover:text-deep data-[state=active]:text-deep data-[state=active]:after:absolute data-[state=active]:after:inset-x-3 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:bg-tide"
          >
            {it.label}
            {it.count !== undefined ? <span className="ml-1.5 text-meta text-slate">{it.count}</span> : null}
          </T.Trigger>
        ))}
      </T.List>
    </T.Root>
  );
}

/** Segmented switch for periods and toggles. */
export function Segmented<V extends string>({ value, onChange, items, label }: { value: V; onChange: (v: V) => void; items: { value: V; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-ctl border border-hairline p-0.5">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="radio"
          aria-checked={value === it.value}
          onClick={() => onChange(it.value)}
          className={`h-8 rounded-[4px] px-3 text-sm font-medium transition-colors duration-120 ${value === it.value ? 'bg-deep text-white' : 'text-slate hover:text-deep'}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
