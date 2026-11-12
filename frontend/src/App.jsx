import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import Home from './pages/Home'
import Gallery from './pages/Gallery'
import SellerDetail from './pages/SellerDetail'

function NotFound() {
  return (
    <div className="min-h-screen bg-dark-900 flex items-center justify-center px-4">
      <div className="text-center space-y-4">
        <div className="text-5xl font-bold font-mono text-slate-700">404</div>
        <p className="text-slate-400">This page doesn't exist.</p>
        <Link to="/" className="btn-primary inline-block">Go to TrustLens</Link>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/gallery" element={<Gallery />} />
        <Route path="/seller/:idx" element={<SellerDetail />} />
        {/* Old compare route redirects to unified home */}
        <Route path="/compare" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}
