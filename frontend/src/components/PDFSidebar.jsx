import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import { listPdfs, uploadPdf, deletePdf } from '../api/pdfs'
import './PDFSidebar.css'

export default function PDFSidebar() {
  const { pdfs, setPdfs, addPdf, selectedPdf, selectPdf } = useAppStore()
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => {
    listPdfs()
      .then(setPdfs)
      .catch(() => setError('Failed to load PDFs'))
  }, [setPdfs])

  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    setUploadProgress(0)
    setError(null)
    try {
      const pdf = await uploadPdf(file, (evt) => {
        if (evt.total) setUploadProgress(Math.round((evt.loaded / evt.total) * 100))
      })
      addPdf(pdf)
      selectPdf(pdf)
    } catch (err) {
      setError(err.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    await deletePdf(id)
    setPdfs(pdfs.filter((p) => p.id !== id))
    if (selectedPdf?.id === id) selectPdf(null)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">PDF Library</span>
        <button
          className="upload-btn"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Upload PDF"
        >
          {uploading ? `${uploadProgress}%` : '+ Upload'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>

      {error && <p className="sidebar-error">{error}</p>}

      <ul className="pdf-list">
        {pdfs.length === 0 && !uploading && (
          <li className="pdf-list-empty">No PDFs yet</li>
        )}
        {pdfs.map((pdf) => (
          <li
            key={pdf.id}
            className={`pdf-item ${selectedPdf?.id === pdf.id ? 'selected' : ''}`}
            onClick={() => selectPdf(pdf)}
          >
            <div className="pdf-icon">📄</div>
            <div className="pdf-info">
              <span className="pdf-title">{pdf.title}</span>
              <span className="pdf-meta">{pdf.page_count} pages · {pdf.chunk_count} chunks</span>
            </div>
            <button
              className="pdf-delete"
              onClick={(e) => handleDelete(e, pdf.id)}
              title="Delete"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
