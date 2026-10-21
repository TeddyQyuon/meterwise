import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './Portal';
import PortfolioDemoBadge from './PortfolioDemoBadge.jsx';
import './styles.css';
import './estate.css';
import './ml.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <PortfolioDemoBadge />
  </React.StrictMode>
);
