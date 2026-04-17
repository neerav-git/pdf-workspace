import PDFSidebar from './components/PDFSidebar'
import PDFViewer from './components/PDFViewer'
import ChatPanel from './components/ChatPanel'
import ReviewSession from './components/ReviewSession'
import { useAppStore } from './store'
import './App.css'

export default function App() {
  const reviewMode = useAppStore((s) => s.reviewMode)

  return (
    <>
      {reviewMode && <ReviewSession />}
      <div className="app-layout">
        <PDFSidebar />
        <PDFViewer />
        <ChatPanel />
      </div>
    </>
  )
}
