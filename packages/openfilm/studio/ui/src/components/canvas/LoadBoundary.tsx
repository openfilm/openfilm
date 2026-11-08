/**
 * Round the canvas's own code, warmed in the background: when it cannot load (a Studio updated or rebuilt since the
 * page loaded, the network gone), the board says so and offers to load the page again, rather than the page going
 * blank.
 */
import React from 'react';
import { RotateCw } from 'lucide-react';

export class LoadBoundary extends React.Component<{ children: React.ReactNode; title: string; action: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[var(--cv-bg)] text-[13px] text-[var(--cv-label)]">
        {this.props.title}
        <button type="button" onClick={() => window.location.reload()}
          className="flex h-8 items-center gap-1.5 rounded-lg border !border-[var(--cv-float-line)] bg-[var(--cv-float)] px-3 text-[12.5px] text-[var(--cv-ink)] hover:bg-[var(--cv-float-hover)]">
          <RotateCw size={13} />{this.props.action}
        </button>
      </div>
    );
  }
}
