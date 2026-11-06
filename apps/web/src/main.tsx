import { createRoot } from 'react-dom/client';
import { Component, type ReactNode } from 'react';
import App from '~/AppRoot';
import '~/tailwind.css';

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <div className="app-loading">
        <h2>The interface stopped unexpectedly</h2>
        <p>{this.state.error}</p>
        <p>Reload to restore your last recovery checkpoint.</p>
        <button className="button" onClick={() => location.reload()}>
          Reload Superfluid
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <Boundary>
    <App />
  </Boundary>,
);
