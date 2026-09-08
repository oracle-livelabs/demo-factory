import { useEffect, useState } from 'react';
import { AlertTriangle, Database, RefreshCw } from 'lucide-react';
import CopySecretButton from '../components/CopySecretButton';
import { JetButton } from '../components/JetControls';
import { api } from '../utils/api';

function SourceField({ label, value, copyLabel, unavailableTitle }) {
  const text = String(value || 'Not available');
  const canCopy = Boolean(value);

  return (
    <div className="data-source-field">
      <span>{label}</span>
      <div className="credential-copy-row">
        <code>{text}</code>
        <CopySecretButton
          value={value}
          label={copyLabel}
          disabled={!canCopy}
          unavailableTitle={unavailableTitle}
        />
      </div>
    </div>
  );
}

function DataSourceCard({ source }) {
  return (
    <article className="glass-card p-5 data-source-card">
      <div className="data-source-card__heading">
        <span className="data-source-card__icon" aria-hidden="true"><Database size={18} /></span>
        <div>
          <p>{source.engine}</p>
          <h3>{source.name}</h3>
        </div>
      </div>
      <div className="data-source-card__fields">
        <SourceField
          label="Connection string"
          value={source.connectionString}
          copyLabel={`${source.name} connection string`}
          unavailableTitle="Connection string is not available"
        />
        <SourceField
          label="User"
          value={source.username}
          copyLabel={`${source.name} username`}
          unavailableTitle="Username is not available"
        />
        <SourceField
          label="Password"
          value={source.password}
          copyLabel={`${source.name} password`}
          unavailableTitle="The shared DBPASSWORD is not available"
        />
      </div>
    </article>
  );
}

export default function DataSources() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadSources = async () => {
    setLoading(true);
    setError('');
    try {
      setResult(await api.dataSources.list());
    } catch (err) {
      setError(err.message || 'Data source details are unavailable.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSources();
  }, []);

  const sources = Array.isArray(result?.sources) ? result.sources : [];

  return (
    <div className="data-sources-page fade-in">
      <section className="data-sources-hero">
        <div>
          <p className="section-kicker">AI Lakehouse tools</p>
          <h2>Data Sources</h2>
          <p>
            Reuse these connection details in the next tutorial or integration. PostgreSQL and MySQL use the PG account and the shared DBPASSWORD. MongoDB is included when the custom image was built with AIHUB=true.
          </p>
        </div>
        <JetButton
          label="Refresh"
          iconClass="oj-fwk-icon oj-fwk-icon-refresh"
          chroming="outlined"
          disabled={loading}
          onAction={() => void loadSources()}
        />
      </section>

      {error ? (
        <section className="glass-card p-5 data-sources-error" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>Data source details are unavailable</strong>
            <p>{error}</p>
          </div>
        </section>
      ) : loading ? (
        <div className="data-sources-loading" role="status">
          <RefreshCw size={18} className="animate-spin" aria-hidden="true" />
          Loading source connection details…
        </div>
      ) : (
        <section className="data-sources-grid" aria-label="Source database connection details">
          {sources.map((source) => <DataSourceCard key={source.id} source={source} />)}
        </section>
      )}
    </div>
  );
}
