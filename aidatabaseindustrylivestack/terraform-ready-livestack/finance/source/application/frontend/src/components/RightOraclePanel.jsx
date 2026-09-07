import { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronRight, Database } from 'lucide-react';
import { useOraclePanelCtx } from '../context/OraclePanelContext';

const MIN_WIDTH = 280;
const MAX_WIDTH = 680;
const DEFAULT_WIDTH = 360;
const STORAGE_KEY = 'oraclePanel_width';
const COLLAPSED_W = 42;

function loadWidth() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) {
      const n = parseInt(v, 10);
      if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    }
  } catch {}
  return DEFAULT_WIDTH;
}

export default function RightOraclePanel() {
  const [collapsed, setCollapsed] = useState(true);
  const [width, setWidth] = useState(loadWidth);
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);
  const { content, title } = useOraclePanelCtx() || {};

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(width)); } catch {}
  }, [width]);

  useEffect(() => {
    setCollapsed(true);
  }, [title]);

  const onHandleMouseDown = useCallback((e) => {
    e.preventDefault();
    if (collapsed) return;
    startXRef.current = e.clientX;
    startWRef.current = width;
    setDragging(true);
  }, [collapsed, width]);

  useEffect(() => {
    if (!dragging) return;
    const onMouseMove = (e) => {
      const delta = startXRef.current - e.clientX;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWRef.current + delta));
      setWidth(next);
    };
    const onMouseUp = () => setDragging(false);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging]);

  useEffect(() => {
    document.body.style.cursor = dragging ? 'col-resize' : '';
    document.body.style.userSelect = dragging ? 'none' : '';
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging]);

  if (!content) return null;

  return (
    <aside
      className="flex-shrink-0 border-l flex flex-row relative"
      style={{
        width: collapsed ? COLLAPSED_W : width,
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        transition: dragging ? 'none' : 'width 0.2s ease'
      }}
    >
      {!collapsed && (
        <div
          onMouseDown={onHandleMouseDown}
          onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
          title="Drag to resize · Double-click to reset"
          className="absolute left-0 top-0 bottom-0 z-10 flex items-center group"
          style={{ width: 8, cursor: 'col-resize' }}
        >
          <div className="h-full" style={{ width: dragging ? 3 : 2, background: dragging ? '#c74634' : 'transparent' }} />
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(199,70,52,0.12)' }} />
        </div>
      )}

      <div className="flex flex-col flex-1 overflow-hidden" style={{ marginLeft: collapsed ? 0 : 8 }}>
        <button
          onClick={() => setCollapsed(v => !v)}
          className="flex items-center gap-2 px-3 py-3 border-b hover:bg-[var(--color-surface-muted)] transition-colors w-full flex-shrink-0"
          style={{ borderColor: 'var(--color-border)' }}
          title={collapsed ? 'Show Oracle Internals' : 'Collapse panel'}
        >
          {collapsed ? (
            <Database size={14} className="mx-auto text-[var(--color-accent)]" />
          ) : (
            <>
              <Database size={14} className="text-[var(--color-accent)] flex-shrink-0" />
              <span className="text-[10px] font-semibold tracking-wider uppercase flex-1 text-left truncate text-[var(--color-accent)]">
                Oracle Internals
              </span>
              {dragging && <span className="text-[9px] font-mono text-[var(--color-text-dim)] mr-1">{width}px</span>}
              <ChevronRight size={12} className="text-[var(--color-text-dim)] flex-shrink-0" />
            </>
          )}
        </button>

        {!collapsed && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs bg-[var(--color-surface-muted)]">
            {content}
          </div>
        )}
      </div>
    </aside>
  );
}
