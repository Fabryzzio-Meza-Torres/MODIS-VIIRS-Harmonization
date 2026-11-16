import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App'
import { LangProvider } from './i18n'

createRoot(document.getElementById('root')!).render(<LangProvider><App /></LangProvider>)
