import PDFSidebar from './components/PDFSidebar'
import PDFViewer from './components/PDFViewer'
import ChatPanel from './components/ChatPanel'
import ReviewSession from './components/ReviewSession'
import WorkspaceCompare from './components/WorkspaceCompare'
import WorkspaceIndex from './components/WorkspaceIndex'
import WorkspaceReview from './components/WorkspaceReview'
import { useAppStore } from './store'
import './App.css'

const WORKSPACE_TABS = [
  { id: 'reader', label: 'Reader', description: 'PDF + HUD' },
  { id: 'index', label: 'Index', description: 'Full knowledge map' },
  { id: 'compare', label: 'Compare', description: 'Session analysis' },
  { id: 'review', label: 'Review', description: 'Study queues' },
]

export default function App() {
  const reviewMode = useAppStore((s) => s.reviewMode)
  const workspaceMode = useAppStore((s) => s.workspaceMode)
  const setWorkspaceMode = useAppStore((s) => s.setWorkspaceMode)
  const selectedPdf = useAppStore((s) => s.selectedPdf)
  const researchSessions = useAppStore((s) => s.researchSessions)
  const activeSession = selectedPdf
    ? researchSessions.find((session) => (session.pdfs || []).some((pdf) => pdf.id === selectedPdf.id))
    : null

  return (
    <>
      {reviewMode && <ReviewSession />}
      <div className="workspace-shell">
        <header className="workspace-topbar">
          <div className="workspace-brand">
            <span className="workspace-mark">PDF Workspace</span>
            <span className="workspace-context">
              {activeSession?.title || 'Research workspace'}
              {selectedPdf ? ` · ${selectedPdf.title}` : ''}
            </span>
          </div>
          <nav className="workspace-tabs" aria-label="Workspace tabs">
            {WORKSPACE_TABS.map((tab) => (
              <button
                key={tab.id}
                className={`workspace-tab ${workspaceMode === tab.id ? 'active' : ''}`}
                onClick={() => setWorkspaceMode(tab.id)}
                type="button"
              >
                <span>{tab.label}</span>
                <small>{tab.description}</small>
              </button>
            ))}
          </nav>
        </header>

        {workspaceMode === 'reader' ? (
          <div className="app-layout">
            <PDFSidebar />
            <PDFViewer />
            <ChatPanel />
          </div>
        ) : (
          <FullPageWorkspace mode={workspaceMode} />
        )}
      </div>
    </>
  )
}

function FullPageWorkspace({ mode }) {
  const selectedPdf = useAppStore((s) => s.selectedPdf)
  const researchSessions = useAppStore((s) => s.researchSessions)
  const activeSession = selectedPdf
    ? researchSessions.find((session) => (session.pdfs || []).some((pdf) => pdf.id === selectedPdf.id))
    : null
  if (mode === 'index') {
    return (
      <main className="workspace-page">
        <PDFSidebar />
        <section className="workspace-page-main workspace-page-main--embedded">
          <WorkspaceIndex />
        </section>
      </main>
    )
  }

  if (mode === 'review') {
    return (
      <main className="workspace-page">
        <PDFSidebar />
        <section className="workspace-page-main workspace-page-main--embedded">
          <WorkspaceReview />
        </section>
      </main>
    )
  }

  if (mode === 'compare') {
    return (
      <main className="workspace-page">
        <PDFSidebar />
        <section className="workspace-page-main workspace-page-main--embedded">
          <WorkspaceCompare />
        </section>
      </main>
    )
  }

  return (
    <main className="workspace-page">
      <PDFSidebar />
      <section className="workspace-page-main">
        <div className="workspace-page-hero">
          <span>Workspace</span>
          <h1>Unknown View</h1>
          <p>Select Reader, Index, Compare, or Review from the workspace tabs.</p>
        </div>
        <div className="workspace-page-card">
          <h2>Current Context</h2>
          <dl>
            <div>
              <dt>Session</dt>
              <dd>{activeSession?.title || 'Select a PDF/session from the left sidebar'}</dd>
            </div>
            <div>
              <dt>Paper</dt>
              <dd>{selectedPdf?.title || 'No PDF selected'}</dd>
            </div>
            <div>
              <dt>Implementation note</dt>
              <dd>The full-page shell is active. Parts 2 and 3 will mount the existing Index, Review, and Compare capabilities here.</dd>
            </div>
          </dl>
        </div>
      </section>
    </main>
  )
}
