import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  ExternalLink, RefreshCw, Layers, ArrowUpDown, ChevronRight, Info, FlaskConical, Star
} from 'lucide-react'
import VerdictBadge from './VerdictBadge'
import ProductImage from './ProductImage'
import TrustScore from './TrustScore'
import PriceCheck from './PriceCheck'
import ReviewAnalysis from './ReviewAnalysis'
import SellerInfo from './SellerInfo'
import FollowUpChat from './FollowUpChat'
import AIRecommendation from './AIRecommendation'
import { cn, formatCurrency } from '@/lib/utils'

const SORTS = [
  { label: 'Price ↑',  key: 'price_asc',  fn: (a, b) => (a.price_current ?? Infinity) - (b.price_current ?? Infinity) },
  { label: 'Price ↓',  key: 'price_desc', fn: (a, b) => (b.price_current ?? 0) - (a.price_current ?? 0) },
  { label: 'Trust ↓',  key: 'trust_desc', fn: (a, b) => (b.trust_score ?? 0) - (a.trust_score ?? 0) },
  { label: 'Match %',  key: 'sim_desc',   fn: (a, b) => (b.similarity_score ?? 0) - (a.similarity_score ?? 0) },
]

const VERDICT_STYLES = {
  BUY:  { bg: 'bg-emerald-500/15', border: 'border-emerald-500/40', text: 'text-emerald-400' },
  WAIT: { bg: 'bg-amber-500/15',   border: 'border-amber-500/40',   text: 'text-amber-400' },
  AVOID:{ bg: 'bg-red-500/15',     border: 'border-red-500/40',     text: 'text-red-400' },
}

/* ── Clickable Comparison Card (navigates to seller detail page) ──────── */
function CompareCard({ product, index, isSource, isBestValue, isSafest, isBestDeal, onClick }) {
  const {
    site, title, price_current, price_mrp, currency = 'INR',
    image, rating_avg, rating_count, seller_name, seller_age_days,
    trust_score, verdict, discount_pct, is_suspicious, similarity_score, in_stock,
  } = product

  const vstyle = VERDICT_STYLES[verdict] ?? VERDICT_STYLES.WAIT
  const isNewSeller = seller_age_days != null && seller_age_days < 30

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      onClick={onClick}
      className={cn(
        'relative flex flex-col rounded-2xl border overflow-hidden cursor-pointer',
        'transition-all duration-300 group',
        'hover:border-cyan-500/40 hover:shadow-[0_0_30px_rgba(34,211,238,0.15)]',
        'hover:-translate-y-1',
        isSource ? 'bg-cyan-500/5 border-cyan-500/20' :
        is_suspicious ? 'bg-red-500/5 border-red-500/20' :
        'bg-dark-700/60 border-white/5'
      )}
    >
      {/* Top badges */}
      <div className="absolute top-3 left-3 flex flex-wrap gap-1 z-10">
        {isSource && <Badge label="Source" color="cyan" />}
        {isBestValue && <Badge label="Best Value" color="emerald" />}
        {isSafest && <Badge label="Safest" color="purple" />}
        {isBestDeal && <Badge label="Best Deal" color="amber" />}
        {is_suspicious && <Badge label="Suspicious" color="red" />}
      </div>

      {/* Image */}
      <ProductImage src={image} alt={title ?? ''} fallbackText={site} className="h-36" imgClassName="p-3" />

      {/* Content */}
      <div className="flex flex-col flex-1 p-4 space-y-2.5">
        {/* Site + similarity */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wide">{site}</span>
          {!isSource && similarity_score != null && (
            <span className="text-[10px] text-slate-500 font-mono">
              {Math.round(similarity_score * 100)}% match
            </span>
          )}
        </div>

        {/* Title */}
        <p className="text-sm font-medium text-slate-200 line-clamp-2 leading-snug">{title}</p>

        {/* Price */}
        <div className="flex items-end gap-2">
          <span className="text-lg font-bold text-slate-100">
            {price_current
              ? formatCurrency(price_current, currency)
              : in_stock === false
                ? <span className="text-sm font-semibold text-red-400">Out of stock</span>
                : '—'}
          </span>
          {price_mrp && price_mrp > price_current && (
            <span className="text-xs text-slate-600 line-through mb-0.5">
              {formatCurrency(price_mrp, currency)}
            </span>
          )}
          {discount_pct > 0 && (
            <span className="text-xs text-emerald-400 mb-0.5">-{discount_pct}%</span>
          )}
        </div>

        {/* Rating */}
        {rating_avg != null && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-amber-400">★</span>
            <span className="text-slate-300">{Number(rating_avg).toFixed(1)}</span>
            {rating_count && <span className="text-slate-600">({rating_count.toLocaleString()})</span>}
          </div>
        )}

        {/* Seller */}
        {seller_name && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="truncate">{seller_name}</span>
            {isNewSeller && <span className="text-red-400 font-semibold">⚠ New</span>}
          </div>
        )}

        {/* Trust + Verdict footer */}
        <div className="flex items-center justify-between pt-2 mt-auto border-t border-white/5">
          {trust_score != null && (
            <span className={cn(
              'text-xs font-mono',
              is_suspicious ? 'text-red-400' : 'text-cyan-400'
            )}>
              Trust {trust_score}/100
            </span>
          )}
          {verdict && (
            <span className={cn(
              'text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider',
              vstyle.bg, vstyle.border, vstyle.text
            )}>
              {verdict}
            </span>
          )}
        </div>

        {/* CTA hint */}
        <div className="flex items-center justify-center gap-1 text-[11px] text-slate-600
                        group-hover:text-cyan-400 transition-colors pt-1">
          View seller details
          <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>
    </motion.div>
  )
}

function Badge({ label, color }) {
  const colors = {
    cyan:    'bg-cyan-500/15 border-cyan-500/40 text-cyan-400',
    emerald: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400',
    amber:   'bg-amber-500/15 border-amber-500/40 text-amber-400',
    purple:  'bg-purple-500/15 border-purple-500/40 text-purple-400',
    red:     'bg-red-500/15 border-red-500/40 text-red-400',
  }
  return (
    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider', colors[color] ?? colors.cyan)}>
      {label}
    </span>
  )
}

/* ══════════════════════════════════════════════════════════════════════════ */

/* ── Product photo gallery for the report header ─────────────────────── */
function ProductGallery({ images, title, fallbackText }) {
  const [active, setActive] = useState(0)
  const list = images ?? []
  const current = list[active] ?? list[0]
  return (
    <div className="w-full sm:w-56 shrink-0 space-y-2">
      <ProductImage
        src={current}
        alt={title ?? 'Product image'}
        fallbackText={fallbackText}
        className="h-56 rounded-2xl border border-white/10"
        imgClassName="p-3"
      />
      {list.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {list.slice(0, 6).map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Show image ${i + 1}`}
              className={cn(
                'shrink-0 rounded-lg border overflow-hidden transition-colors',
                i === active ? 'border-cyan-400' : 'border-white/10 hover:border-white/30'
              )}
            >
              <ProductImage src={src} fallbackText={fallbackText} className="w-12 h-12" imgClassName="p-1" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function UnifiedReport({ audit, comparison, onReset }) {
  const navigate = useNavigate()
  const [sort, setSort] = useState('price_asc')

  // Audit data
  const {
    id,
    product,
    verdict,
    verdictReason,
    trustScore,
    signals,
    insights = [],
    priceData,
    reviewData,
    sellerData,
    auditedAt,
    sourceUrl,
  } = audit

  // Comparison data
  const hasComparison = comparison !== null
  const sourceProduct = comparison?.sourceProduct
  const matches = comparison?.matches ?? []
  const aiRecommendation = comparison?.aiRecommendation
  const allCompareProducts = sourceProduct ? [sourceProduct, ...matches] : matches
  const hasCompareData = allCompareProducts.length > 0
  const images = product?.images?.length ? product.images : (sourceProduct?.images ?? [])
  const priceNow = priceData?.current ?? product?.price_current

  const sortFn = SORTS.find(s => s.key === sort)?.fn ?? SORTS[0].fn
  const sortedMatches = [...matches].sort(sortFn)

  // Best deal savings
  const cheapest = allCompareProducts.length > 0
    ? allCompareProducts.reduce((min, p) =>
        (p.price_current ?? Infinity) < (min.price_current ?? Infinity) ? p : min,
        allCompareProducts[0]
      )
    : null

  const savings = cheapest && sourceProduct &&
    cheapest.site !== sourceProduct.site &&
    cheapest.price_current && sourceProduct.price_current
      ? sourceProduct.price_current - cheapest.price_current
      : 0

  // Navigate to seller detail page
  function goToSellerDetail(product, idx) {
    // Store comparison data in sessionStorage so the seller page can access it
    sessionStorage.setItem('sellerDetailProduct', JSON.stringify(product))
    sessionStorage.setItem('sellerDetailAudit', JSON.stringify(audit))
    navigate(`/seller/${idx}`)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="max-w-6xl mx-auto space-y-6 pb-16"
    >
      {/* ── Demo-data banner ─────────────────────────────────────────────── */}
      {audit._demo && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <FlaskConical className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Example audit from demo data. This is not a live scan of the link.</span>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start gap-5">
        <ProductGallery images={images} title={product?.title} fallbackText={product?.brand || product?.title} />

        <div className="w-full min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-500 min-w-0 flex-1">
              <span className="truncate">{sourceUrl}</span>
              {sourceUrl && (
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer" aria-label="Open product page">
                  <ExternalLink className="w-3 h-3 hover:text-cyan-400 transition-colors" />
                </a>
              )}
            </div>
            <button
              onClick={onReset}
              className="shrink-0 flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300
                         bg-dark-600/60 border border-white/10 px-3 py-2 rounded-xl transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              New audit
            </button>
          </div>
          <h1 className="text-xl font-semibold text-slate-100 line-clamp-3">
            {product?.title ?? 'Product Audit'}
          </h1>
          {product?.brand && (
            <div className="text-sm text-slate-500">{product.brand}</div>
          )}
          <div className="flex flex-wrap items-end gap-x-4 gap-y-1 pt-1">
            {product?.in_stock === false && (
              <span className="text-xs font-semibold uppercase tracking-wide text-red-400 border border-red-500/30 bg-red-500/10 rounded-full px-2.5 py-1 mb-0.5">
                {product.availability || 'Out of stock'}
              </span>
            )}
            {priceNow != null && (
              <span className="text-2xl font-bold text-slate-100">{formatCurrency(priceNow, priceData?.currency ?? 'INR')}</span>
            )}
            {priceData?.mrp > priceNow && (
              <span className="text-sm text-slate-600 line-through mb-0.5">{formatCurrency(priceData.mrp, priceData?.currency ?? 'INR')}</span>
            )}
            {product?.rating_avg != null && (
              <span className="flex items-center gap-1 text-sm text-slate-400 mb-0.5">
                <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                {Number(product.rating_avg).toFixed(1)}
                {product.rating_count ? <span className="text-slate-600">({Number(product.rating_count).toLocaleString('en-IN')})</span> : null}
              </span>
            )}
            {product?.source_site && (
              <span className="text-xs uppercase tracking-wide text-cyan-500 mb-1">{product.source_site}</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Verdict Hero ────────────────────────────────────────────────── */}
      <div className="glass-card p-8 text-center space-y-4">
        <VerdictBadge verdict={verdict} size="lg" />
        <p className="text-slate-300 text-lg max-w-xl mx-auto">{verdictReason}</p>

        {insights.length > 0 && (
          <ul className="text-left space-y-2 max-w-lg mx-auto mt-4">
            {insights.map((insight, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.15 + 0.3 }}
                className="flex items-start gap-2 text-sm text-slate-400"
              >
                <span className="text-cyan-500 mt-0.5">•</span>
                {insight}
              </motion.li>
            ))}
          </ul>
        )}

        {auditedAt && (
          <div className="text-xs text-slate-600">
            Audited {new Date(auditedAt).toLocaleString()}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          ── COMPARISON SECTION — right after verdict for visibility ─────
          ══════════════════════════════════════════════════════════════════ */}
      {hasComparison && comparison.notice && (
        <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-dark-700/60 px-4 py-3 text-sm text-slate-400">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-cyan-500" />
          <span>{comparison.notice}</span>
        </div>
      )}

      {hasComparison && hasCompareData && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="space-y-6"
        >
          {/* Savings callout */}
          {savings > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20
                         rounded-2xl px-5 py-4"
            >
              <div>
                <div className="text-sm font-semibold text-emerald-400">
                  Save ₹{savings.toLocaleString()} by buying on {cheapest.site}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  vs. source listing at {sourceProduct.site}
                </div>
              </div>
              {cheapest.url && cheapest.url !== '#' && (
                <a
                  href={cheapest.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300
                             border border-emerald-500/30 px-3 py-1.5 rounded-xl transition-colors"
                >
                  View deal <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </motion.div>
          )}

          {/* Section header */}
          <div className="flex items-center gap-3 pt-2">
            <div className="p-2 rounded-xl bg-cyan-500/10">
              <Layers className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-200">
                Cross-Platform Comparison
              </h2>
              <p className="text-xs text-slate-500">
                {allCompareProducts.length} listing{allCompareProducts.length !== 1 ? 's' : ''} found
                {' · '}
                <span className="text-cyan-500">Click any card to see seller trust details →</span>
              </p>
            </div>
          </div>

          {/* AI Recommendation */}
          <AIRecommendation recommendation={aiRecommendation} allProducts={allCompareProducts} />

          {/* Sort controls */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest">
              All Listings ({allCompareProducts.length})
            </h3>
            <div className="flex items-center gap-2">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-600" />
              <div className="flex gap-1">
                {SORTS.map(s => (
                  <button
                    key={s.key}
                    onClick={() => setSort(s.key)}
                    className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                      sort === s.key
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                        : 'text-slate-500 hover:text-slate-300 border border-white/5'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Cards grid — clickable → navigates to /seller/:idx */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {sourceProduct && (
              <CompareCard
                product={sourceProduct}
                index={0}
                isSource
                isBestValue={aiRecommendation?.best_value_index === 0}
                isSafest={aiRecommendation?.safest_seller_index === 0}
                isBestDeal={aiRecommendation?.best_deal_index === 0}
                onClick={() => goToSellerDetail(sourceProduct, 0)}
              />
            )}
            {sortedMatches.map((m, i) => {
              const originalIdx = allCompareProducts.indexOf(m)
              return (
                <CompareCard
                  key={`${m.site}-${m.url ?? ''}-${i}`}
                  product={m}
                  index={originalIdx}
                  isSource={false}
                  isBestValue={aiRecommendation?.best_value_index === originalIdx}
                  isSafest={aiRecommendation?.safest_seller_index === originalIdx}
                  isBestDeal={aiRecommendation?.best_deal_index === originalIdx && aiRecommendation?.best_value_index !== originalIdx}
                  onClick={() => goToSellerDetail(m, originalIdx)}
                />
              )
            })}
          </div>
        </motion.div>
      )}

      {/* Loading comparison */}
      {!hasComparison && comparison === null && (
        <div className="glass-card p-6 text-center">
          <div className="flex items-center justify-center gap-2 text-slate-500">
            <Layers className="w-4 h-4 animate-pulse" />
            <span className="text-sm">Searching other platforms for this product...</span>
          </div>
        </div>
      )}

      {/* ── Trust Score ─────────────────────────────────────────────────── */}
      <TrustScore score={trustScore} signals={signals} />

      {/* ── Price + Reviews (2-col) ───────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-6">
        <PriceCheck priceData={priceData} />
        <ReviewAnalysis reviewData={reviewData} />
      </div>

      {/* ── Seller ────────────────────────────────────────────────────── */}
      <SellerInfo sellerData={sellerData} />

      {/* ── Follow-up Chat ────────────────────────────────────────────── */}
      <FollowUpChat auditId={id} />
    </motion.div>
  )
}
