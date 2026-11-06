import React from 'react'
import {createRoot} from 'react-dom/client'
import '../src/codex/theme.css'
import ReviewWorkspace from '../src/components/ReviewWorkspace.jsx'
import {ConfirmationProvider} from '../src/codex/ui/confirmation-provider.jsx'
createRoot(document.getElementById('root')).render(<ConfirmationProvider><main className="compact-shell v2-shell" style={{padding:20}}><ReviewWorkspace workspace="review-width-isolated" today="2026-10-31" active={true} /></main></ConfirmationProvider>)
