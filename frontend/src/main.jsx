import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import LoginPage from './pages/LoginPage.jsx'
import AccountGate from './components/AccountGate.jsx'
import './codex/theme.css'
import './beautify.css'
import { ConfirmationProvider } from './codex/ui/confirmation-provider.jsx'

const registrationPage = /^\/register\/?$/.test(window.location.pathname)
const accountPage = registrationPage || /^\/login\/?$/.test(window.location.pathname)

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfirmationProvider>{accountPage ? <LoginPage registration={registrationPage} /> : <AccountGate><App /></AccountGate>}</ConfirmationProvider>
  </React.StrictMode>,
)
