/**
 * OraclePanelContext - provides a context-driven right-panel slot.
 * Pages use <RegisterOraclePanel> to push content into the right panel.
 * <RightOraclePanel> reads and renders it.
 *
 * Two-context split:
 *  - SetCtx: stable setters (never re-renders consumers on content change)
 *  - ReadCtx: changing content (only re-renders the panel itself)
 */
import { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';

const OraclePanelSetCtx  = createContext(null); // stable write API
const OraclePanelReadCtx = createContext(null); // changing content

export function OraclePanelProvider({ children }) {
  const [content, setContent] = useState(null);
  const [title,   setTitle]   = useState('');

  // useState setters are stable references - safe to put in a ref once
  const settersRef = useRef({ setContent, setTitle });

  const readValue = useMemo(() => ({ content, title }), [content, title]);

  return (
    <OraclePanelSetCtx.Provider value={settersRef.current}>
      <OraclePanelReadCtx.Provider value={readValue}>
        {children}
      </OraclePanelReadCtx.Provider>
    </OraclePanelSetCtx.Provider>
  );
}

/** Hook for RightOraclePanel to read current content */
export function useOraclePanelCtx() {
  return useContext(OraclePanelReadCtx);
}

/**
 * Drop <RegisterOraclePanel title="…"> anywhere in a page's JSX tree.
 * It renders nothing itself - it registers children into the right panel
 * on mount and clears on unmount (page navigation).
 */
export function RegisterOraclePanel({ children, title }) {
  const { setContent, setTitle } = useContext(OraclePanelSetCtx);

  // Update content whenever children or title change (e.g. tab switches)
  useEffect(() => {
    setContent(children);
    setTitle(title || '');
  }, [children, title, setContent, setTitle]);

  // Clear on unmount (page navigation)
  useEffect(() => {
    return () => {
      setContent(null);
      setTitle('');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
