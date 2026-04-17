import { create } from 'zustand'

export const useAppStore = create((set, get) => ({
  // PDF library
  pdfs: [],
  selectedPdf: null,
  setPdfs: (pdfs) => set({ pdfs }),
  addPdf: (pdf) => set((s) => ({ pdfs: [pdf, ...s.pdfs] })),
  selectPdf: (pdf) => set({ selectedPdf: pdf, chatHistory: [], sources: [], selectionContext: null }),

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
  //               deepSectionPath, chunkId, concepts, highlightText, createdAt,
  //               starred, flagged, anchored, reviewed, qaPairs[] }
  // sectionTitle:     leaf heading string (for display)
  // sectionPath:      [{title, level}, ...] root→leaf from TOC (coarse, always present)
  // deepSectionPath:  [{title, level}, ...] root→leaf from font analysis (fine-grained,
  //                   includes body-level subheadings not in the outline; may be null)
  // chunkId:          stable ChromaDB chunk identifier (e.g. "pdf_1_chunk_42")
  // concepts:         string[] — 2–4 concept tags extracted by Haiku at save time
  // flagged:          bool — needs attention / want to revisit
  // anchored:         bool — foundational concept, other knowledge builds on this
  // reviewed:         bool — consciously worked through
  // Each qaPair: { id, question, answer, starred, createdAt }
  highlightIndex: [],

  saveToIndex: ({ pdfId, pdfTitle, pageNumber, sectionTitle, sectionPath, deepSectionPath, chunkId, concepts, highlightText, question, answer }) =>
    set((s) => {
      // Use chunkId for dedup when available (stable anchor), else fall back to text match
      const existing = chunkId
        ? s.highlightIndex.find((e) => e.pdfId === pdfId && e.chunkId === chunkId)
        : s.highlightIndex.find((e) => e.pdfId === pdfId && e.highlightText === highlightText)

      const qa = {
        id: Date.now(),
        question,
        answer,
        starred: false,
        createdAt: new Date().toISOString(),
      }
      if (existing) {
        // Merge concepts (dedup) and accumulate all unique highlight texts.
        // highlightTexts[] preserves every distinct selection made in this chunk
        // so the lens can highlight all of them, not just the first.
        const merged = [...new Set([...(existing.concepts || []), ...(concepts || [])])]
        const existingTexts = existing.highlightTexts || [existing.highlightText]
        const mergedTexts = existingTexts.includes(highlightText)
          ? existingTexts
          : [...existingTexts, highlightText]
        return {
          highlightIndex: s.highlightIndex.map((e) =>
            e.id === existing.id
              ? { ...e, concepts: merged, highlightTexts: mergedTexts, qaPairs: [...e.qaPairs, qa] }
              : e,
          ),
        }
      }
      return {
        highlightIndex: [
          {
            id: Date.now() + 1,
            pdfId,
            pdfTitle,
            pageNumber,
            sectionTitle: sectionTitle || null,
            sectionPath: sectionPath || [],
            deepSectionPath: deepSectionPath || null,
            chunkId: chunkId || null,
            concepts: concepts || [],
            highlightText,
            highlightTexts: [highlightText],   // all distinct selections in this chunk
            createdAt: new Date().toISOString(),
            starred: false,
            flagged: false,
            anchored: false,
            reviewed: false,
            note: '',
            synthesis: null,   // generated on demand; null = never requested
            qaPairs: [qa],
          },
          ...s.highlightIndex,
        ],
      }
    }),

  toggleStarEntry: (entryId) =>
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, starred: !e.starred } : e,
      ),
    })),

  toggleFlagEntry: (entryId) =>
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, flagged: !e.flagged } : e,
      ),
    })),

  toggleAnchorEntry: (entryId) =>
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, anchored: !e.anchored } : e,
      ),
    })),

  toggleReviewedEntry: (entryId) =>
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, reviewed: !e.reviewed } : e,
      ),
    })),

  toggleStarQA: (entryId, qaId) =>
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId
          ? { ...e, qaPairs: e.qaPairs.map((q) => (q.id === qaId ? { ...q, starred: !q.starred } : q)) }
          : e,
      ),
    })),

  setEntryNote: (entryId, text) =>
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, note: text } : e,
      ),
    })),

  setSynthesis: (entryId, text) =>
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, synthesis: text } : e,
      ),
    })),

  deleteIndexEntry: (entryId) =>
    set((s) => ({ highlightIndex: s.highlightIndex.filter((e) => e.id !== entryId) })),

  deleteIndexQA: (entryId, qaId) =>
    set((s) => ({
      highlightIndex: s.highlightIndex.map((e) =>
        e.id === entryId ? { ...e, qaPairs: e.qaPairs.filter((q) => q.id !== qaId) } : e,
      ),
    })),

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

  // Chat
  chatHistory: [],
  sources: [],
  webSearchTriggered: false,
  isLoading: false,

  addMessage: (role, content, meta = null) =>
    set((s) => ({ chatHistory: [...s.chatHistory, { role, content, meta }] })),

  setLastResponse: ({ sources, webSearchTriggered }) =>
    set({ sources, webSearchTriggered }),

  setLoading: (v) => set({ isLoading: v }),
}))
