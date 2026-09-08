import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ShieldCheck, Download, Upload, FileArchive, CheckCircle2, AlertTriangle, Loader2, Play, X
} from 'lucide-react';
import { api } from '../utils/api';

const TERMINAL_STATUSES = new Set(['completed', 'complete', 'success', 'failed', 'error']);

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [String(value)];
}

function prettyStatus(value) {
  return String(value || 'pending')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function findValidationSummary(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: null, message: null, issues: [] };
  }

  const valid = payload.valid ?? payload.isValid ?? payload.success ?? null;
  const message = payload.message || payload.summary || null;
  const issues = [
    ...toArray(payload.errors),
    ...toArray(payload.issues),
    ...toArray(payload.warnings),
  ];

  return { valid, message, issues };
}

function extractIssuesFromError(error) {
  return [
    ...toArray(error?.errors),
    ...toArray(error?.warnings),
    ...toArray(error?.details?.errors),
    ...toArray(error?.details?.warnings),
  ];
}

export default function AdminEntry({
  onContinueDemo,
  onClose,
  mode = 'gate',
  activeDataset,
  onDatasetChanged,
}) {
  const isOverlay = mode === 'overlay';
  const [selectedFile, setSelectedFile] = useState(null);
  const [busyAction, setBusyAction] = useState(null);
  const [validation, setValidation] = useState(null);
  const [uploadResult, setUploadResult] = useState(null);
  const [jobState, setJobState] = useState(null);
  const [restorePreview, setRestorePreview] = useState(null);
  const [restoreReady, setRestoreReady] = useState(false);
  const statusTimerRef = useRef(null);
  const loadDataRef = useRef(null);
  const fileInputRef = useRef(null);

  const fileLabel = useMemo(() => {
    if (!selectedFile) return 'No ZIP selected';
    const kb = Math.round(selectedFile.size / 1024);
    return `${selectedFile.name} (${kb} KB)`;
  }, [selectedFile]);

  const datasetLabel = useMemo(() => {
    if (!activeDataset) return 'Seer demo data';
    const label = activeDataset.label || activeDataset.source || 'Seer demo data';
    const timestamp = activeDataset.updatedAt
      ? new Date(activeDataset.updatedAt).toLocaleString()
      : 'Unknown';
    return `${label} · ${timestamp}`;
  }, [activeDataset]);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearInterval(statusTimerRef.current);
    };
  }, []);

  async function pollStatus(jobId) {
    if (statusTimerRef.current) clearInterval(statusTimerRef.current);

    const tick = async () => {
      try {
        const status = await api.import.status(jobId);
        setJobState(status);
        const normalized = String(status?.status || '').toLowerCase();
        if (TERMINAL_STATUSES.has(normalized)) {
          if (statusTimerRef.current) {
            clearInterval(statusTimerRef.current);
          }
          statusTimerRef.current = null;
          setBusyAction(null);
          if (['completed', 'complete', 'success'].includes(normalized)) {
            onDatasetChanged?.();
          }
        }
      } catch (err) {
        setJobState({ status: 'error', message: err.message });
        if (statusTimerRef.current) clearInterval(statusTimerRef.current);
        statusTimerRef.current = null;
        setBusyAction(null);
      }
    };

    await tick();
    statusTimerRef.current = setInterval(tick, 2000);
  }

  async function handleDownloadTemplate() {
    try {
      setBusyAction('download');
      const { blob, filename } = await api.import.template();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setValidation({ valid: false, message: err.message, issues: extractIssuesFromError(err) });
    } finally {
      setBusyAction(null);
    }
  }

  function handleLoadOwnData() {
    loadDataRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.requestAnimationFrame(() => {
      fileInputRef.current?.focus();
    });
  }

  async function handleValidate() {
    if (!selectedFile) {
      setValidation({ valid: false, message: 'Select a ZIP file first.', issues: [] });
      return;
    }

    try {
      setBusyAction('validate');
      setUploadResult(null);
      setJobState(null);
      const result = await api.import.validate(selectedFile);
      setValidation(findValidationSummary(result));
      setRestorePreview(null);
      setRestoreReady(false);
    } catch (err) {
      setValidation({ valid: false, message: err.message, issues: extractIssuesFromError(err) });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleUpload() {
    if (!selectedFile) {
      setUploadResult({ success: false, message: 'Select a ZIP file first.' });
      return;
    }

    try {
      setBusyAction('upload');
      setUploadResult(null);
      setJobState(null);
      const result = await api.import.upload(selectedFile);
      setUploadResult({
        success: result.success ?? true,
        message: result.message || 'Import started.',
        jobId: result.jobId || null,
        issues: extractIssuesFromError(result),
      });
      if (result.jobId) {
        await pollStatus(result.jobId);
      } else {
        setBusyAction(null);
      }
    } catch (err) {
      setUploadResult({ success: false, message: err.message, issues: extractIssuesFromError(err) });
      setBusyAction(null);
    }
  }

  async function handleRestorePreview() {
    try {
      setBusyAction('restorePreview');
      setRestorePreview(null);
      setRestoreReady(false);
      const result = await api.import.restoreDemoPreview();
      setRestorePreview(findValidationSummary(result));
      setRestoreReady(result.valid !== false);
    } catch (err) {
      setRestorePreview({ valid: false, message: err.message, issues: extractIssuesFromError(err) });
      setRestoreReady(false);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRestoreDemo() {
    if (!restoreReady) return;
    try {
      setBusyAction('restore');
      setUploadResult(null);
      setJobState(null);
      const result = await api.import.restoreDemo();
      setUploadResult({
        success: result.success ?? true,
        message: result.message || 'Demo restore started.',
        jobId: result.jobId || null,
        issues: extractIssuesFromError(result),
      });
      if (result.jobId) {
        await pollStatus(result.jobId);
      } else {
        setBusyAction(null);
      }
    } catch (err) {
      setUploadResult({ success: false, message: err.message, issues: extractIssuesFromError(err) });
      setBusyAction(null);
    }
  }

  const statusTone = (() => {
    const normalized = String(jobState?.status || '').toLowerCase();
    if (normalized === 'failed' || normalized === 'error') return 'tone-red';
    if (normalized === 'completed' || normalized === 'complete' || normalized === 'success') return 'tone-pine';
    return 'tone-sienna';
  })();

  const isWorking = busyAction === 'validate' || busyAction === 'upload' || busyAction === 'restore' || busyAction === 'restorePreview';

  const headerEyebrow = isOverlay ? 'Dataset Tool' : 'Admin Entry';
  const headerContent = isOverlay ? 'Use Your Own Data' : 'Dataset Control';
  const headerDescription = isOverlay
    ? 'The demo dataset stays active by default. Upload your own v1 ZIP, validate it, or preview a restore before executing any replacement.'
    : 'Start on the seeded demo dataset, or load your own v1 ZIP before entering the experience.';
  const quickActionLabel = isOverlay ? 'Jump To Upload' : 'Load Your Own Data';

  return (
    <div
      className={`min-h-screen ${isOverlay ? 'flex items-center justify-center p-6' : 'flex items-center justify-center p-6'}`}
      style={{ background: 'var(--color-bg)' }}
    >
      <div
        className={`w-full max-w-5xl glass-card p-8 md:p-10 fade-in relative ${isOverlay ? 'mx-4' : ''}`}
      >
        {isOverlay && (
          <button
            className="absolute top-6 right-6 text-[var(--color-text-dim)] hover:text-white"
            onClick={onClose}
            aria-label="Close dataset manager"
          >
            <X size={18} />
          </button>
        )}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--color-text-dim)] mb-2">{headerEyebrow}</p>
            <h1 id={isOverlay ? 'dataset-tool-title' : undefined} className="text-3xl md:text-4xl font-black leading-tight flex items-center gap-3">
              <ShieldCheck className="text-[var(--color-accent)]" size={32} />
              {headerContent}
            </h1>
            <p className="mt-3 text-sm text-[var(--color-text-dim)] max-w-3xl">
              Active dataset: {datasetLabel}.
            </p>
            <p className="mt-2 text-sm text-[var(--color-text-dim)] max-w-3xl">
              {headerDescription}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button className="btn-ghost inline-flex items-center gap-2 self-start" onClick={handleLoadOwnData}>
              <Upload size={15} />
              {quickActionLabel}
            </button>
            {!isOverlay && (
              <button className="btn-primary inline-flex items-center gap-2 self-start" onClick={onContinueDemo}>
                <Play size={15} />
                Continue With The Demo
              </button>
            )}
          </div>
        </div>

        <div ref={loadDataRef} className="grid md:grid-cols-2 gap-6">
          <section className="glass-card p-5 space-y-4">
            <h2 className="text-lg font-bold">1. Download Template ZIP</h2>
            <p className="text-sm text-[var(--color-text-dim)]">
              Get the canonical schema package with required and optional CSV templates.
            </p>
            <button
              className="btn-ghost inline-flex items-center gap-2"
              disabled={busyAction === 'download'}
              onClick={handleDownloadTemplate}
            >
              {busyAction === 'download' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              Download Template ZIP
            </button>
          </section>

          <section className="glass-card p-5 space-y-4">
            <h2 className="text-lg font-bold">2. Select Completed ZIP</h2>
            <label
              htmlFor="import-zip"
              className="w-full cursor-pointer border border-dashed border-[var(--color-border)] rounded-lg p-4 block hover:border-[var(--color-accent)] transition-colors"
            >
              <div className="flex items-center gap-2 text-sm">
                <FileArchive size={16} />
                <span>{fileLabel}</span>
              </div>
              <p className="mt-2 text-xs text-[var(--color-text-dim)]">
                Select a `.zip` containing `manifest.json` and table CSV files.
              </p>
            </label>
            <input
              id="import-zip"
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setSelectedFile(file);
                setValidation(null);
                setUploadResult(null);
                setJobState(null);
                setRestorePreview(null);
                setRestoreReady(false);
              }}
            />
          </section>
        </div>

        <div className="mt-6 glass-card p-5">
          <h2 className="text-lg font-bold mb-4">3. Validate or Restore</h2>
          <div className="flex flex-wrap gap-3">
            <button
              className="btn-ghost inline-flex items-center gap-2"
              onClick={handleValidate}
              disabled={isWorking}
            >
              {busyAction === 'validate' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              Validate Upload
            </button>
            <button
              className="btn-primary inline-flex items-center gap-2"
              onClick={handleUpload}
              disabled={isWorking}
            >
              {busyAction === 'upload' ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              Upload Data
            </button>
          </div>
        </div>

        <div className="mt-6 glass-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Restore Seer Demo Data</h2>
            <span className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wide">Validate before run</span>
          </div>
          <p className="text-xs text-[var(--color-text-dim)]">
            Preview the demo dataset import to see row counts and warnings, then execute the restore to overwrite the current data.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              className="btn-ghost inline-flex items-center gap-2"
              onClick={handleRestorePreview}
              disabled={isWorking}
            >
              {busyAction === 'restorePreview' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              Preview Restore
            </button>
            <button
              className="btn-primary inline-flex items-center gap-2"
              onClick={handleRestoreDemo}
              disabled={isWorking || !restoreReady}
            >
              {busyAction === 'restore' ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              Restore Seer Demo Data
            </button>
          </div>
          {restorePreview && (
            <div className="border border-[var(--color-border)] rounded px-3 py-2 text-xs text-[var(--color-text-dim)]">
              <p className={restorePreview.valid === false ? 'tone-red' : 'tone-pine'}>
                {restorePreview.message || (restorePreview.valid ? 'Preview ready' : 'Preview flagged issues')}
              </p>
              {restorePreview.issues?.length > 0 && (
                <ul className="mt-2 space-y-1 list-disc pl-5">
                  {restorePreview.issues.slice(0, 6).map((issue, idx) => (
                    <li key={`${issue}-${idx}`}>{issue}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {(validation || uploadResult || jobState) && (
          <div className="mt-6 space-y-4">
            {validation && (
              <div className="rounded-lg border border-[var(--color-border)] p-3">
                <p className={`text-sm font-semibold ${validation.valid === false ? 'tone-red' : 'tone-pine'}`}>
                  {validation.valid === false ? 'Validation failed' : 'Validation result'}
                </p>
                {validation.message && <p className="text-xs text-[var(--color-text-dim)] mt-1">{validation.message}</p>}
                {validation.issues.length > 0 && (
                  <ul className="mt-2 text-xs text-[var(--color-text-dim)] space-y-1 list-disc pl-5">
                    {validation.issues.slice(0, 8).map((issue, idx) => (
                      <li key={`${issue}-${idx}`}>{issue}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {uploadResult && (
              <div className="rounded-lg border border-[var(--color-border)] p-3">
                <p className={`text-sm font-semibold ${uploadResult.success ? 'tone-pine' : 'tone-red'}`}>
                  {uploadResult.success ? 'Import request accepted' : 'Import failed'}
                </p>
                <p className="text-xs text-[var(--color-text-dim)] mt-1">{uploadResult.message}</p>
                {uploadResult.jobId && (
                  <p className="text-xs text-[var(--color-text-dim)] mt-1">
                    Job ID: <span className="font-mono">{uploadResult.jobId}</span>
                  </p>
                )}
                {uploadResult.issues?.length > 0 && (
                  <ul className="mt-2 text-xs text-[var(--color-text-dim)] space-y-1 list-disc pl-5">
                    {uploadResult.issues.slice(0, 8).map((issue, idx) => (
                      <li key={`${issue}-${idx}`}>{issue}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {jobState && (
              <div className="rounded-lg border border-[var(--color-border)] p-3">
                <p className={`text-sm font-semibold ${statusTone}`}>Status: {prettyStatus(jobState.status)}</p>
                {jobState.message && <p className="text-xs text-[var(--color-text-dim)] mt-1">{jobState.message}</p>}
                {jobState.progress != null && (
                  <div className="mt-3">
                    <div className="h-2 rounded bg-[var(--color-surface-hover)] overflow-hidden">
                      <div className="h-full bg-[var(--color-accent)] transition-all" style={{ width: `${Math.max(0, Math.min(100, Number(jobState.progress) || 0))}%` }} />
                    </div>
                    <p className="text-[11px] text-[var(--color-text-dim)] mt-1">{Number(jobState.progress) || 0}%</p>
                  </div>
                )}
                {(String(jobState.status || '').toLowerCase() === 'completed') && (
                  <button
                    className="btn-primary mt-3 inline-flex items-center gap-2"
                    onClick={isOverlay ? onClose : onContinueDemo}
                  >
                    <Play size={15} />
                    {isOverlay ? 'Close' : 'Enter Demo'}
                  </button>
                )}
                {(jobState.errors?.length > 0 || jobState.warnings?.length > 0) && (
                  <ul className="mt-3 text-xs text-[var(--color-text-dim)] space-y-1 list-disc pl-5">
                    {[...toArray(jobState.errors), ...toArray(jobState.warnings)].slice(0, 8).map((issue, idx) => (
                      <li key={`${issue}-${idx}`}>{issue}</li>
                    ))}
                  </ul>
                )}
                {(String(jobState.status || '').toLowerCase() === 'failed' || String(jobState.status || '').toLowerCase() === 'error') && (
                  <div className="mt-3 text-xs tone-red inline-flex items-center gap-2">
                    <AlertTriangle size={14} />
                    Review your ZIP and run validation again.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
