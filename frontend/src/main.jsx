import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { useAppStore } from './store'
import './index.css'

// Dev-only: expose the store so Playwright tests can target specific cards /
// force specific UI states without a full user-clickthrough. Vite strips this
// block in production builds via import.meta.env.DEV.
if (import.meta.env.DEV) {
  window.__APP_STORE__ = useAppStore
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
