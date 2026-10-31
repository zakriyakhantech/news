import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  readNameData,
  normalizeReligion,
  normalizeSlug,
  getKnownSlugsMap,
  getRenderableSlugs,
  getCanonicalSlug,
  isIndexableSlug,
} from '@/lib/data/names-data.js';
import { religionLabel, genderLabel, slugify, originSlugFor, ORIGIN_LABELS } from '@/lib/data/name-utils.js';
import { enrichNameProfile } from '@/lib/data/name-enricher.js';
import { isIndexableRecord } from '@/lib/data/indexability.js';
import AdSlot from '@/components/AdSlot.jsx';
import SocialShare from '@/components/SocialShare.jsx';
import NameTrustMeta from '@/components/NameTrustMeta.jsx';
import { AUTHOR } from '@/lib/data/editorial.js';
import { DEFAULT_SHARE_IMAGE } from '@/lib/seo.js';
import SaveNameButton from '@/components/SaveNameButton.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// FIX — Fluid Active CPU
//
// `dynamicParams = false` is the single most important line in this file.
//
// Previously this route declared `dynamicParams = true` and prerendered only the
// top 4,000 names. The remaining ~9,800 indexable name pages were rendered ON
// DEMAND: every request for one of them re-ran the full pipeline — read + parse
// the name JSON, normalise the source schema, run the enrichment engine
// (numerology, acrostic, FAQ generation, prose composition) and serialise
// ~100 KB of HTML. Measured cost was 60 ms of CPU for a cold render and ~6 ms
// warm, and a single crawler walking the sitemap could trigger thousands of
// them. That is what consumed 12h 15m of Fluid Active CPU against a 4h
// allowance in half a day.
//
// With `dynamicParams = false`, ONLY the paths returned by generateStaticParams
// exist. Every one of them is prerendered at build time, so a request is served
// from the CDN edge and costs ZERO Fluid Active CPU. A URL that is not in the
// list is a 404 — it can never fall through to an on-demand render.
//
// Build-time CPU is billed as build minutes, not as Fluid Active CPU, so moving
// the work to the build is what makes the cost disappear.
// ─────────────────────────────────────────────────────────────────────────────
export const dynamicParams = false;

const SITE_URL = 'https://nameverse.site';

// Prerender EVERY page that has real content to serve. The indexability gate
// decides which of those are submitted to Google; it no longer decides which
// ones exist. See lib/data/indexability.js.
export function generateStaticParams() {
  return getRenderableSlugs();
}

// ─────────────────────────────────────────────────────────────────────────────
// INDEXABILITY GATE
//
// A page is only worth indexing if it carries a real meaning AND a real origin.
// Records that fail this (the 352-record Italian stub set, plus a handful of
// incomplete entries elsewhere) are served with `noindex, follow` and are
// excluded from the sitemap. This is deliberate: publishing thousands of pages
// with no meaning is exactly what triggers Google's "Crawled — currently not
// indexed" classification, and it drags down the whole domain's quality signal.
// ─────────────────────────────────────────────────────────────────────────────
function isIndexable(n) {
  return isIndexableRecord(n);
}

function VerificationPendingProfile({ name, relLabel, religion, variants = [] }) {
  return (
    <div className="container-page py-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <nav className="mb-6 flex flex-wrap items-center gap-2 text-sm text-nv-text-secondary" aria-label="Breadcrumb">
          <Link href="/" className="font-medium hover:text-nv-accent">Home</Link>
          <span aria-hidden="true">/</span>
          <Link href="/names" className="font-medium hover:text-nv-accent">All Names</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/names/${religion}`} className="font-medium hover:text-nv-accent">{relLabel} Names</Link>
          <span aria-hidden="true">/</span>
          <span className="font-medium text-nv-text">{name}</span>
        </nav>

        <article className="card p-6 sm:p-10">
          <span className="badge border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300">
            Verification pending
          </span>
          <h1 className="mt-4 break-words font-display text-4xl font-extrabold tracking-tight text-nv-text sm:text-5xl">
            {name}
          </h1>
          <p className="mt-4 text-base leading-relaxed text-nv-text-secondary sm:text-lg">
            NameVerse has a source record for <strong>{name}</strong> in the {relLabel.toLowerCase()}{' '}
            collection, but we cannot currently verify a stable meaning and origin for this spelling.
            We do not invent an etymology, so this page is kept out of search results until the record
            can meet our publication standard.
          </p>

          <dl className="mt-8 grid gap-3 sm:grid-cols-2">
            <div className="stat-tile">
              <dt className="stat-label">Tradition collection</dt>
              <dd className="stat-value">{relLabel}</dd>
            </div>
            <div className="stat-tile">
              <dt className="stat-label">Profile status</dt>
              <dd className="stat-value">Research in progress</dd>
            </div>
          </dl>

          {variants.length > 0 && (
            <div className="mt-7">
              <h2 className="font-display text-xl font-bold text-nv-text">Recorded spelling variants</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {variants.map((variant) => (
                  <span key={variant} className="chip">{variant}</span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-8 border-t border-nv-border pt-6">
            <p className="text-sm leading-relaxed text-nv-text-secondary">
              Browse published profiles in this tradition or search for another spelling while our
              editorial team continues the source review.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href={`/names/${religion}`} className="btn-primary">
                Browse {relLabel} names
              </Link>
              <Link href="/search" className="btn-ghost">
                Search all names
              </Link>
              <Link href="/editorial-policy" className="btn-ghost">
                Read our editorial policy
              </Link>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}

export async function generateMetadata({ params }) {
  const finalReligion = normalizeReligion(params.religion);
  const normalizedSlug = normalizeSlug(params.slug);
  if (!finalReligion || !normalizedSlug) return {};

  const raw = await readNameData(finalReligion, normalizedSlug);
  if (!raw) return {};

  const n = enrichNameProfile(raw);
  const indexable = isIndexable(n);

  // Canonical consolidation. When this record is a duplicate of another record
  // (same name under a different transliteration), the manifest marks it with
  // `canonicalSlug`. The page then points its canonical at the surviving page
  // and is served noindex, so the two never compete for the same query.
  const entry = getKnownSlugsMap().get(`${finalReligion}:${normalizedSlug}`);
  const canonicalSlug = entry?.canonicalSlug || null;
  const canonicalUrl = canonicalSlug
    ? `${SITE_URL}/names/${finalReligion}/${canonicalSlug}`
    : `${SITE_URL}/names/${finalReligion}/${normalizedSlug}`;
  const shouldIndex = indexable && !canonicalSlug;

  return {
    title: n.seo.title,
    description: n.seo.meta_description,
    alternates: { canonical: canonicalUrl },
    robots: shouldIndex
      ? { index: true, follow: true, 'max-snippet': -1, 'max-image-preview': 'large' }
      : { index: false, follow: true },
    openGraph: {
      title: n.seo.title,
      description: n.seo.meta_description,
      url: canonicalUrl,
      type: 'website',
      siteName: 'NameVerse',
      locale: 'en_US',
      images: [{ ...DEFAULT_SHARE_IMAGE, alt: `${n.name} name meaning` }],
    },
    twitter: {
      // summary_large_image, matching the rest of the site — a name page is a
      // visual share and the small square thumbnail wasted the slot.
      card: 'summary_large_image',
      title: n.seo.title,
      description: n.seo.meta_description,
      images: [DEFAULT_SHARE_IMAGE.url],
    },
  };
}

export default async function NameDetailPage({ params }) {
  const finalReligion = normalizeReligion(params.religion);
  const normalizedSlug = normalizeSlug(params.slug);
  if (!finalReligion || !normalizedSlug) notFound();

  const raw = await readNameData(finalReligion, normalizedSlug);
  if (!raw) notFound();

  const n = enrichNameProfile(raw);
  const knownSlugsMap = getKnownSlugsMap();

  const relLabel = n.religionLabel;
  const entry = knownSlugsMap.get(`${finalReligion}:${normalizedSlug}`);
  const canonicalSlug = entry?.canonicalSlug || null;
  const canonicalUrl = canonicalSlug
    ? `${SITE_URL}/names/${finalReligion}/${canonicalSlug}`
    : `${SITE_URL}/names/${finalReligion}/${normalizedSlug}`;
  // A record with no gender is "not recorded", never silently "Unisex".
  const genLabel = n.genderKey ? genderLabel(n.genderKey) : 'Not recorded';
  const indexable = isIndexable(n) && !canonicalSlug;

  const firstLetter = n.name.trim().charAt(0).toLowerCase();
  const letterSegment = /^[a-z]$/.test(firstLetter) ? firstLetter : '%23';
  const letterDisplay = /^[a-z]$/.test(firstLetter) ? firstLetter.toUpperCase() : 'Other';

  // Real source records that do not yet meet the publication standard remain
  // accessible as honest noindex profiles instead of returning a misleading
  // 404. Canonical duplicates still use the full profile template below so
  // their canonical link can pass equity to the surviving page.
  if (!indexable && !canonicalSlug) {
    return (
      <VerificationPendingProfile
        name={n.name}
        relLabel={relLabel}
        religion={finalReligion}
        variants={n.variants}
      />
    );
  }

  // ── internal linking: resolve similar/related names to real pages ─────────
  function resolveNameLink(rawName) {
    const targetSlug = slugify(rawName);
    if (!targetSlug) return null;
    // Only link to a page that will actually render. `knownSlugsMap` lists
    // every record in the dataset, including the canonical duplicates and
    // content-free stubs that the detail route deliberately does not
    // prerender; because the route sets `dynamicParams = false`, each of those
    // is a hard 404 rather than an on-demand render. NameCard already applied
    // this guard — the related-name chips did not, which is how
    // /names/islamic/adem shipped a link to the 404 /names/islamic/man.
    if (isIndexableSlug(finalReligion, targetSlug)) {
      return {
        name: rawName,
        href: `/names/${finalReligion}/${getCanonicalSlug(finalReligion, targetSlug)}`,
      };
    }
    for (const r of ['islamic', 'christian', 'hindu', 'italian']) {
      if (r !== finalReligion && isIndexableSlug(r, targetSlug)) {
        return { name: rawName, href: `/names/${r}/${getCanonicalSlug(r, targetSlug)}` };
      }
    }
    return { name: rawName, href: null };
  }

  const similarNames = (n.similar || []).slice(0, 12).map(resolveNameLink).filter(Boolean);
  const relatedNames = (n.related || []).slice(0, 12).map(resolveNameLink).filter(Boolean);
  const originSlug = originSlugFor(n.origin);

  // ── structured data ───────────────────────────────────────────────────────
  const nameSchema = {
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    '@id': `${canonicalUrl}#name`,
    name: n.name,
    alternateName: n.variants.length ? n.variants : undefined,
    description: n.shortMeaning
      ? `${n.name} is a ${relLabel} name meaning "${n.shortMeaning}".`
      : undefined,
    inDefinedTermSet: {
      '@type': 'DefinedTermSet',
      name: `${relLabel} baby names`,
      url: `${SITE_URL}/names/${finalReligion}`,
    },
  };

  // No Article node here. This used to emit an Article whose datePublished and
  // dateModified were the single site-wide editorial date for all 11,412
  // profiles, citing only our own policy page. A reference profile is better
  // described as a WebPage whose main entity is the DefinedTerm, and no date is
  // better than a date that is not this record's.
  const webPageSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${canonicalUrl}#webpage`,
    name: n.seo.h1,
    description: n.seo.meta_description,
    url: canonicalUrl,
    inLanguage: 'en',
    isPartOf: { '@id': `${SITE_URL}/#website` },
    publisher: { '@id': `${SITE_URL}/#organization` },
    author: {
      '@type': AUTHOR.isOrganisation ? 'Organization' : 'Person',
      name: AUTHOR.name,
      url: AUTHOR.bioUrl,
    },
    mainEntity: { '@id': `${canonicalUrl}#name` },
  };

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'All Names', item: `${SITE_URL}/names` },
      { '@type': 'ListItem', position: 3, name: `${relLabel} Names`, item: `${SITE_URL}/names/${finalReligion}` },
      {
        '@type': 'ListItem',
        position: 4,
        name: `Names starting with ${letterDisplay}`,
        item: `${SITE_URL}/names/${finalReligion}/letter/${letterSegment}`,
      },
      { '@type': 'ListItem', position: 5, name: n.name },
    ],
  };

  const faqSchema = n.faqs.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: (n.faqs || []).slice(0, 10).map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      }
    : null;

  const hasScripture =
    n.religionCtx.isQuranic ||
    n.religionCtx.isBiblical ||
    n.religionCtx.isSaint ||
    n.religionCtx.isVedic ||
    n.religionCtx.isHadith ||
    n.religionCtx.isProphetic ||
    n.religionCtx.isCompanion;

  return (
    <div className="container-page py-6 sm:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(nameSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      {faqSchema && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      )}

      <div className="mx-auto max-w-5xl space-y-6">
        {/* Breadcrumb */}
        <nav className="flex flex-wrap items-center gap-2 text-xs text-nv-text-secondary sm:text-sm" aria-label="Breadcrumb">
          <Link href="/" className="font-medium transition hover:text-nv-accent">Home</Link>
          <span aria-hidden="true">/</span>
          <Link href="/names" className="font-medium transition hover:text-nv-accent">All Names</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/names/${finalReligion}`} className="font-medium transition hover:text-nv-accent">
            {relLabel} Names
          </Link>
          <span aria-hidden="true">/</span>
          <Link href={`/names/${finalReligion}/letter/${letterSegment}`} className="font-medium transition hover:text-nv-accent">
            {letterDisplay}
          </Link>
          <span aria-hidden="true">/</span>
          <span className="font-medium text-nv-text">{n.name}</span>
        </nav>

        {/* ── HERO — primary keyword (the name) sits above the fold on mobile ── */}
        <header className="card border-nv-border/80 p-6 shadow-sm sm:p-8 lg:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex-1">
              <span className="badge border border-nv-border bg-nv-accent-subtle text-nv-accent">
                {relLabel} Name Meaning
              </span>
              <h1 className="mt-3 break-words font-display text-3xl font-extrabold tracking-tight text-nv-text sm:text-4xl lg:text-5xl">
                {n.seo.h1}
              </h1>
              {n.shortMeaning && (
                <p className="mt-3 text-lg font-medium leading-relaxed text-nv-text-secondary sm:text-xl">
                  &ldquo;{n.shortMeaning}&rdquo;
                </p>
              )}
              {n.pronunciation.english && (
                <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-nv-text-secondary">
                  <span className="font-semibold text-nv-text">Pronunciation:</span>
                  <span className="font-mono text-nv-text">{n.pronunciation.english}</span>
                  {n.pronunciation.ipa && <span className="text-nv-text-muted">({n.pronunciation.ipa})</span>}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {n.genderKey && (
                <Link
                  href={`/${finalReligion}-${n.genderKey === 'unisex' ? 'boy' : n.genderKey}-names`}
                  className="chip"
                >
                  {genLabel} name
                </Link>
              )}
              {n.origin && originSlug && (
                <Link href={`/origins/${originSlug}`} className="chip">
                  {n.origin} origin
                </Link>
              )}
              {n.luckyNumber && (
                <span className="chip">Lucky number {n.luckyNumber}</span>
              )}
            </div>
          </div>

          {/* Key facts */}
          <dl className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="stat-tile">
              <dt className="stat-label">Meaning</dt>
              <dd className="stat-value line-clamp-2">{n.shortMeaning || '—'}</dd>
            </div>
            <div className="stat-tile">
              <dt className="stat-label">Origin</dt>
              <dd className="stat-value">{n.origin || relLabel}</dd>
            </div>
            <div className="stat-tile">
              <dt className="stat-label">Gender</dt>
              <dd className="stat-value">{genLabel}</dd>
            </div>
            <div className="stat-tile">
              <dt className="stat-label">Syllables (est.)</dt>
              <dd className="stat-value" title="Estimated from the romanised spelling; pronunciation may differ">
                ~{n.syllables} &bull; {n.letterCount} letters
              </dd>
            </div>
          </dl>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-nv-border pt-6">
            <SocialShare title={`Meaning of ${n.name} on NameVerse`} url={canonicalUrl} />
            <SaveNameButton
              item={{
                n: n.name,
                s: canonicalSlug || normalizedSlug,
                r: finalReligion,
                m: n.shortMeaning || '',
                o: n.origin || '',
                g: n.genderKey || '',
              }}
            />
          </div>
        </header>

        {/* Ad slot — below the H1 so the name (primary keyword) stays in the
            first viewport, above the fold so it is seen early. */}
        <AdSlot placement="name-detail-top" />

        {/* ── INTRO — unique per name, composed from this record's own fields ── */}
        <section className="card p-6 sm:p-8">
          <div className="prose-nv">
            <p>{n.intro}</p>
          </div>
        </section>

        <NameTrustMeta name={n.name} origin={n.origin} meaning={n.shortMeaning} />

        {/* ── MEANING ── */}
        {n.meaningSection.length > 0 && (
          <section className="card p-6 sm:p-8">
            <span className="eyebrow">Meaning &amp; Etymology</span>
            <h2 className="section-title mt-1">What does the name {n.name} mean?</h2>
            <div className="prose-nv mt-4 space-y-4">
              {n.meaningSection.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>

            {n.etymology.lexicalForm && (
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="inset-panel">
                  <div className="stat-label">Original form</div>
                  <div className="mt-1 text-xl font-bold text-nv-text">{n.etymology.lexicalForm}</div>
                </div>
                {n.etymology.transliteration && (
                  <div className="inset-panel">
                    <div className="stat-label">Transliteration</div>
                    <div className="mt-1 font-mono text-base font-bold text-nv-text">
                      {n.etymology.transliteration}
                    </div>
                  </div>
                )}
                {n.etymology.rootStatus && (
                  <div className="inset-panel">
                    <div className="stat-label">Root</div>
                    <div className="mt-1 text-sm font-bold text-nv-text">{n.etymology.rootStatus}</div>
                  </div>
                )}
              </div>
            )}

            {n.spiritualMeaning && (
              <p className="mt-5 rounded-xl border border-nv-border/80 bg-nv-subtle/50 p-4 text-base italic text-nv-text">
                &ldquo;{n.spiritualMeaning}&rdquo;
              </p>
            )}
          </section>
        )}

        {/* ── WORLD SCRIPTS ── */}
        {n.scripts.length > 0 && (
          <section className="card p-6 sm:p-8">
            <span className="eyebrow">World Scripts</span>
            <h2 className="section-title mt-1">{n.name} in other languages &amp; scripts</h2>
            <p className="mt-2 text-sm text-nv-text-secondary">
              The name as written in the scripts of the languages it appears in.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {n.scripts.map((s) => (
                <div key={s.key} className="inset-panel">
                  <div className="stat-label">{s.label}</div>
                  {s.name && (
                    <div className="mt-2 text-2xl font-bold text-nv-text" dir={s.rtl ? 'rtl' : 'ltr'}>
                      {s.name}
                    </div>
                  )}
                  {s.meaning && (
                    <div className="mt-1.5 text-sm font-semibold text-nv-text" dir={s.rtl ? 'rtl' : 'ltr'}>
                      {s.meaning}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── SCRIPTURE & HERITAGE ── */}
        {hasScripture && (
          <section className="card p-6 sm:p-8">
            <span className="eyebrow">Religious &amp; Historical Context</span>
            <h2 className="section-title mt-1">{n.name} in religious tradition</h2>
            <div className="mt-5 space-y-3">
              {n.religionCtx.isQuranic && (
                <div className="rounded-2xl border border-islamic-border bg-islamic-soft p-4">
                  <div className="text-sm font-bold text-islamic">Quranic name</div>
                  <p className="mt-1 text-sm text-nv-text-secondary">
                    {n.religionCtx.quranicNote || 'This name is recorded as appearing in the Qur\u2019an.'}
                    {n.religionCtx.quranicRef && ` (${n.religionCtx.quranicRef})`}
                  </p>
                </div>
              )}
              {n.religionCtx.isBiblical && (
                <div className="rounded-2xl border border-christian-border bg-christian-soft p-4">
                  <div className="text-sm font-bold text-christian">Biblical name</div>
                  <p className="mt-1 text-sm text-nv-text-secondary">
                    {n.religionCtx.biblicalScripture || 'This name appears in biblical scripture.'}
                    {n.religionCtx.biblicalVerse && ` (${n.religionCtx.biblicalVerse})`}
                  </p>
                </div>
              )}
              {n.religionCtx.isSaint && (
                <div className="rounded-2xl border border-italian-border bg-italian-soft p-4">
                  <div className="text-sm font-bold text-italian">Saint name</div>
                  <p className="mt-1 text-sm text-nv-text-secondary">
                    {n.religionCtx.saintName
                      ? `Associated with ${n.religionCtx.saintName}.`
                      : 'This name is associated with a recognised saint.'}
                  </p>
                </div>
              )}
              {n.religionCtx.isVedic && (
                <div className="rounded-2xl border border-hindu-border bg-hindu-soft p-4">
                  <div className="text-sm font-bold text-hindu">Vedic reference</div>
                  <p className="mt-1 text-sm text-nv-text-secondary">{n.religionCtx.vedicRef}</p>
                </div>
              )}
              {n.religionCtx.explanation && (
                <p className="text-sm leading-relaxed text-nv-text-secondary">{n.religionCtx.explanation}</p>
              )}
            </div>
          </section>
        )}

        {/* ── CULTURAL CONTEXT ── */}
        {n.culturalSection.length > 0 && (
          <section className="card p-6 sm:p-8">
            <span className="eyebrow">Cultural Context</span>
            <h2 className="section-title mt-1">Cultural significance of {n.name}</h2>
            <div className="prose-nv mt-4 space-y-4">
              {n.culturalSection.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </section>
        )}

        {/* ── PRONUNCIATION + NUMEROLOGY ── */}
        <div className="grid gap-6 md:grid-cols-2">
          <section className="card p-6 sm:p-8">
            <span className="eyebrow">Pronunciation</span>
            <h2 className="mt-1 font-display text-xl font-bold text-nv-text sm:text-2xl">
              How to pronounce {n.name}
            </h2>
            <div className="mt-4 space-y-3">
              {n.pronunciation.english && (
                <div className="inset-panel">
                  <div className="stat-label">English</div>
                  <div className="mt-1 font-mono text-base font-bold text-nv-text">
                    {n.pronunciation.english}
                  </div>
                </div>
              )}
              {n.pronunciation.ipa && (
                <div className="inset-panel">
                  <div className="stat-label">IPA</div>
                  <div className="mt-1 font-mono text-base font-bold text-nv-text">{n.pronunciation.ipa}</div>
                </div>
              )}
              {n.pronunciation.urdu && (
                <div className="inset-panel">
                  <div className="stat-label">Urdu</div>
                  <div className="mt-1 text-base font-bold text-nv-text" dir="rtl">
                    {n.pronunciation.urdu}
                  </div>
                </div>
              )}
              {n.pronunciation.hindi && (
                <div className="inset-panel">
                  <div className="stat-label">Hindi</div>
                  <div className="mt-1 text-base font-bold text-nv-text">{n.pronunciation.hindi}</div>
                </div>
              )}
              {n.pronunciation.note && (
                <p className="text-xs leading-relaxed text-nv-text-muted">Approximate romanization.</p>
              )}
            </div>
          </section>

          <section className="card p-6 sm:p-8">
            <span className="eyebrow">Numerology</span>
            <h2 className="mt-1 font-display text-xl font-bold text-nv-text sm:text-2xl">
              {n.name} and the number {n.luckyNumber}
            </h2>
            <div className="mt-4 space-y-3">
              <dl className="grid grid-cols-2 gap-3">
                <div className="inset-panel">
                  <dt className="stat-label">Lucky number</dt>
                  <dd className="mt-1 text-2xl font-black text-nv-accent">{n.luckyNumber}</dd>
                </div>
                <div className="inset-panel">
                  <dt className="stat-label">Life path (traditional)</dt>
                  <dd className="mt-1 text-2xl font-black text-nv-text">{n.lifePath}</dd>
                </div>
                <div className="inset-panel">
                  <dt className="stat-label">Day</dt>
                  <dd className="mt-1 text-sm font-bold text-nv-text">{n.luckyDay}</dd>
                </div>
                <div className="inset-panel">
                  <dt className="stat-label">Stone</dt>
                  <dd className="mt-1 text-sm font-bold text-nv-text">{n.luckyStone}</dd>
                </div>
              </dl>
              {n.luckyColors.length > 0 && (
                <div>
                  <span className="stat-label">Associated colours</span>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {n.luckyColors.map((c) => (
                      <span key={c} className="chip">{c}</span>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs leading-relaxed text-nv-text-muted">
                Numerological associations are traditional and belief-based, not linguistic facts.
              </p>
            </div>
          </section>
        </div>

        {/* ── HISTORY ── */}
        {n.historicalSection.length > 0 && (
          <section className="card p-6 sm:p-8">
            <span className="eyebrow">Historical Record</span>
            <h2 className="section-title mt-1">Historical background of {n.name}</h2>
            <div className="prose-nv mt-4 space-y-3">
              {n.historicalSection.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </section>
        )}

        {/* ── POPULARITY BY REGION ── */}
        {n.popularityRegions.length > 0 && (
          <section className="card p-6 sm:p-8">
            <span className="eyebrow">Regional Usage</span>
            <h2 className="section-title mt-1">Where {n.name} is used</h2>
            <div className="mt-5 overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Region</th>
                    <th>Code</th>
                    <th>Score</th>
                    <th>Year</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-nv-border/50">
                  {n.popularityRegions.map((r, i) => (
                    <tr key={i}>
                      <td className="font-semibold text-nv-text">{r.region}</td>
                      <td className="font-mono">{r.code || '—'}</td>
                      <td className="font-bold text-nv-text">{r.score ?? '—'}</td>
                      <td className="font-mono">{r.year ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── NAMESAKES ──
            Only claim "people named X" when we can actually name someone. The
            old condition also fired on a bare `story`, which rendered an
            "Notable Namesakes / People named X" section whose only content was
            a panel labelled "Name story" — an empty shell promising namesakes
            the page does not have. Split the two cases. */}
        {n.namesakes.celebrities.length > 0 ? (
          <section className="card p-6 sm:p-8">
            <span className="eyebrow">Notable Namesakes</span>
            <h2 className="section-title mt-1">People named {n.name}</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="inset-panel">
                <div className="stat-label">Notable figures</div>
                <ul className="mt-3 space-y-2">
                  {n.namesakes.celebrities.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm font-semibold text-nv-text">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-nv-accent" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
              {n.namesakes.story && n.namesakes.story.text && (
                <div className="inset-panel">
                  <div className="stat-label">
                    {n.namesakes.story.person || 'Name story'}
                    {n.namesakes.story.location ? ` \u00b7 ${n.namesakes.story.location}` : ''}
                  </div>
                  <p className="mt-2 text-sm italic leading-relaxed text-nv-text-secondary">
                    &ldquo;{n.namesakes.story.text}&rdquo;
                  </p>
                </div>
              )}
            </div>
          </section>
        ) : (
          n.namesakes.story &&
          n.namesakes.story.text && (
            <section className="card p-6 sm:p-8">
              <span className="eyebrow">Name story</span>
              <h2 className="section-title mt-1">How {n.name} is used</h2>
              <div className="mt-5">
                <div className="inset-panel">
                  <div className="stat-label">
                    {n.namesakes.story.person || 'Background'}
                    {n.namesakes.story.location ? ` \u00b7 ${n.namesakes.story.location}` : ''}
                  </div>
                  <p className="mt-2 text-sm italic leading-relaxed text-nv-text-secondary">
                    &ldquo;{n.namesakes.story.text}&rdquo;
                  </p>
                </div>
              </div>
            </section>
          )
        )}

        {/* ── VARIANTS & RELATED NAMES (internal linking) ── */}
        {(n.variants.length > 0 || similarNames.length > 0 || relatedNames.length > 0) && (
          <section className="card p-6 sm:p-8">
            <span className="eyebrow">Related Names</span>
            <h2 className="section-title mt-1">Names related to {n.name}</h2>

            {n.variants.length > 0 && (
              <div className="mt-4">
                <h3 className="stat-label">Spelling variations</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {n.variants.map((v) => (
                    <span key={v} className="chip">{v}</span>
                  ))}
                </div>
              </div>
            )}

            {similarNames.length > 0 && (
              <div className="mt-5">
                <h3 className="stat-label">Similar sounding names</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {similarNames.map((s, i) =>
                    s.href ? (
                      <Link key={i} href={s.href} className="chip hover:border-nv-accent/50 hover:text-nv-accent">
                        {s.name}
                      </Link>
                    ) : (
                      <span key={i} className="chip">{s.name}</span>
                    )
                  )}
                </div>
              </div>
            )}

            {relatedNames.length > 0 && (
              <div className="mt-5">
                <h3 className="stat-label">Thematically linked names</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {relatedNames.map((s, i) =>
                    s.href ? (
                      <Link key={i} href={s.href} className="chip hover:border-nv-accent/50 hover:text-nv-accent">
                        {s.name}
                      </Link>
                    ) : (
                      <span key={i} className="chip">{s.name}</span>
                    )
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── FAQ ── */}
        {n.faqs.length > 0 && (
          <section className="card p-6 sm:p-8">
            <span className="eyebrow">Frequently Asked Questions</span>
            <h2 className="section-title mt-1">Questions about the name {n.name}</h2>
            <div className="mt-5 space-y-3">
              {(n.faqs || []).slice(0, 10).map((f, i) => (
                <details
                  key={i}
                  className="group rounded-2xl border border-nv-border bg-nv-surface transition hover:border-nv-accent/40"
                  open={i === 0}
                >
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-4 p-5 font-semibold text-nv-text transition hover:text-nv-accent">
                    <span className="flex-1 font-display text-base sm:text-lg">{f.q}</span>
                    <span className="text-nv-text-muted transition-transform duration-200 group-open:rotate-180">
                      &darr;
                    </span>
                  </summary>
                  <div className="border-t border-nv-border/40 px-5 pb-5 pt-3 text-sm leading-relaxed text-nv-text-secondary sm:text-base">
                    {f.a}
                  </div>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* ── SIBLING NAVIGATION (upward + lateral internal links) ── */}
        <nav className="flex flex-wrap justify-center gap-2 pt-6" aria-label="Related pages">
          <Link href={`/names/${finalReligion}/letter/${letterSegment}`} className="btn-ghost text-xs">
            {relLabel} names starting with {letterDisplay}
          </Link>
          <Link href={`/names/${finalReligion}`} className="btn-ghost text-xs">
            All {relLabel.toLowerCase()} names
          </Link>
          {n.genderKey && n.genderKey !== 'unisex' && (
            <Link href={`/${finalReligion}-${n.genderKey}-names`} className="btn-ghost text-xs">
              {relLabel} {genLabel.toLowerCase()} names
            </Link>
          )}
          {originSlug && (
            <Link href={`/origins/${originSlug}`} className="btn-ghost text-xs">
              {ORIGIN_LABELS[originSlug] || n.origin} names
            </Link>
          )}
          <Link href="/search" className="btn-ghost text-xs">
            Search all names
          </Link>
        </nav>
      </div>
    </div>
  );
}
