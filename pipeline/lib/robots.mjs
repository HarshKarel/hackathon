// Minimal robots.txt support: groups by user-agent, Allow/Disallow with
// longest-match precedence, '*' wildcards and '$' anchors.

export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false;
      if (!current) continue;
      current.rules.push({ allow: field === 'allow', path: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function patternToRegex(p) {
  const anchored = p.endsWith('$');
  const body = (anchored ? p.slice(0, -1) : p)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

export function isAllowed(groups, token, pathWithQuery) {
  const t = token.toLowerCase();
  let group = groups.find((g) => g.agents.some((a) => a !== '*' && t.includes(a)));
  if (!group) {
    // Merge all '*' groups, as most crawlers do.
    const stars = groups.filter((g) => g.agents.includes('*'));
    if (!stars.length) return true;
    group = { rules: stars.flatMap((g) => g.rules) };
  }
  let best = null;
  for (const rule of group.rules) {
    if (rule.path === '') {
      // "Disallow:" with no path allows everything.
      continue;
    }
    if (patternToRegex(rule.path).test(pathWithQuery)) {
      const len = rule.path.length;
      if (!best || len > best.len || (len === best.len && rule.allow)) {
        best = { allow: rule.allow, len };
      }
    }
  }
  return best ? best.allow : true;
}
