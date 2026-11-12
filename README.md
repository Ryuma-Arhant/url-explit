<div align="center">
  <img src="https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/shield-check.svg" alt="TrustLens Logo" width="120" />
  <h1>TrustLens</h1>
  <p><strong>AI-Powered E-Commerce Product Audit & Cross-Platform Comparison Engine</strong></p>
  <p>
    <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
    <img src="https://img.shields.io/badge/Vite-B73BFE?style=for-the-badge&logo=vite&logoColor=FFD62E" alt="Vite" />
    <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
    <img src="https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
    <img src="https://img.shields.io/badge/MongoDB-4EA94B?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB" />
  </p>
</div>

<br />

## 🚀 Overview
TrustLens is a next-generation product analysis engine designed to protect consumers from e-commerce scams, fake reviews, and artificial discounts. Simply paste a product URL from major marketplaces (Amazon, Flipkart, Myntra, etc.), and TrustLens will instantly:

- **Extract and analyze** the product, seller, and reviews.
- **Compute a Trust Score** evaluating price reality, review authenticity, and seller trust.
- **Perform Cross-Platform Comparison** to find the exact same product on competing platforms.
- **Recommend** the safest and best value option.

---

## ✨ Key Features
- **Scam Detection:** Analyzes seller age, return policies, and review velocity to detect fly-by-night operations.
- **Fake Discount Recognition:** Compares current prices and MRP against market medians to identify artificial anchor pricing.
- **Bot Review Analysis:** Uses LLMs to analyze review linguistics, detecting bot phrases and coordinated review bursts.
- **Cross-Platform Matching:** Utilizes NVIDIA embedding similarities to accurately match products across disparate e-commerce catalogs.
- **Interactive AI Assistant:** Ask contextual follow-up questions about the specific audit.

---

## 🏗 Architecture
TrustLens utilizes a decoupled architecture with a Vite/React frontend and a Node/Express backend. 
- **Scraping Layer:** Product pages (Flipkart, Myntra, Croma, etc.) are fetched directly and parsed from their structured data (JSON-LD / OpenGraph): title, price, MRP, images, rating and reviews. Amazon is scraped through Apify's `junglee/amazon-crawler` actor; cross-platform search uses Apify's Google search actor.
- **Intelligence Layer:** Groq/Gemini for narrative and follow-up answers (rule-based fallback without a key), NVIDIA for vector similarities.
- **Storage Layer:** MongoDB (optional) with an in-memory cache.

---

## 🚦 Getting Started

### Prerequisites
- Node.js (v18+)
- MongoDB instance (optional)
- API keys (all optional): `APIFY_API_TOKEN` for Amazon links and cross-platform comparison; Groq/Gemini for AI-written narratives. Flipkart, Myntra, Croma and similar stores work with no keys.

### Installation
1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/trustlens.git
   cd trustlens
   ```
2. **Install dependencies:**
   ```bash
   cd backend && npm install
   cd ../frontend && npm install
   ```
3. **Environment Setup:**
   Copy `backend/.env.example` to `backend/.env` and fill in the keys you have. Set `DEMO_MODE=true` to use canned demo data instead of live scraping.
4. **Run Locally:**
   ```bash
   # Terminal 1: Backend
   cd backend && npm run dev
   # Terminal 2: Frontend
   cd frontend && npm run dev
   ```

---

## 🧪 Tests
```bash
cd backend && npm test
```
Covers product-page extraction, the Amazon actor mapping, URL validation and trust scoring.

---

## 🔮 Roadmap
- **Browser Extension:** One-click audits directly on Amazon/Flipkart.
- **Price Tracking:** Historical price graphs for products.
- **Auth Integration:** User accounts to save past audits and set price alerts.

---

<div align="center">
  <p>Built for the future of transparent e-commerce.</p>
</div>
