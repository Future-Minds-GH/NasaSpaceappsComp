// Catches a page that fails to load (offline, or an old file name after a new deploy) so the header stays and the visitor can reload.
// App.jsx gives it a new key on every route change, which resets it.
import { Component } from "react";

export default class RouteErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="page" role="alert">
        <p className="page-message">This page could not load. Check your connection, then reload.</p>
        <button type="button" className="button" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
