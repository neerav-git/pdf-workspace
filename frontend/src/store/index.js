import { create } from 'zustand'
import {
  fetchHighlights,
  postHighlight,
  patchHighlight,
  deleteHighlight,
  postQA,
  patchQA,
  deleteQA,
} from '../api/highlights'

export const useAppStore = create((set, get) => ({
  // PDF library
  pdfs: [],
  selectedPdf: null,
  setPdfs: (pdfs) => set({ pdfs }),
  addPdf: (pdf) => set((s) => ({ pdfs: [pdf, ...s.pdfs] })),

  // Hydrate highlights from DB when a PDF is selected (Research F1: Postgres is source of truth)
  selectPdf: async (pdf) => {
    set({ selectedPdf: pdf, highlightIndex: [], chatHistory: [], sources: [], selectionContext: null })
    if (!pdf?.id) return
    try {
      const entries = await fetchHighlights(pdf.id)
      // Normalize DB rows; inject pdfTitle from the pdf object (not stored in highlight_entries)
      set({ highlightIndex: entries.map((row) => normalizeEntry(row, pdf.title)) })
    } catch (e) {
      console.error('Failed to load highlights:', e)
    }
  },

  // Viewer
  currentPage: 1,
  totalPages: 0,
  setCurrentPage: (p) => set({ currentPage: p }),
  setTotalPages: (n) => set({ totalPages: n }),

  // Text selection context
  selectionContext: null,
  setSelectionContext: (ctx) => set({ selectionContext: ctx }),
  clearSelectionContext: () => set({ selectionContext: null }),

  // Saved quick notes (📌 pin)
  notes: [],
  addNote: (note) => set((s) => ({ notes: [{ id: Date.now(), ...note }, ...s.notes] })),
  deleteNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),

  // ── Highlight Index ────────────────────────────────────────────────────────
  // Each entry: { id, pdfId, pdfTitle, pageNumber, sectionTitle, sectionPath,
  //               deepSectionPath, chunkId, concepts, highlightText, highlightTexts,
  //               createdAt, starred, flagged, anchored, reviewed, note, synthesis,
  //               qaPairs[] }
  // All writes: POST/PATCH/DELETE to API first → update local state with DB-returned IDs
  highlightIndex: [],

  saveToIndex: async ({ pdfId, pdfTitle, pageNumber, sectionTitle, sectionPath, deepSectionPath, chunkId, concepts, highlightText, question, answer, sourceChunkIds = [] }) => {
    const s = get()
    const existing = chunkId
      ? s.highlightIndex.find((e) => e.pdfId === pdfId && e.chunkId === chunkId)
      : s.highlightIndex.find((e) => e.pdfId === pdfId && e.highlightText === highlightText)

    if (existing) {
      // Chunk already exists — add new Q&A pair to it; merge concepts + highlight texts
      const mergedConcepts = [...new Set([...(existing.concepts || []), ...(concepts || [])])]
      const existingTexts = existing.highlightTexts || [existing.highlightText]
      const mergedTexts = existingTexts.includes(highlightText) ? existingTexts : [...existingTexts, highlightText]

      try {
        // Create QA in DB; pass selection_text so review shows the right source passage
        // when this QA is merged into an entry with a different primary highlight_text.
        const qa = await postQA(existing.id, { question, answer, source_chunk_ids: sourceChunkIds, selection_text: highlightText })
        // Patch highlight with merged concepts/texts
        await patchHighlight(existing.id, { concepts: mergedConcepts, highlight_texts: mergedTexts })
        // Update local state
        set((s2) => ({
          highlightIndex: s2.highlightIndex.map((e) =>
            e.id === existing.id
              ? { ...e, concepts: mergedConcepts, highlightTexts: mergedTexts, qaPairs: [...e.qaPairs, normalizeQA(qa)] }
              : e,
          ),
        }))
      } catch (e) {
        console.error('saveToIndex (merge) failed:', e)
      }
      return
    }

    // New entry — POST highlight, then POST QA under it
    try {
      const entry = await postHighlight(pdfId, {
        page_number: pageNumber,
        highlight_text: highlightText,
        highlight_texts: [highlightText],
        chunk_id: chunkId || null,
        section_title: sectionTitle || null,
        section_path: sectionPath || [],
        deep_section_path: deepSectionPath || null,
        concepts: concepts || [],
        note: '',
      })
      const qa = await postQA(entry.id, { question, answer, source_chunk_ids: sourceChunkIds, selection_text: highlightText })
      set((s2) => ({
        highlightIndex: [
          { ...normalizeEntry(entry), pdfTitle, qaPairs: [normalizeQA(qa)] },
          ...s2.highlightIndex,
        ],
      }))
    } catch (e) {
      console.error('saveToIndex (new) failed:', e)
    }
  },

  toggleStarEntry: async (entryId) => {
    const entry = get().highlightIndex.find((e) => e.id === entryId)
    if (!entry) return
    // Optimistic update
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, starred: !e.starred } : e,
      ),
    }))
    try {
      await patchHighlight(entryId, { starred: !entry.starred })
    } catch (e) {
      // Rollback
      set((s) => ({
        highlightIndex: s.highlightIndex.map((en) =>
          en.id === entryId ? { ...en, starred: entry.starred } : en,
        ),
      }))
      console.error('toggleStarEntry failed:', e)
    }
  },

  toggleFlagEntry: async (entryId) => {
    const entry = get().highlightIndex.find((e) => e.id === entryId)
    if (!entry) return
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, flagged: !e.flagged } : e,
      ),
    }))
    try {
      await patchHighlight(entryId, { flagged: !entry.flagged })
    } catch (e) {
      set((s) => ({
        highlightIndex: s.highlightIndex.map((en) =>
          en.id === entryId ? { ...en, flagged: entry.flagged } : en,
        ),
      }))
      console.error('toggleFlagEntry failed:', e)
    }
  },

  toggleAnchorEntry: async (entryId) => {
    const entry = get().highlightIndex.find((e) => e.id === entryId)
    if (!entry) return
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, anchored: !e.anchored } : e,
      ),
    }))
    try {
      await patchHighlight(entryId, { anchored: !entry.anchored })
    } catch (e) {
      set((s) => ({
        highlightIndex: s.highlightIndex.map((en) =>
          en.id === entryId ? { ...en, anchored: entry.anchored } : en,
        ),
      }))
      console.error('toggleAnchorEntry failed:', e)
    }
  },

  toggleReviewedEntry: async (entryId) => {
    const entry = get().highlightIndex.find((e) => e.id === entryId)
    if (!entry) return
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, reviewed: !e.reviewed } : e,
      ),
    }))
    try {
      await patchHighlight(entryId, { reviewed: !entry.reviewed })
    } catch (e) {
      set((s) => ({
        highlightIndex: s.highlightIndex.map((en) =>
          en.id === entryId ? { ...en, reviewed: entry.reviewed } : en,
        ),
      }))
      console.error('toggleReviewedEntry failed:', e)
    }
  },

  toggleStarQA: async (entryId, qaId) => {
    const entry = get().highlightIndex.find((e) => e.id === entryId)
    const qa = entry?.qaPairs?.find((q) => q.id === qaId)
    if (!qa) return
    // Optimistic update
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId
          ? { ...e, qaPairs: e.qaPairs.map((q) => (q.id === qaId ? { ...q, starred: !q.starred } : q)) }
          : e,
      ),
    }))
    try {
      await patchQA(qaId, { starred: !qa.starred })
    } catch (e) {
      set((s) => ({
        highlightIndex: s.highlightIndex.map((en) =>
          en.id === entryId
            ? { ...en, qaPairs: en.qaPairs.map((q) => (q.id === qaId ? { ...q, starred: qa.starred } : q)) }
            : en,
        ),
      }))
      console.error('toggleStarQA failed:', e)
    }
  },

  // Note: caller should debounce this (e.g. fire on blur or after 800ms idle)
  setEntryNote: async (entryId, text) => {
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, note: text } : e,
      ),
    }))
    try {
      await patchHighlight(entryId, { note: text })
    } catch (e) {
      console.error('setEntryNote failed:', e)
    }
  },

  setSynthesis: async (entryId, text) => {
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, synthesis: text } : e,
      ),
    }))
    try {
      await patchHighlight(entryId, { synthesis: text })
    } catch (e) {
      console.error('setSynthesis failed:', e)
    }
  },

  deleteIndexEntry: async (entryId) => {
    const prev = get().highlightIndex
    set((s) => ({ highlightIndex: s.highlightIndex.filter((e) => e.id !== entryId) }))
    try {
      await deleteHighlight(entryId)
    } catch (e) {
      set({ highlightIndex: prev })
      console.error('deleteIndexEntry failed:', e)
    }
  },

  deleteIndexQA: async (entryId, qaId) => {
    const prev = get().highlightIndex
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, qaPairs: e.qaPairs.filter((q) => q.id !== qaId) } : e,
      ),
    }))
    try {
      await deleteQA(qaId)
    } catch (e) {
      set({ highlightIndex: prev })
      console.error('deleteIndexQA failed:', e)
    }
  },

  // Index focus — set when user clicks "View Index" from selection menu
  // { text, pageNumber } — HighlightIndex uses this to scroll to the right entry
  indexFocus: null,
  setIndexFocus: (focus) => set({ indexFocus: focus }),
  clearIndexFocus: () => set({ indexFocus: null }),

  // External page navigation — set by any panel (index, notes) to scroll the PDF viewer
  navRequest: null,
  requestNav: (page) => set({ navRequest: page }),
  consumeNavRequest: () => set({ navRequest: null }),

  // Flash highlight — set when navigating from index to a specific passage
  // { text, pageNumber } — PDFViewer applies a temporary highlight on the target text
  flashHighlight: null,
  setFlashHighlight: (payload) => set({ flashHighlight: payload }),
  consumeFlashHighlight: () => set({ flashHighlight: null }),

  // Review session
  // scope: null = global | { pdfId } = PDF-scoped | { cards: [...] } = specific pre-loaded cards
  reviewMode: false,
  reviewScope: null,
  openReview: (scope = null) => set({ reviewMode: true, reviewScope: scope }),
  closeReview: () => set({ reviewMode: false, reviewScope: null }),

  // Chat
  chatHistory: [],
  sources: [],
  webSearchTriggered: false,
  isLoading: false,

  addMessage: (role, content, meta = null) =>
    set((s) => ({ chatHistory: [...s.chatHistory, { role, content, meta, createdAt: new Date().toISOString() }] })),

  clearHistory: () => set({ chatHistory: [], sources: [], webSearchTriggered: false }),

  setLastResponse: ({ sources, webSearchTriggered }) =>
    set({ sources, webSearchTriggered }),

  setLoading: (v) => set({ isLoading: v }),
}))

// ── Normalizers — map DB snake_case to UI camelCase ───────────────────────────

function normalizeEntry(row, pdfTitle = null) {
  return {
    id:               row.id,
    pdfId:            row.pdf_id,
    pdfTitle:         pdfTitle || row.pdfTitle || null,   // injected from selectPdf context
    pageNumber:       row.page_number,
    sectionTitle:     row.section_title,
    sectionPath:      row.section_path || [],
    deepSectionPath:  row.deep_section_path || null,
    chunkId:          row.chunk_id || null,
    concepts:         row.concepts || [],
    highlightText:    row.highlight_text,
    highlightTexts:   row.highlight_texts || [row.highlight_text],
    createdAt:        row.created_at,
    starred:          row.starred,
    flagged:          row.flagged,
    anchored:         row.anchored,
    reviewed:         row.reviewed,
    note:             row.note || '',
    synthesis:        row.synthesis || null,
    qaPairs:          (row.qa_pairs || []).map(normalizeQA),
  }
}

function normalizeQA(row) {
  return {
    id:              row.id,
    question:        row.question,
    answer:          row.answer,
    source_chunk_ids: row.source_chunk_ids || [],
    sourceChunkIds:  row.source_chunk_ids || [],
    selectionText:   row.selection_text || null,
    starred:         row.starred,
    // FSRS fields (needed by review session — Research B1)
    stability:       row.stability,
    difficulty:      row.difficulty,
    reps:            row.reps,
    lapses:          row.lapses,
    state:           row.state,
    dueAt:           row.due_at,
    lastReview:      row.last_review,
    createdAt:       row.created_at,
  }
}
