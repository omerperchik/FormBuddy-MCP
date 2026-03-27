/**
 * Intelligent field matching engine.
 * Uses a multi-pass strategy: exact → alias → edit distance → substring.
 * Returns scored matches so callers can set confidence thresholds.
 */

export interface FieldMatch {
  detectedLabel: string;
  profileKey: string;
  score: number; // 0–1, where 1 is a perfect match
  method: "exact" | "alias" | "edit_distance" | "substring";
}

// ── Alias table ──
// Maps canonical field names to all known variants.
// Built from W-9, I-9, W-4, SF-86, DS-11, 1040, and common CRM field names.
const ALIASES: Record<string, string[]> = {
  name:           ["fullname", "full_name", "legalname", "legal_name", "printedname", "printed_name", "applicantname"],
  firstname:      ["first_name", "fname", "givenname", "given_name", "first"],
  middlename:     ["middle_name", "mname", "middleinitial", "middle_initial", "mi"],
  lastname:       ["last_name", "lname", "surname", "familyname", "family_name", "last"],
  email:          ["emailaddress", "email_address", "e_mail", "electronicmail"],
  phone:          ["phonenumber", "phone_number", "telephone", "tel", "mobile", "cell", "cellphone", "daytimephone"],
  address:        ["streetaddress", "street_address", "address1", "address_line_1", "addressline1", "mailingaddress", "homeaddress"],
  address2:       ["address_line_2", "addressline2", "apt", "apartment", "suite", "unit"],
  city:           ["town", "municipality", "locality"],
  state:          ["province", "region", "stateprovince", "state_province"],
  zip:            ["zipcode", "zip_code", "postalcode", "postal_code", "postcode"],
  country:        ["nation", "countrycode", "country_code"],
  ssn:            ["socialsecurity", "social_security", "socialsecuritynumber", "social_security_number", "taxid", "tax_id", "tin", "ein"],
  dob:            ["dateofbirth", "date_of_birth", "birthday", "birthdate", "birth_date"],
  company:        ["companyname", "company_name", "organization", "employer", "businessname", "business_name", "firmname"],
  title:          ["jobtitle", "job_title", "position", "role", "occupation"],
  signature:      ["sig", "sign", "signatureblock"],
  date:           ["currentdate", "current_date", "todaysdate", "signdate", "sign_date", "datesigned"],
  gender:         ["sex"],
  maritalstatus:  ["marital_status", "filingsstatus", "filing_status"],
  citizenship:    ["nationality", "countryofcitizenship"],
  passport:       ["passportnumber", "passport_number", "passportno"],
  license:        ["driverslicense", "drivers_license", "licensenumber", "license_number", "dlnumber"],
};

// Build reverse lookup: variant → canonical
const REVERSE_ALIASES = new Map<string, string>();
for (const [canonical, variants] of Object.entries(ALIASES)) {
  REVERSE_ALIASES.set(canonical, canonical);
  for (const v of variants) {
    REVERSE_ALIASES.set(v, canonical);
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toCanonical(s: string): string | null {
  return REVERSE_ALIASES.get(normalize(s)) ?? null;
}

/**
 * Levenshtein edit distance (Wagner-Fischer, O(mn)).
 */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

function editDistanceScore(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - editDistance(a, b) / maxLen;
}

/**
 * Match a single detected field label to the best profile key.
 * Returns null if no match meets the minimum threshold.
 */
export function matchField(
  detectedLabel: string,
  profileKeys: string[],
  minScore = 0.6
): FieldMatch | null {
  const normLabel = normalize(detectedLabel);
  let best: FieldMatch | null = null;

  for (const key of profileKeys) {
    const normKey = normalize(key);

    // Pass 1: Exact normalized match
    if (normLabel === normKey) {
      return { detectedLabel, profileKey: key, score: 1.0, method: "exact" };
    }

    // Pass 2: Alias resolution
    const canonLabel = toCanonical(normLabel);
    const canonKey = toCanonical(normKey);
    if (canonLabel && canonKey && canonLabel === canonKey) {
      const candidate: FieldMatch = { detectedLabel, profileKey: key, score: 0.95, method: "alias" };
      if (!best || candidate.score > best.score) best = candidate;
      continue;
    }

    // Pass 3: Edit distance
    const edScore = editDistanceScore(normLabel, normKey);
    if (edScore >= minScore) {
      const candidate: FieldMatch = { detectedLabel, profileKey: key, score: edScore, method: "edit_distance" };
      if (!best || candidate.score > best.score) best = candidate;
    }

    // Pass 4: Substring containment (lower priority)
    if (normLabel.length >= 3 && normKey.length >= 3) {
      if (normLabel.includes(normKey) || normKey.includes(normLabel)) {
        const subScore = Math.min(normLabel.length, normKey.length) / Math.max(normLabel.length, normKey.length) * 0.85;
        if (subScore >= minScore) {
          const candidate: FieldMatch = { detectedLabel, profileKey: key, score: subScore, method: "substring" };
          if (!best || candidate.score > best.score) best = candidate;
        }
      }
    }
  }

  return best;
}

/**
 * Match all detected fields against profile keys.
 * Each profile key is used at most once (greedy best-first assignment).
 */
export function matchAllFields(
  detectedLabels: string[],
  profileKeys: string[],
  minScore = 0.6
): { matched: FieldMatch[]; unmatched: string[] } {
  // Score all pairs
  const candidates: Array<FieldMatch & { _labelIdx: number }> = [];

  for (let i = 0; i < detectedLabels.length; i++) {
    for (const key of profileKeys) {
      const m = matchField(detectedLabels[i], [key], minScore);
      if (m) candidates.push({ ...m, _labelIdx: i });
    }
  }

  // Greedy assignment: best score first, no reuse
  candidates.sort((a, b) => b.score - a.score);
  const usedLabels = new Set<number>();
  const usedKeys = new Set<string>();
  const matched: FieldMatch[] = [];

  for (const c of candidates) {
    if (usedLabels.has(c._labelIdx) || usedKeys.has(c.profileKey)) continue;
    usedLabels.add(c._labelIdx);
    usedKeys.add(c.profileKey);
    matched.push({
      detectedLabel: c.detectedLabel,
      profileKey: c.profileKey,
      score: c.score,
      method: c.method,
    });
  }

  const unmatched = detectedLabels.filter((_, i) => !usedLabels.has(i));
  return { matched, unmatched };
}
