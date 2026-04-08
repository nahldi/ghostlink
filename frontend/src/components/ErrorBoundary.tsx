import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[GhostLink ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: '#e0dff0', background: '#08080f', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
          <h1 style={{ color: '#a78bfa', marginBottom: 16, fontSize: 20 }}>GhostLink</h1>
          <p style={{ color: '#fca5a5', fontSize: 14 }}>Something went wrong:</p>
          <pre style={{ color: '#a9a4b8', fontSize: 12, marginTop: 12, whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 20, padding: '10px 20px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
