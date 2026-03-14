import React from 'react';
import ReactDOM from 'react-dom/client';
import './src/index.css';
import App from './App';
import { registerSW } from 'virtual:pwa-register';


const savedTheme = localStorage.getItem("theme")

if (savedTheme === "dark") {
  document.documentElement.classList.add("dark")
} else if (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches) {
  document.documentElement.classList.add("dark")
}


// Register Service Worker for PWA offline support
const updateSW = registerSW({
  onNeedRefresh() {
    console.log('New content available, reload to update.');
  },
  onOfflineReady() {
    console.log('App is ready to work offline.');
  },
});


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