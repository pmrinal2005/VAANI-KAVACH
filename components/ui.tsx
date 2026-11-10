'use client'

import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Switch from '@radix-ui/react-switch'
import * as Tooltip from '@radix-ui/react-tooltip'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft, BellRing, Check, CheckCircle2, ChevronRight, CircleAlert, CircleHelp,
  ClipboardCheck, ClipboardList, FileClock, FileJson, Globe2, HandCoins, Headphones,
  Home, Languages, LockKeyhole, Menu, Mic2, Moon, PackageOpen, ReceiptText, Settings2,
  ShieldAlert, ShieldCheck, SlidersHorizontal, Sparkles, Sun, Volume2, WalletCards, X,
} from 'lucide-react'
import type { WorkflowId } from '@/lib/types'

export const workflowIcons: Record<WorkflowId, typeof ReceiptText> = {
  money_order: ReceiptText,
  service_request: HandCoins,
  instruction: BellRing,
  handover: ClipboardList,
  risk_review: ShieldAlert,
}

export const navItems = [
  { id: 'home', label: 'Home', description: 'Start a task', icon: Home },
  { id: 'capture', label: 'New voice session', description: 'Speak or type', icon: Mic2 },
  { id: 'records', label: 'My records', description: 'Confirmed this tab', icon: FileClock },
  { id: 'packs', label: 'Workflow packs', description: 'Live and planned', icon: PackageOpen },
  { id: 'languages', label: 'Languages', description: 'Hindi, English and more', icon: Languages },
  { id: 'voice', label: 'Consent & voice', description: 'Synthetic voice controls', icon: ShieldCheck },
  { id: 'usage', label: 'Usage & budget', description: 'Admin telemetry', icon: WalletCards },
  { id: 'settings', label: 'Accessibility', description: 'Display and audio', icon: Settings2 },
  { id: 'help', label: 'How it works', description: 'Guidance and limits', icon: CircleHelp },
] as const

export type PageId = typeof navItems[number]['id'] | 'replay'

export function Logo({ compact = false }: { compact?: boolean }) {
  return <div className="brand-lockup">
    <span className="brand-mark" aria-hidden="true"><ShieldCheck size={24} strokeWidth={1.8} /><span className="brand-sound"><i /><i /><i /></span></span>
    {!compact && <span><strong>Vaani Kavach</strong><small>Verified voice layer</small></span>}
  </div>
}

export function Badge({ tone = 'neutral', icon, children, className = '' }: { tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'offline'; icon?: ReactNode; children: ReactNode; className?: string }) {
  return <span className={`badge badge-${tone} ${className}`}>{icon}{children}</span>
}

export function WorkflowIcon({ workflow, size = 22 }: { workflow: WorkflowId; size?: number }) {
  const Icon = workflowIcons[workflow]
  return <span className={`workflow-icon workflow-${workflow}`} aria-hidden="true"><Icon size={size} strokeWidth={1.8} /></span>
}

export function Modal({ open, onOpenChange, title, description, children, className = '' }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode; className?: string }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay asChild forceMount>
        <AnimatePresence>{open && <motion.div className="dialog-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .18 }} />}</AnimatePresence>
      </Dialog.Overlay>
      <AnimatePresence>{open && <Dialog.Content asChild forceMount onOpenAutoFocus={(e) => e.preventDefault()}>
        <motion.section className={`dialog-card ${className}`} initial={{ opacity: 0, scale: .95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .95, y: 8 }} transition={{ duration: .2, ease: 'easeOut' }} aria-describedby={description ? undefined : undefined}>
          <div className="dialog-heading"><div><Dialog.Title>{title}</Dialog.Title>{description && <Dialog.Description>{description}</Dialog.Description>}</div><Dialog.Close className="icon-button" aria-label="Close dialog"><X size={20} /></Dialog.Close></div>
          {children}
        </motion.section>
      </Dialog.Content>}</AnimatePresence>
    </Dialog.Portal>
  </Dialog.Root>
}

export function Toggle({ checked, onCheckedChange, label, description, disabled = false, id }: { checked: boolean; onCheckedChange?: (v: boolean) => void; label: string; description?: string; disabled?: boolean; id: string }) {
  return <div className={`setting-row ${disabled ? 'is-disabled' : ''}`}>
    <label htmlFor={id}><strong>{label}</strong>{description && <span>{description}</span>}</label>
    <Switch.Root id={id} className="switch" checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label={label}><Switch.Thumb className="switch-thumb" /></Switch.Root>
  </div>
}

export function ProgressRing({ value, max, label, caption, locked = false, size = 'normal' }: { value: number; max: number; label?: string; caption?: string; locked?: boolean; size?: 'mini' | 'normal' }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  const r = size === 'mini' ? 15 : 48
  const dim = size === 'mini' ? 40 : 120
  const sw = size === 'mini' ? 3 : 8
  const c = 2 * Math.PI * r
  const level = pct < .15 ? 'danger' : pct < .35 ? 'warning' : 'accent'
  return <div className={`progress-ring-wrap ring-${size}`}>
    <div className={`progress-ring ring-${level}`}>
      <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} role="img" aria-label={`${label ?? 'Budget'}: ${Math.round(pct * 100)} percent remaining`}>
        <circle className="ring-track" cx={dim / 2} cy={dim / 2} r={r} fill="none" strokeWidth={sw} />
        <motion.circle className="ring-value" cx={dim / 2} cy={dim / 2} r={r} fill="none" strokeWidth={sw} strokeLinecap="round" strokeDasharray={c} initial={false} animate={{ strokeDashoffset: c * (1 - pct) }} transition={{ duration: .35, ease: 'easeOut' }} transform={`rotate(-90 ${dim / 2} ${dim / 2})`} />
      </svg>
      {size === 'normal' && <span className="ring-number">{locked ? <LockKeyhole size={22} aria-label="Manual release only" /> : <><strong>{Math.round(pct * 100)}</strong><small>%</small></>}</span>}
    </div>
    {(label || caption) && <div className="ring-copy">{label && <strong>{label}</strong>}{caption && <span>{caption}</span>}</div>}
  </div>
}

export function Waveform({ active = false, level = 0, bars = 28, label }: { active?: boolean; level?: number; bars?: number; label?: string }) {
  return <div className={`waveform ${active ? 'is-active' : ''}`} role="img" aria-label={label ?? (active ? 'Audio active' : 'Audio idle')}>
    {Array.from({ length: bars }, (_, i) => {
      const wave = .18 + Math.abs(Math.sin(i * .73)) * .52
      const h = active ? Math.min(1, wave + level * .7) : .12 + (i % 4) * .025
      return <i key={i} style={{ '--bar-height': `${Math.max(8, h * 100)}%`, '--bar-delay': `${(i % 7) * -70}ms` } as React.CSSProperties} />
    })}
  </div>
}

export function IconTip({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip.Provider delayDuration={300}><Tooltip.Root><Tooltip.Trigger asChild>{children}</Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip" sideOffset={8}>{label}<Tooltip.Arrow /></Tooltip.Content></Tooltip.Portal></Tooltip.Root></Tooltip.Provider>
}

export function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="section-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon ?? <ClipboardCheck size={30} />}</span><h3>{title}</h3><p>{description}</p>{action}</div>
}

export function BackButton({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return <button className="text-button back-button" onClick={onClick}><ArrowLeft size={17} />{label}</button>
}

export function InlineLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button className="inline-link" onClick={onClick}>{children}<ChevronRight size={15} /></button>
}

export const UiIcons = { Check, CheckCircle2, CircleAlert, FileJson, Globe2, Headphones, LockKeyhole, Menu, Moon, SlidersHorizontal, Sparkles, Sun, Volume2 }
