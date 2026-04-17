import client from './client'

export const listPdfs = () => client.get('/pdfs').then((r) => r.data)

export const uploadPdf = (file, onProgress) => {
  const form = new FormData()
  form.append('file', file)
  return client
    .post('/pdfs/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress,
    })
    .then((r) => r.data)
}

export const deletePdf = (id) => client.delete(`/pdfs/${id}`)

/** Returns a URL that streams the PDF through our backend (no CORS issues). */
export const getPdfFileUrl = (id) => `/api/pdfs/${id}/file`

export const getToc = (id) => client.get(`/pdfs/${id}/toc`).then((r) => r.data)

/**
 * Return up to n chunks from the same PDF most similar to chunkId.
 * Returns { related: [{chunk_id, chunk_index, page_number, text_preview, distance}] }
 */
export const getRelatedChunks = (pdfId, chunkId, n = 3) =>
  client
    .get(`/pdfs/${pdfId}/related-chunks`, { params: { chunk_id: chunkId, n } })
    .then((r) => r.data.related || [])
    .catch(() => [])

/**
 * Resolve a highlight to its stable chunk ID and deep section heading path.
 * Returns { chunk_id, chunk_index, section_path } — section_path includes
 * body-level subheadings (ALL-CAPS, bold) not present in the top-level TOC.
 */
export const resolveChunk = (pdfId, highlightText, pageNumber) =>
  client
    .post(`/pdfs/${pdfId}/resolve-chunk`, { highlight_text: highlightText, page_number: pageNumber })
    .then((r) => r.data)

/**
 * Distil all Q&A exchanges about a passage into a 2–3 sentence synthesis.
 * qaPairs: [{ question, answer }, ...]
 * Returns { synthesis: "..." }
 */
export const synthesizeEntry = (highlightText, qaPairs, userNote = '') =>
  client
    .post('/chat/synthesize-entry', {
      highlight_text: highlightText,
      qa_pairs: qaPairs,
      user_note: userNote,
    })
    .then((r) => r.data)
