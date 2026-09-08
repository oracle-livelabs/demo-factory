let activeOperation = null;

function clone(value) {
  if (!value) return null;
  return JSON.parse(JSON.stringify(value));
}

function getActiveOperation() {
  return clone(activeOperation);
}

function beginOperation(metadata = {}) {
  if (activeOperation) {
    return null;
  }

  activeOperation = {
    kind: metadata.kind || 'dataset_operation',
    message: metadata.message || 'Dataset operation in progress.',
    startedAt: new Date().toISOString(),
    ...metadata,
  };

  return clone(activeOperation);
}

function updateOperation(patch = {}) {
  if (!activeOperation) return null;
  activeOperation = {
    ...activeOperation,
    ...patch,
  };
  return clone(activeOperation);
}

function endOperation() {
  const finished = clone(activeOperation);
  activeOperation = null;
  return finished;
}

module.exports = {
  beginOperation,
  updateOperation,
  endOperation,
  getActiveOperation,
};
