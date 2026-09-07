import { useState } from 'react';
import { Database, ChevronDown } from 'lucide-react';

export default function OracleInfoPanel({ children }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost"
        type="button"
      >
        <Database size={13} className="text-[var(--color-accent)]" />
        <span>How Oracle Powers This</span>
        <ChevronDown
          size={12}
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className="mt-3 border overflow-hidden fade-in"
          style={{
            background: 'var(--color-surface)',
            borderColor: 'var(--color-border)',
            borderTopWidth: '2px',
            borderTopColor: 'var(--color-accent)',
            borderRadius: '6px'
          }}
        >
          <div
            className="flex items-center gap-2 px-5 py-3 border-b"
            style={{ background: 'var(--color-surface-muted)', borderColor: 'var(--color-border)' }}
          >
            <div className="w-6 h-6 flex items-center justify-center border" style={{ borderColor: 'rgba(199,70,52,0.22)', borderRadius: '4px' }}>
              <Database size={12} className="text-[var(--color-accent)]" />
            </div>
            <span className="text-xs font-semibold tracking-wider uppercase text-[var(--color-accent)]">
              Oracle AI Database 26ai Internals
            </span>
          </div>
          <div className="p-5">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

export function FeatureBadge({ label, color = 'blue' }) {
  const palettes = {
    orange: { accent: '#AA643B', background: 'rgba(170,100,59,0.12)', borderColor: 'rgba(170,100,59,0.28)' },
    blue: { accent: '#437C94', background: 'rgba(67,124,148,0.12)', borderColor: 'rgba(67,124,148,0.28)' },
    green: { accent: '#4F7D7B', background: 'rgba(79,125,123,0.12)', borderColor: 'rgba(79,125,123,0.28)' },
    purple: { accent: '#796087', background: 'rgba(121,96,135,0.12)', borderColor: 'rgba(121,96,135,0.28)' },
    cyan: { accent: '#4C825C', background: 'rgba(76,130,92,0.12)', borderColor: 'rgba(76,130,92,0.28)' },
    red: { accent: '#C74634', background: 'rgba(199,70,52,0.12)', borderColor: 'rgba(199,70,52,0.28)' },
    yellow: { accent: '#F0CC71', background: 'rgba(240,204,113,0.2)', borderColor: 'rgba(240,204,113,0.32)' },
    pink: { accent: '#A36472', background: 'rgba(163,100,114,0.12)', borderColor: 'rgba(163,100,114,0.28)' },
  };
  const tone = palettes[color] || palettes.blue;
  return (
    <span
      className="inline-block px-2 py-0.5 text-[10px] font-mono font-medium border"
      style={{
        background: tone.background,
        color: 'var(--color-text)',
        borderColor: tone.borderColor,
        borderRadius: '2px',
        boxShadow: `inset 0 2px 0 ${tone.accent}`,
      }}
    >
      {label}
    </span>
  );
}

export function SqlBlock({ code }) {
  return (
    <pre
      className="text-[10px] leading-relaxed font-mono p-3 overflow-x-auto"
      style={{
        background: 'var(--color-surface-muted)',
        color: 'var(--color-text)',
        border: '1px solid var(--color-border)',
        borderRadius: '4px',
        boxShadow: 'inset 3px 0 0 rgba(79,125,123,0.85)',
      }}
    >
      {code}
    </pre>
  );
}

export function DiagramBox({ label, sub, color = '#437C94', wide = false }) {
  return (
    <div
      className={`px-3 py-2 text-center border ${wide ? 'col-span-2' : ''}`}
      style={{
        borderColor: `${color}44`,
        background: 'var(--color-surface)',
        borderRadius: '4px',
        boxShadow: `inset 0 2px 0 ${color}`,
      }}
    >
      <div className="text-[10px] font-semibold" style={{ color: 'var(--color-text)' }}>{label}</div>
      {sub && <div className="text-[9px] mt-0.5" style={{ color: 'var(--color-text-dim)' }}>{sub}</div>}
    </div>
  );
}
