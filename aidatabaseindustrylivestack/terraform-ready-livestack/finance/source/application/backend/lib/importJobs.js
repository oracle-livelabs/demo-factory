const jobs = new Map();

function nowIso() {
  return new Date().toISOString();
}

function cloneJob(job) {
  if (!job) return null;
  return JSON.parse(JSON.stringify(job));
}

function createJob(metadata = {}) {
  const jobId = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = nowIso();
  const job = {
    jobId,
    status: 'queued',
    progress: 0,
    message: 'Import queued',
    warnings: [],
    errors: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...metadata,
  };
  jobs.set(jobId, job);
  return cloneJob(job);
}

function updateJob(jobId, patch = {}) {
  const existing = jobs.get(jobId);
  if (!existing) return null;

  const next = {
    ...existing,
    ...patch,
    warnings: Array.isArray(patch.warnings) ? patch.warnings : existing.warnings,
    errors: Array.isArray(patch.errors) ? patch.errors : existing.errors,
    updatedAt: nowIso(),
  };

  jobs.set(jobId, next);
  return cloneJob(next);
}

function appendJobWarnings(jobId, warnings = []) {
  if (!warnings.length) return getJob(jobId);
  const existing = jobs.get(jobId);
  if (!existing) return null;
  const next = {
    ...existing,
    warnings: [...existing.warnings, ...warnings],
    updatedAt: nowIso(),
  };
  jobs.set(jobId, next);
  return cloneJob(next);
}

function appendJobErrors(jobId, errors = []) {
  if (!errors.length) return getJob(jobId);
  const existing = jobs.get(jobId);
  if (!existing) return null;
  const next = {
    ...existing,
    errors: [...existing.errors, ...errors],
    updatedAt: nowIso(),
  };
  jobs.set(jobId, next);
  return cloneJob(next);
}

function getJob(jobId) {
  return cloneJob(jobs.get(jobId));
}

module.exports = {
  createJob,
  updateJob,
  appendJobWarnings,
  appendJobErrors,
  getJob,
};
