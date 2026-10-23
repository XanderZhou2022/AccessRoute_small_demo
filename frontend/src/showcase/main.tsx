import React from 'react';
import { createRoot } from 'react-dom/client';
import { ShowcaseApp } from './ShowcaseApp';
import './showcase.css';

class ShowcaseBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="boot-screen">
        <h1>展示頁暫時無法載入</h1>
        <p>請重新整理後再試。</p>
        <button onClick={() => location.reload()}>重新載入</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <ShowcaseBoundary>
    <ShowcaseApp />
  </ShowcaseBoundary>,
);
