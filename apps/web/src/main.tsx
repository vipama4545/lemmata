import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Boot, not App. The dictionary arrives over the network now, and the app is imported only
// once it has — see content/Boot.tsx, which is what lets everything below go on reading it
// synchronously.
import Boot from './content/Boot.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
)
