import { useRef, useState, useCallback } from 'react'
import { transcribeAudio } from '../api/voice'

export const RECORDER_STATE = {
  IDLE: 'idle',
  REQUESTING: 'requesting',
  RECORDING: 'recording',
  TRANSCRIBING: 'transcribing',
  ERROR: 'error',
}

const MIN_RECORDING_MS = 1500 // enforce at least 1.5 seconds

export function useVoiceRecorder({ onTranscript }) {
  const [state, setState] = useState(RECORDER_STATE.IDLE)
  const [error, setError] = useState(null)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const startTimeRef = useRef(null)
  const stopRequestedRef = useRef(false)

  const clearError = useCallback(() => {
    setError(null)
    setState(RECORDER_STATE.IDLE)
  }, [])

  const _doStop = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (state !== RECORDER_STATE.RECORDING) return
    const elapsed = Date.now() - (startTimeRef.current || 0)
    if (elapsed < MIN_RECORDING_MS) {
      // Wait until minimum duration is met
      stopRequestedRef.current = true
      setTimeout(_doStop, MIN_RECORDING_MS - elapsed)
    } else {
      _doStop()
    }
  }, [state, _doStop])

  const startRecording = useCallback(async () => {
    if (state !== RECORDER_STATE.IDLE && state !== RECORDER_STATE.ERROR) return

    setError(null)
    stopRequestedRef.current = false
    setState(RECORDER_STATE.REQUESTING)
    chunksRef.current = []

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      })
    } catch (err) {
      const msg =
        err.name === 'NotAllowedError'
          ? 'Microphone permission denied. Allow access in your browser settings.'
          : `Could not access microphone: ${err.message}`
      setError(msg)
      setState(RECORDER_STATE.ERROR)
      return
    }

    streamRef.current = stream

    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) =>
      MediaRecorder.isTypeSupported(t),
    ) || ''

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {})
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      streamRef.current = null

      const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
      console.log('[voice] blob size:', blob.size, 'bytes, type:', blob.type)

      if (blob.size < 1000) {
        setError('Recording too short or no audio detected. Please try again.')
        setState(RECORDER_STATE.ERROR)
        return
      }

      setState(RECORDER_STATE.TRANSCRIBING)
      try {
        const text = await transcribeAudio(blob)
        if (text) onTranscript(text)
        setState(RECORDER_STATE.IDLE)
      } catch (err) {
        const msg = err.response?.data?.detail || 'Transcription failed. Please try again.'
        setError(msg)
        setState(RECORDER_STATE.ERROR)
      }
    }

    // timeslice=100ms forces ondataavailable to fire regularly
    recorder.start(100)
    startTimeRef.current = Date.now()
    setState(RECORDER_STATE.RECORDING)
  }, [state, onTranscript])

  return { state, error, startRecording, stopRecording, clearError }
}
