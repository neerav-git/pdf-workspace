import { useState, useCallback } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { useAppStore } from '../store'
import { getPdfFileUrl } from '../api/pdfs'
import './PDFViewer.css'

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export default function PDFViewer() {
  const { selectedPdf, currentPage, setCurrentPage, setTotalPages, totalPages } = useAppStore()
  const [scale, setScale] = useState(1.0)
  const [loadError, setLoadError] = useState(null)

  const onDocumentLoadSuccess = useCallback(
    ({ numPages }) => {
      setTotalPages(numPages)
      setCurrentPage(1)
      setLoadError(null)
    },
    [setTotalPages, setCurrentPage],
  )

  const onDocumentLoadError = useCallback((err) => {
    setLoadError(err.message || 'Failed to load PDF')
  }, [])

  if (!selectedPdf) {
    return (
      <div className="viewer viewer-empty">
        <div className="viewer-placeholder">
          <span className="viewer-placeholder-icon">📄</span>
          <p>Select a PDF from the library to view it</p>
        </div>
      </div>
    )
  }

  const fileUrl = getPdfFileUrl(selectedPdf.id)

  return (
    <div className="viewer">
      {/* Toolbar */}
      <div className="viewer-toolbar">
        <span className="viewer-title">{selectedPdf.title}</span>
        <div className="viewer-controls">
          <button
            className="viewer-btn"
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
          >
            ‹
          </button>
          <span className="viewer-page-info">
            {currentPage} / {totalPages || '—'}
          </span>
          <button
            className="viewer-btn"
            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
          >
            ›
          </button>
          <span className="viewer-sep" />
          <button
            className="viewer-btn"
            onClick={() => setScale((s) => Math.max(0.5, +(s - 0.15).toFixed(2)))}
          >
            −
          </button>
          <span className="viewer-scale">{Math.round(scale * 100)}%</span>
          <button
            className="viewer-btn"
            onClick={() => setScale((s) => Math.min(2.5, +(s + 0.15).toFixed(2)))}
          >
            +
          </button>
        </div>
      </div>

      {/* PDF canvas */}
      <div className="viewer-canvas-wrap">
        {loadError ? (
          <p className="viewer-error">{loadError}</p>
        ) : (
          <Document
            file={fileUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={<div className="viewer-loading">Loading PDF…</div>}
          >
            <Page
              pageNumber={currentPage}
              scale={scale}
              renderTextLayer
              renderAnnotationLayer
            />
          </Document>
        )}
      </div>
    </div>
  )
}
