import { Component, type ErrorInfo, type ReactNode } from 'react';
import { errorReport, logError, readErrors } from '../lib/errorLog';

interface Props {
  children: ReactNode;
  /** Changing this (e.g. the route) clears the error so other screens work again. */
  resetKey?: string;
  where?: string;
}

interface State {
  error: Error | null;
  copied: boolean;
}

/**
 * Shows a calm recovery screen instead of a blank page when a screen crashes.
 * Saved data is not affected; the error is kept in the on-phone error log.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const e = new Error(error.message);
    e.name = error.name;
    e.stack = `${error.stack ?? ''}\nComponent stack:${info.componentStack ?? ''}`;
    logError(e, this.props.where ?? 'Screen');
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, copied: false });
  }

  private copy = async () => {
    const text = errorReport(readErrors().slice(0, 5), { userAgent: navigator.userAgent });
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
    } catch {
      window.prompt('Copy these error details:', text);
    }
  };

  render() {
    const { error, copied } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="card crash" role="alert">
        <h2>Something went wrong on this screen</h2>
        <p>Your saved data is safe — this only stopped the screen from showing. Try again, or go to Home.</p>
        <p className="muted small mono">{error.message.slice(0, 200)}</p>
        <div className="row gap wrap">
          <button type="button" className="primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              window.location.hash = '#/';
              this.setState({ error: null, copied: false });
            }}
          >
            Go to Home
          </button>
          <button type="button" className="secondary" onClick={() => void this.copy()}>
            {copied ? 'Copied' : 'Copy error details'}
          </button>
        </div>
        <p className="muted small">The details are kept on this phone (Settings → System health). Paste them when asking for a fix.</p>
      </div>
    );
  }
}
