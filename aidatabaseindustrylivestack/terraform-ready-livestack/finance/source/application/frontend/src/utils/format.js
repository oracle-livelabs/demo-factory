export function formatNumber(n) {
  if (n == null) return '-';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

export function formatCurrency(n) {
  if (n == null) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(d) {
  if (!d) return '';
  const seconds = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function getMomentumColor(flag) {
  switch (flag) {
    case 'mega_viral': return '#C74634';
    case 'viral': return '#AA643B';
    case 'rising': return '#AA643B';
    default: return '#7A736E';
  }
}

export function getMomentumLabel(flag) {
  switch (flag) {
    case 'mega_viral': return 'Critical';
    case 'viral': return 'Escalating';
    case 'rising': return 'Elevated';
    case 'normal': return 'Normal';
    default: return flag ? String(flag).replaceAll('_', ' ') : '-';
  }
}

export function getMentionTypeLabel(type) {
  switch (type) {
    case 'inferred': return 'AI classified';
    case 'hashtag': return 'Monitoring feed';
    default: return type ? String(type).replaceAll('_', ' ') : '-';
  }
}

export function formatSignalSourceName(value, fallback = 'Unknown source') {
  const source = String(value || '').trim();
  if (!source) return fallback;
  if (source.startsWith('@')) {
    return source.slice(1).replaceAll('_', ' ');
  }
  return source;
}

export function getPlatformColor(platform) {
  switch (platform) {
    case 'instagram': return '#A36472';
    case 'tiktok': return '#4F7D7B';
    case 'twitter': return '#437C94';
    case 'youtube': return '#C74634';
    case 'threads': return '#796087';
    default: return '#6F757E';
  }
}

export function getPlatformLabel(platform) {
  switch (platform) {
    case 'instagram': return 'SEC bulletin';
    case 'tiktok': return 'Internal fraud alert';
    case 'twitter': return 'OCC/FINRA notice';
    case 'youtube': return 'Market data feed';
    case 'threads': return 'Branch operations advisory';
    default: return platform || 'Source';
  }
}
