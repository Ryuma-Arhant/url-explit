import axios from 'axios'

// Free LLM providers only. No paid APIs.
// Priority: GROQ → GEMINI → TOGETHER → stub
// All have free tiers, no card required.

export function hasLLM() {
  return !!(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.TOGETHER_API_KEY)
}

export async function callLLM(prompt, maxTokens = 400) {
  if (process.env.GROQ_API_KEY)    return callGroq(prompt, maxTokens)
  if (process.env.GEMINI_API_KEY)  return callGemini(prompt, maxTokens)
  if (process.env.TOGETHER_API_KEY) return callTogether(prompt, maxTokens)
  throw new Error('Set GROQ_API_KEY or GEMINI_API_KEY in .env (both free, no card needed)')
}

// ─── Groq ────────────────────────────────────────────────────────────────────
// Key: https://console.groq.com/keys  (instant, no card)
// Groq retires models over time (llama-3.3-70b-versatile is gone) — override
// with GROQ_MODEL in .env; list yours at https://console.groq.com/docs/models
const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b'

async function callGroq(prompt, maxTokens) {
  const model = process.env.GROQ_MODEL || GROQ_DEFAULT_MODEL
  const isReasoningModel = /gpt-oss|qwen3/i.test(model)
  const { data } = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      // Reasoning models spend tokens thinking before answering: keep the
      // thinking short and leave room for the actual answer.
      ...(isReasoningModel
        ? { reasoning_effort: 'low', max_completion_tokens: maxTokens + 1024 }
        : { max_tokens: maxTokens }),
      temperature: 0.1,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  )
  const content = data.choices?.[0]?.message?.content
  if (!content || !content.trim()) throw new Error(`Groq model ${model} returned an empty answer`)
  return content
}

// ─── Google Gemini 2.0 Flash ──────────────────────────────────────────────────
// Free: 15 RPM, 1 million tokens/day, 1500 req/day
// Key: https://aistudio.google.com/apikey  (instant, no card)
async function callGemini(prompt, maxTokens) {
  const { data } = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.1 },
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
  )
  return data.candidates[0].content.parts[0].text
}

// ─── Together AI — Llama 3.1 70B ─────────────────────────────────────────────
// Free: $1 credit on signup (covers ~hundreds of audits), open-source models
// Key: https://api.together.xyz/settings/api-keys
async function callTogether(prompt, maxTokens) {
  const { data } = await axios.post(
    'https://api.together.xyz/v1/chat/completions',
    {
      model: 'meta-llama/Llama-3.1-70B-Instruct-Turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.1,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 25000,
    }
  )
  return data.choices[0].message.content
}

// ─── Parse JSON from any LLM response (handles markdown fences) ──────────────
export function parseJSON(text) {
  if (typeof text !== 'string') return text
  const fence = text.match(/```(?:json)?\n?([\s\S]+?)\n?```/)
  if (fence) return JSON.parse(fence[1])
  const obj = text.match(/(\{[\s\S]+\})/)
  if (obj) return JSON.parse(obj[1])
  return JSON.parse(text)
}

// ─── Generate verdict narrative ───────────────────────────────────────────────
export async function generateNarrative(product, scoreData, verdict) {
  const { signals, priceData, reviewData, sellerData } = scoreData
  const inr = n => (n == null ? null : `₹${Math.round(n).toLocaleString('en-IN')}`)
  const comps = priceData?.competitors ?? []

  // Give the model the actual facts — with only scores it invents details
  // ("reliable seller", "generous returns") that the page never stated.
  const facts = [
    `Price: ${product?.in_stock === false ? 'currently out of stock' : (inr(priceData?.current) ?? 'not shown')}` +
      (priceData?.mrp ? ` (MRP ${inr(priceData.mrp)}${priceData.discountPct != null ? `, ${priceData.discountPct}% off` : ''})` : ''),
    `Fake/inflated MRP detected: ${priceData?.isFakeDiscount ? 'YES' : 'no'}`,
    `Competitor prices: ${comps.length ? comps.map(c => `${c.site} ${inr(c.price)}`).join(', ') : 'none found (price could not be cross-checked)'}`,
    `Rating: ${product?.rating_avg != null ? `${product.rating_avg}★ from ${product.rating_count ?? '?'} ratings` : 'not shown'}`,
    `Reviews sampled: ${reviewData?.totalReviews ?? 0}` +
      (reviewData?.totalReviews ? ` — generic bot-like phrases ${Math.round(reviewData.genericPhrasePct)}%, review burst ${reviewData.burstDetected ? `YES (${Math.round(reviewData.burstPct)}% in 7 days)` : 'none'}, suspicious reviewer names ${Math.round(reviewData.suspiciousNamePct)}%` : ''),
    `Seller: ${sellerData?.name ?? 'name not published'}; account age ${typeof sellerData?.age_days === 'number' ? `${sellerData.age_days} days` : 'unknown'}; seller rating ${sellerData?.rating ?? 'unknown'}`,
    `Return policy: ${product?.return_policy_text ? `"${product.return_policy_text}"` : 'not stated'}${sellerData?.return_policy_flags?.length ? ` — red flags: ${sellerData.return_policy_flags.join(', ')}` : ''}`,
  ]

  const prompt = `You are TrustLens, an AI product auditor. Scores are pre-computed — do NOT change any numbers. Write only the narrative.

PRODUCT: ${product?.title ?? 'Unknown'} by ${product?.brand || 'Unknown'}
VERDICT: ${verdict} (Trust Score: ${scoreData.trustScore}/100)
SIGNAL SCORES: Price Reality ${signals.priceReality}/25, Review Authenticity ${signals.reviewAuthenticity}/25, Seller Trust ${signals.sellerTrust}/20, Rating Distribution ${signals.ratingDistribution}/15, Return Policy ${signals.returnPolicy}/15

FACTS (the only things you know):
${facts.map(f => `- ${f}`).join('\n')}

RULES:
- Use ONLY the FACTS above. Never invent seller reputation, product features, market prices or policies.
- Where a fact is unknown or not found, say it is unverified — do not describe it as good or bad.
- Mention concrete numbers from the FACTS where useful.

Return ONLY this JSON (no markdown):
{"verdictReason":"<one sentence, max 20 words, plain English>","insights":["<most important finding>","<second finding>","<third finding>"]}`

  try {
    const raw = await callLLM(prompt, 300)
    const parsed = parseJSON(raw)
    if (!parsed?.verdictReason || !Array.isArray(parsed.insights)) throw new Error('LLM narrative missing fields')
    return { verdictReason: parsed.verdictReason, insights: parsed.insights.slice(0, 3).map(String) }
  } catch (err) {
    if (hasLLM()) console.warn('Narrative LLM failed, using rule-based text:', err.message)
    return fallbackNarrative(verdict, scoreData, product)
  }
}

// ─── Follow-up chat (scoped to this audit only) ───────────────────────────────
export async function answerFollowUp(question, auditContext) {
  const prompt = `You are TrustLens. Answer using ONLY the audit data below. Be direct, 2-3 sentences. If the data doesn't cover it, say so.

AUDIT:
${JSON.stringify({
  product: auditContext.product,
  verdict: auditContext.verdict,
  trustScore: auditContext.trustScore,
  signals: auditContext.signals,
  priceData: auditContext.priceData,
  reviewData: { ...auditContext.reviewData, sampleReviews: undefined },
  sellerData: auditContext.sellerData,
}, null, 2)}

QUESTION: ${question}`

  if (hasLLM()) {
    try {
      return await callLLM(prompt, 200)
    } catch (err) {
      console.warn('Follow-up LLM call failed, using rule-based answer:', err.message)
    }
  }
  return answerFromAudit(question, auditContext)
}

// ─── Rule-based follow-up answers (no LLM key, or LLM failure) ──────────────
const fmtINR = n => (n == null ? null : `₹${Math.round(n).toLocaleString('en-IN')}`)

function answerFromAudit(question, a) {
  const q = question.toLowerCase()
  const s = a.signals ?? {}
  const price = a.priceData ?? {}
  const rev = a.reviewData ?? {}
  const seller = a.sellerData ?? {}
  const parts = []

  if (/price|cost|discount|mrp|deal|cheap|expensive|worth/.test(q)) {
    const cur = fmtINR(price.current)
    const mrp = fmtINR(price.mrp)
    if (cur) parts.push(`It's listed at ${cur}${mrp ? ` against an MRP of ${mrp}` : ''}.`)
    if (price.isFakeDiscount) parts.push('The MRP looks artificially inflated, so the discount is misleading.')
    const comps = price.competitors ?? []
    if (comps.length) parts.push(`Close matches elsewhere: ${comps.map(c => `${c.site} ${fmtINR(c.price)}`).join(', ')}.`)
    else parts.push('No close competitor prices were found to compare against.')
    parts.push(`Price Reality scored ${s.priceReality ?? '?'}/25.`)
  }
  if (/review|fake|bot|rating|genuine|real/.test(q)) {
    parts.push(`${rev.totalReviews ?? 0} reviews were analysed: ${Math.round(rev.genericPhrasePct ?? 0)}% use generic bot-like phrases` +
      `${rev.burstDetected ? `, and ${Math.round(rev.burstPct ?? 0)}% were posted in a single 7-day burst` : ', with no review burst detected'}.`)
    parts.push(`Review Authenticity scored ${s.reviewAuthenticity ?? '?'}/25.`)
  }
  if (/seller|shop|store|vendor|trust/.test(q)) {
    const age = seller.age_days == null ? 'unknown account age' : `an account about ${seller.age_days} days old`
    parts.push(`The seller${seller.name ? ` (${seller.name})` : ''} has ${age}${seller.rating ? ` and a ${seller.rating}★ rating` : ''}. Seller Trust scored ${s.sellerTrust ?? '?'}/20.`)
  }
  if (/return|refund|replace|exchange|warranty/.test(q)) {
    const flags = seller.return_policy_flags ?? []
    parts.push(flags.length ? `Return policy red flags: ${flags.join(', ')}.` : 'No return-policy red flags were found.')
    parts.push(`Return Policy scored ${s.returnPolicy ?? '?'}/15.`)
  }
  if (!parts.length || /buy|should|safe|verdict|recommend|why/.test(q)) {
    parts.unshift(`Verdict: ${a.verdict} with a trust score of ${a.trustScore}/100. ${a.verdictReason ?? ''}`.trim())
  }
  return parts.join(' ')
}

// ─── Rule-based narrative when no LLM key is configured ─────────────────────
function fallbackNarrative(verdict, scoreData, product) {
  const { signals, priceData, reviewData, sellerData } = scoreData
  const reasons = {
    BUY: 'Healthy price, review and return-policy signals with no major red flags.',
    WAIT: 'Some signals need a closer look before you buy.',
    AVOID: 'Multiple high-risk signals detected — proceed with extreme caution.',
  }

  // Red flags first, then neutral/positive facts, so the top 3 are the most useful
  const flags = []
  const facts = []
  if (priceData?.isFakeDiscount) flags.push('Artificially inflated MRP — the advertised discount is misleading')
  if (reviewData?.burstDetected) flags.push(`${Math.round(reviewData.burstPct)}% of sampled reviews were posted in a single 7-day burst`)
  if (typeof sellerData?.age_days === 'number' && sellerData.age_days < 30) flags.push('Seller account is under 30 days old — high risk')
  if ((reviewData?.genericPhrasePct ?? 0) > 30) flags.push(`${Math.round(reviewData.genericPhrasePct)}% of sampled reviews use generic, bot-like phrases`)
  if (sellerData?.return_policy_flags?.length) flags.push(`Return policy red flag: "${sellerData.return_policy_flags[0]}"`)
  if (signals.ratingDistribution <= 6) flags.push('Rating looks suspiciously perfect for the number of ratings')

  if (priceData?.current && priceData?.mrp && priceData.mrp > priceData.current) {
    facts.push(`Selling at ₹${Math.round(priceData.current).toLocaleString('en-IN')}, ${priceData.discountPct ?? Math.round((1 - priceData.current / priceData.mrp) * 100)}% below the listed MRP of ₹${Math.round(priceData.mrp).toLocaleString('en-IN')}`)
  }
  if (signals.priceReality === 25) facts.push('Price matches competitor market rates')
  else if (!priceData?.competitors?.length) facts.push('No competitor prices were found, so the price could not be cross-checked')
  if (product?.rating_avg && product?.rating_count) {
    facts.push(`Rated ${product.rating_avg}★ across ${Math.round(product.rating_count).toLocaleString('en-IN')} ratings`)
  }
  if (reviewData?.totalReviews && !reviewData.burstDetected && (reviewData.genericPhrasePct ?? 0) <= 30) {
    facts.push(`${reviewData.totalReviews} sampled reviews show no bot or burst patterns`)
  }
  if (product?.return_policy_text && !sellerData?.return_policy_flags?.length) facts.push(`Return policy: ${product.return_policy_text}`)
  if (sellerData?.age_days == null) facts.push('Seller account age is not published by this store')

  const insights = [...flags, ...facts].slice(0, 3)
  return { verdictReason: reasons[verdict], insights }
}
