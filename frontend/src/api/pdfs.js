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
