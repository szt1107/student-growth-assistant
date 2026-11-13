import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './codex/theme.css'
import { ConfirmationProvider } from './codex/ui/confirmation-provider.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfirmationProvider><App /></ConfirmationProvider>
  </React.StrictMode>,
)
