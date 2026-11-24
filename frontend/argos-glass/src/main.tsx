import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './tema.css'; // temas del panel y movimiento: después de index.css
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
