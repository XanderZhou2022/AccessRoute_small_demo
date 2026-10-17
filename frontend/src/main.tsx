import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

if (import.meta.env.VITE_ANDROID_APP === 'true' && import.meta.env.VITE_API_BASE_URL) {
  try {
    localStorage.setItem('accessroute-api-base-url', import.meta.env.VITE_API_BASE_URL);
  } catch (error) {
    console.error('Unable to persist the API address for the map demo.', error);
  }
}

if (
  import.meta.env.PROD &&
  import.meta.env.VITE_ANDROID_APP !== 'true' &&
  'serviceWorker' in navigator
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}service-worker.js`, {
        scope: import.meta.env.BASE_URL,
      })
      .catch((error: unknown) => {
        console.error('AccessRoute service worker registration failed.', error);
      });
  });
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="loading">
        <h1>頁面暫時無法載入</h1>
        <p>請重新整理，或使用 README 中的啟動指令。</p>
        <button onClick={() => location.reload()}>重新載入</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
const root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
