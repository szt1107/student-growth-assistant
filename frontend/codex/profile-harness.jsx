import React from 'react'
import {createRoot} from 'react-dom/client'
import '../src/codex/theme.css'
import MyProfilePage from '../src/pages/MyProfilePage.jsx'
import {ConfirmationProvider} from '../src/codex/ui/confirmation-provider.jsx'
createRoot(document.getElementById('root')).render(<ConfirmationProvider><main className="compact-shell v2-shell" style={{padding:20}}><MyProfilePage recoveryWorkspace="profile-isolated-test" onBusinessChat={()=>{}} /></main></ConfirmationProvider>)
