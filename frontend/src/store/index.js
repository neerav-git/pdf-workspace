import { create } from 'zustand'

export const useAppStore = create((set, get) => ({
  // PDF library
  pdfs: [],
  selectedPdf: null,
  setPdfs: (pdfs) => set({ pdfs }),
  addPdf: (pdf) => set((s) => ({ pdfs: [pdf, ...s.pdfs] })),
  selectPdf: (pdf) => set({ selectedPdf: pdf, chatHistory: [], sources: [] }),

  // Viewer
  currentPage: 1,
  totalPages: 0,
  setCurrentPage: (p) => set({ currentPage: p }),
  setTotalPages: (n) => set({ totalPages: n }),

  // Chat
  chatHistory: [],
  sources: [],
  webSearchTriggered: false,
  isLoading: false,

  addMessage: (role, content) =>
    set((s) => ({
      chatHistory: [...s.chatHistory, { role, content }],
    })),

  setLastResponse: ({ sources, webSearchTriggered }) =>
    set({ sources, webSearchTriggered }),

  setLoading: (v) => set({ isLoading: v }),
}))
