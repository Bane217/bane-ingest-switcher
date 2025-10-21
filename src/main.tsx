import React from 'react'
import ReactDOM from 'react-dom/client'
import BaneIngestSwitcher from './BaneIngestSwitcher'
import './index.css' // optional tailwind / global styles

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BaneIngestSwitcher />
  </React.StrictMode>,
)
