import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    const stack = info?.componentStack || ''
    const firstLine = stack.trim().split('\n')[0] || ''

    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#0e0e0e',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'monospace', padding: 32, zIndex: 9999,
      }}>
        <div style={{ maxWidth: 640, width: '100%' }}>
          <div style={{ color: '#f87171', fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
            ⚠ Something crashed
          </div>
          <div style={{
            background: '#1a1a1a', border: '1px solid #3a0000', borderRadius: 8,
            padding: 16, marginBottom: 16,
          }}>
            <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 8 }}>
              {error.message}
            </div>
            {firstLine && (
              <div style={{ color: '#555', fontSize: 11 }}>{firstLine}</div>
            )}
          </div>
          <div style={{ color: '#555', fontSize: 12, marginBottom: 16 }}>
            Open the browser console (Cmd+Option+J) for the full stack trace.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => {
                const text = `Error: ${error.message}\n\nComponent: ${firstLine}\n\nStack:${stack}`
                navigator.clipboard.writeText(text)
              }}
              style={{
                background: '#1e3a5f', border: '1px solid #2563eb', color: '#60a5fa',
                borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer',
              }}
            >
              Copy error for Claude
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#1a1a1a', border: '1px solid #333', color: '#999',
                borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer',
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    )
  }
}
