// ──────────────────────────────────────────────────────────────────────────────
// NameVerse — Indexability Gate
//
// WHY THIS EXISTS
// A meaningful share of the Islamic records (973 of 5,180) are honest stubs: the
// dataset explicitly states that no verified meaning or origin could be
// established for the form. Their content reads:
//
//   "No confident lexical sense is asserted."
//   "No verified linguistic origin was established for this form."
//   "The form could not be matched to a Tier-A/B source, so no gloss is asserted."
//
// Those are the RIGHT editorial position — inventing a meaning would be worse.
// But they are not indexable pages. Every one of them renders the same
// negative-assertion prose, so as a group they are near-duplicates of each
// other, and submitting them to Google is precisely what produces
// "Crawled — currently not indexed" at scale and drags down the domain's
// quality signal.
//
// THE RULE
// A page is indexable only when the record asserts a REAL meaning AND a REAL
// origin. Records whose meaning or origin is a negative assertion are served
// `noindex, follow` and excluded from the sitemap. They remain reachable and
// useful to a reader who lands on them, and they still pass link equity
// onward — they simply do not compete in the index.
//
// This module is the single source of truth for that decision. It is imported
// by the manifest generator, the sitemap route, the detail page and the
// uniqueness gate, so all four can never disagree.
// ──────────────────────────────────────────────────────────────────────────────

// Phrases the dataset uses to say "we could not verify this". Matched
// case-insensitively against the meaning and origin fields.
const NEGATIVE_ASSERTIONS = [
  /no confident lexical sense/i,
  /no meaning is asserted/i,
  /no gloss is asserted/i,
  /no verified linguistic origin/i,
  /no verified/i,
  /not objectively established/i,
  /meaning not objectively established/i,
  /not established/i,
  /could not be matched/i,
  /could not be verified/i,
  /no documented/i,
  /no editorial story/i,
  /not available for this form/i,
  /not available/i,
  /no ipa transcription is asserted/i,
  /no confident/i,
  /no reliable .* established/i,
  /no .* (?:found|established|asserted|identified|confirmed)/i,
  /no arabic/i,
  /no evidence/i,
  /unverified/i,
  /unconfirmed/i,
  /unspecified/i,
  /unknown/i,
];

/** True when a string is a negative assertion rather than a real value. */
export function isNegativeAssertion(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  // A bare placeholder is never a usable meaning or origin. For longer prose,
  // the patterns below intentionally catch an explicit failure to verify, but
  // callers should apply this gate to the primary value rather than rejecting a
  // well-supported meaning merely because its evidence notes mention a caveat.
  return NEGATIVE_ASSERTIONS.some((re) => re.test(s));
}

/**
 * Decide whether a record yields an indexable page.
 * Accepts either a normalized record or a manifest entry.
 */
function isGenericNameLabel(value) {
  const s = String(value || '').trim();
  if (!s) return true;

  // A record that says only "X; a female given name" identifies a name but
  // does not explain it. Those labels are useful provenance clues inside a
  // noindex profile, but publishing hundreds of them as substantive pages
  // creates a directory of interchangeable definitions. Keep a role or
  // relationship when it adds meaning (for example, "mother of Jesus"), while
  // excluding the label when it is the whole gloss.
  return (
    /^(?:[^;()]+;\s*)?(?:a|an|the)?\s*(?:[a-z]+\s+)?(?:male|female|unisex)?\s*(?:given|personal|first)\s+name(?:\s*\([^)]*\))?$/i.test(s) ||
    /^(?:[a-z]+\s+)?personal\s+name$/i.test(s) ||
    /^(?:a|an|the)?\s*(?:male|female|unisex)?\s*name\s*$/i.test(s)
  );
}

export function isIndexableRecord(rec) {
  if (!rec) return false;
  const meaning = rec.shortMeaning || rec.meaning || '';
  const origin = rec.origin || '';
  const longMeaning = rec.longMeaning || '';

  if (!meaning || !origin) return false;
  if (isNegativeAssertion(meaning)) return false;
  if (isNegativeAssertion(origin)) return false;
  if (isGenericNameLabel(meaning)) return false;

  // A populated headline is not enough when the source explicitly says the
  // identification is unresolved. Keep these records available as noindex
  // verification-pending profiles instead of submitting contradictory glosses.
  const confidence = String(rec.meaningConfidence || '').trim().toLowerCase();
  if (/^(low|very low|unverified|unknown)$/.test(confidence)) return false;
  if (/could not be matched|identification is uncertain|no confident lexical|gloss .*not.*verified/i.test(longMeaning)) {
    return false;
  }

  // A page also needs some substance beyond the two headline fields.
  const hasBody =
    Boolean(longMeaning) ||
    (Array.isArray(rec.meaningSection) && rec.meaningSection.length > 0) ||
    (Array.isArray(rec.faqs) && rec.faqs.length > 0);
  return hasBody;
}

const moduleApi = { isIndexableRecord, isNegativeAssertion };

export default moduleApi;
