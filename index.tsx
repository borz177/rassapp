
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Unregister existing service workers to ensure app updates are received immediately
const unregisterServiceWorkers = async () => {
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        registration.unregister().catch(err => console.warn('SW unregister failed:', err));
      }
    } catch (error) {
      console.warn('Failed to access service worker registrations:', error);
    }
  }
};

// Execute safely without blocking render
unregisterServiceWorkers();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
