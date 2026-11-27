/* Domain lock. Reads hosting.* from game.config.json.
   Unauthorised host => the game still loads completely, then after hosting.redirectDelayMs
   the visitor is sent to hosting.redirectUrl. */

const WILDCARD = '*.';

export function currentHost() {
  const loc = globalThis.location;
  if (!loc) return '';
  if (loc.protocol === 'file:') return 'file:';
  return String(loc.hostname || '').toLowerCase().replace(/\.$/, '');
}

function normalize(pattern) {
  return String(pattern || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

export function hostMatches(host, patternRaw) {
  const pattern = normalize(patternRaw);
  if (!pattern) return false;
  if (pattern === WILDCARD.slice(1) || pattern === '*') return true;
  if (pattern.startsWith(WILDCARD)) {
    const base = pattern.slice(2);
    return host === base || host.endsWith('.' + base);
  }
  return host === pattern;
}

export function isLocalhost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1'
    || host === 'file:' || host === '' || /^127\.\d+\.\d+\.\d+$/.test(host);
}

export function evaluateHost(cfg) {
  const hosting = cfg?.hosting || {};
  const host = currentHost();
  const patterns = (hosting.allowedHosts || []).map(normalize).filter(Boolean);
  const enforced = hosting.enforce !== false;
  const bypassParam = hosting.bypassUrlParam || 'hostcheck';
  const bypass = new URLSearchParams(globalThis.location?.search || '').get(bypassParam) === 'off';

  if (!enforced || bypass) return { allowed: true, host, reason: bypass ? 'url-bypass' : 'disabled', patterns };
  if (host === 'file:') {
    return { allowed: hosting.allowLocalFiles !== false, host, reason: 'local-file', patterns };
  }
  if (hosting.allowLocalFiles !== false && isLocalhost(host)) {
    return { allowed: true, host, reason: 'localhost', patterns };
  }
  const hit = patterns.some((p) => hostMatches(host, p));
  return { allowed: hit, host, reason: hit ? 'allowed-host' : 'unlisted-host', patterns };
}

/* Called once everything is loaded: show the notice, wait, then hand the visitor to the licensed domain. */
export function runHostLock(cfg, ui, onBlock) {
  const hosting = cfg?.hosting || {};
  const verdict = evaluateHost(cfg);
  if (verdict.allowed) return { ...verdict, active: false };

  const target = hosting.redirectUrl || 'https://pipygames.com/';
  const delay = Number.isFinite(hosting.redirectDelayMs) ? hosting.redirectDelayMs : 3000;
  const action = hosting.unauthorizedAction || 'redirect';

  if (ui?.noticeEl) {
    const dest = ui.noticeEl.querySelector('#host-dest-url');
    if (dest) dest.textContent = target;
  }
  if (hosting.showNoticeWhileWaiting !== false) ui?.showHost?.(target);
  if (hosting.blockGameplayUntilRedirect !== false) onBlock?.();

  if (action === 'stop') return { ...verdict, active: true, target, delay };
  const timer = setTimeout(() => {
    try { globalThis.location.replace(target); } catch { globalThis.location.href = target; }
  }, Math.max(0, delay));
  return { ...verdict, active: true, target, delay, timer };
}

export default { currentHost, hostMatches, evaluateHost, runHostLock };
