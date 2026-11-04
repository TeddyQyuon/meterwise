import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './Portal';
import PortfolioDemoBadge from './PortfolioDemoBadge.jsx';
import './styles.css';
import './estate.css';
import './workspace.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <PortfolioDemoBadge />
  </React.StrictMode>
);
