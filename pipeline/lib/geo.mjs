// Country and location normalisation. Country is stored as an ISO 3166
// alpha-2 code plus an English display name.

const dn = new Intl.DisplayNames(['en'], { type: 'region' });

const NAME_OVERRIDES = {
  HK: 'Hong Kong', MO: 'Macao', MM: 'Myanmar', PS: 'Palestine', CI: "Cote d'Ivoire",
};
const SKIP = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ', 'AC', 'CP', 'DG', 'EA', 'IC', 'TA', 'CQ']);

const CODE_TO_NAME = new Map();
const NAME_TO_CODE = new Map();
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
for (const a of A) {
  for (const b of A) {
    const code = a + b;
    if (SKIP.has(code)) continue;
    let name;
    try { name = dn.of(code); } catch { continue; }
    if (!name || name === code || /pseudo|unknown|outlying/i.test(name)) continue;
    name = NAME_OVERRIDES[code] || name;
    CODE_TO_NAME.set(code, name);
    NAME_TO_CODE.set(key(name), code);
  }
}

function key(s) {
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

const ALIASES = {
  usa: 'US', us: 'US', unitedstatesofamerica: 'US', america: 'US',
  uk: 'GB', england: 'GB', scotland: 'GB', wales: 'GB', northernireland: 'GB', greatbritain: 'GB',
  turkey: 'TR', southkorea: 'KR', korea: 'KR', republicofkorea: 'KR', czechrepublic: 'CZ',
  uae: 'AE', russia: 'RU', russianfederation: 'RU', vietnam: 'VN', vietnamese: 'VN', hongkong: 'HK',
  hongkongsarchina: 'HK', macau: 'MO', burma: 'MM', ivorycoast: 'CI', holland: 'NL', thenetherlands: 'NL',
  deutschland: 'DE', bharat: 'IN', mainlandchina: 'CN', prc: 'CN', taiwanroc: 'TW', ksa: 'SA',
};
for (const [k, v] of Object.entries(ALIASES)) NAME_TO_CODE.set(k, v);

export function countryName(code) {
  return code ? CODE_TO_NAME.get(String(code).toUpperCase()) || null : null;
}

// Accepts a code ("IN"), a name ("India") or an alias ("USA").
export function toCountryCode(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^[A-Za-z]{2}$/.test(s) && CODE_TO_NAME.has(s.toUpperCase())) return s.toUpperCase();
  return NAME_TO_CODE.get(key(s)) || null;
}

const US_STATES = 'alabama al alaska ak arizona az arkansas ar california ca colorado co connecticut ct delaware de florida fl georgia ga hawaii hi idaho id illinois il indiana in iowa ia kansas ks kentucky ky louisiana la maine me maryland md massachusetts ma michigan mi minnesota mn mississippi ms missouri mo montana mt nebraska ne nevada nv newhampshire nh newjersey nj newmexico nm newyork ny northcarolina nc northdakota nd ohio oh oklahoma ok oregon or pennsylvania pa rhodeisland ri southcarolina sc southdakota sd tennessee tn texas tx utah ut vermont vt virginia va washington wa westvirginia wv wisconsin wi wyoming wy districtofcolumbia dc washingtondc'.split(' ');
const CA_PROVINCES = 'ontario on quebec qc britishcolumbia bc alberta ab manitoba mb saskatchewan sk novascotia ns newbrunswick nb newfoundlandandlabrador nl princeedwardisland pe yukon yt nunavut nu northwestterritories nt'.split(' ');
const IN_STATES = 'maharashtra karnataka tamilnadu telangana kerala gujarat rajasthan uttarpradesh westbengal delhi newdelhi haryana punjab bihar odisha andhrapradesh madhyapradesh assam goa jharkhand chhattisgarh uttarakhand himachalpradesh jammuandkashmir'.split(' ');
const AU_STATES = 'newsouthwales nsw victoria vic queensland qld westernaustralia southaustralia tasmania'.split(' ');

const US_SET = new Set(US_STATES);
const CA_SET = new Set(CA_PROVINCES);
const IN_SET = new Set(IN_STATES);
const AU_SET = new Set(AU_STATES);

// "San Francisco, California" / "Toronto, ON, Canada" / "Bengaluru, India"
export function parseLocationString(s) {
  if (!s) return { city: null, countryCode: null };
  const parts = String(s).split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { city: null, countryCode: null };
  const last = parts[parts.length - 1];
  let code = toCountryCode(last);
  // Two-letter tokens are usually US states or Canadian provinces, not
  // countries, when they follow a city.
  const lastKey = key(last);
  if (parts.length >= 2 && /^[A-Za-z]{2}$/.test(last)) {
    if (US_SET.has(lastKey)) code = 'US';
    else if (CA_SET.has(lastKey)) code = 'CA';
  }
  if (!code) {
    if (US_SET.has(lastKey)) code = 'US';
    else if (CA_SET.has(lastKey)) code = 'CA';
    else if (IN_SET.has(lastKey)) code = 'IN';
    else if (AU_SET.has(lastKey)) code = 'AU';
  }
  // City: the part just before the country, skipping one state or province
  // ("Toronto, ON, Canada" -> Toronto, "New York, NY, United States" -> New
  // York, "Venue, Kanglung, Bhutan" -> Kanglung). A lone state code is not a
  // city ("CA, USA" -> none).
  const isRegion = (p) => {
    const k = key(p);
    return US_SET.has(k) || CA_SET.has(k) || IN_SET.has(k) || AU_SET.has(k);
  };
  let city = null;
  if (!code) city = parts[0];
  else {
    const before = parts.slice(0, -1);
    if (before.length >= 2 && isRegion(before[before.length - 1])) city = before[before.length - 2];
    else if (before.length >= 1) city = before[before.length - 1];
    if (city && /^[A-Za-z]{2}$/.test(city) && isRegion(city)) city = null;
  }
  return { city: city || null, countryCode: code };
}

export function titleCaseCity(s) {
  if (!s) return null;
  const t = String(s).trim();
  // Only fix all-lowercase or all-uppercase names; leave mixed case alone.
  if (t === t.toLowerCase() || t === t.toUpperCase()) {
    return t.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }
  // "New delhi" -> "New Delhi", but keep particles like "de" in "Rio de Janeiro".
  return t.replace(/(^|\s)([a-z])([a-z]{3,})/g, (m, a, b, c) => a + b.toUpperCase() + c);
}
