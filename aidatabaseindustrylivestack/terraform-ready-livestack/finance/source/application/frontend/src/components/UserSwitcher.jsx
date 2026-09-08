import { useState, useRef, useEffect } from 'react';
import { useUser } from '../context/UserContext';
import { JetGlyph } from './JetControls';

export default function UserSwitcher() {
  const { currentUser, users, switchUser, loading, ROLE_META } = useUser();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (loading || !currentUser) return null;

  const roleMeta = ROLE_META[currentUser.ROLE] || ROLE_META.viewer;
  const initials = (currentUser.FULL_NAME || '')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all hover:bg-[var(--color-surface-muted)]"
        style={{ border: '1px solid var(--color-border)', borderRadius: '4px', background: 'var(--color-surface)' }}
      >
        <div
          className="w-8 h-8 flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{ background: roleMeta.color, color: '#FFFFFF', borderRadius: '4px' }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold truncate">{currentUser.FULL_NAME}</div>
          <div className="flex items-center gap-1.5">
            <span
              className="text-[9px] px-1.5 py-0.5 font-semibold"
              style={{
                background: 'var(--color-surface-muted)',
                color: 'var(--color-text)',
                border: `1px solid ${roleMeta.color}`,
                borderRadius: '2px',
              }}
            >
              {roleMeta.label}
            </span>
            {currentUser.REGION && (
              <span className="text-[9px] text-[var(--color-text-dim)] flex items-center gap-0.5">
                <JetGlyph iconClass="oj-fwk-icon-info" /> {currentUser.REGION}
              </span>
            )}
          </div>
        </div>
        <JetGlyph
          iconClass="oj-fwk-icon-arrowtail-e"
          className="text-[var(--color-text-dim)] flex-shrink-0 transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 bottom-full mb-1.5 w-full overflow-hidden shadow-2xl z-50"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
        >
          <div
            className="px-3 py-2 flex items-center gap-1.5"
            style={{ background: 'var(--color-surface-muted)', borderBottom: '1px solid var(--color-border)' }}
          >
            <JetGlyph iconClass="oj-fwk-icon-info" className="text-[var(--color-accent)]" />
            <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
              VPD Demo - Switch User
            </span>
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {users.map((user) => {
              const meta = ROLE_META[user.ROLE] || ROLE_META.viewer;
              const isActive = user.USERNAME === currentUser.USERNAME;
              const uInitials = (user.FULL_NAME || '')
                .split(' ')
                .map((n) => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2);
              return (
                <button
                  key={user.USERNAME}
                  onClick={() => { switchUser(user.USERNAME); setOpen(false); }}
                  className="w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors hover:bg-[var(--color-surface-muted)]"
                  style={isActive ? { background: `${meta.color}10` } : {}}
                >
                  <div
                    className="w-7 h-7 flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{ background: meta.color, color: '#FFFFFF', borderRadius: '4px' }}
                  >
                    {uInitials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
                        {user.FULL_NAME}
                      </span>
                      {isActive && (
                        <span
                          className="text-[7px] px-1 py-0.5 font-bold"
                          style={{
                            background: 'var(--color-surface-muted)',
                            color: 'var(--color-text)',
                            border: `1px solid ${meta.color}`,
                            borderRadius: '2px',
                          }}
                        >
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span
                        className="text-[8px] px-1 py-0.5 font-semibold"
                        style={{
                          background: 'var(--color-surface-muted)',
                          color: 'var(--color-text)',
                          border: `1px solid ${meta.color}`,
                          borderRadius: '2px',
                        }}
                      >
                        {meta.label}
                      </span>
                      {user.REGION && (
                        <span className="text-[8px] text-[var(--color-text-dim)]">
                          {user.REGION}
                        </span>
                      )}
                      {!user.REGION && user.ROLE !== 'fulfillment_mgr' && (
                        <span className="text-[8px] text-[var(--color-text-dim)] opacity-70">
                          All regions
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <div
            className="px-3 py-1.5 text-[8px] font-mono text-[var(--color-text-dim)]"
            style={{ background: 'var(--color-surface-muted)', borderTop: '1px solid var(--color-border)' }}
          >
            EXEC sc_security_ctx.set_user_context('{currentUser.USERNAME}');
          </div>
        </div>
      )}
    </div>
  );
}
