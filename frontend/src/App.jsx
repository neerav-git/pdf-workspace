import PDFSidebar from './components/PDFSidebar'
import PDFViewer from './components/PDFViewer'
import ChatPanel from './components/ChatPanel'
import './App.css'

export default function App() {
  return (
    <div className="app-layout">
      <PDFSidebar />
      <PDFViewer />
      <ChatPanel />
    </div>
  )
}
