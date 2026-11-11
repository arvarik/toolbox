import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router'
import {
  Play,
  Loader2,
  Mic,
  MicOff,
  MessageSquare,
  GraduationCap,
  RotateCcw,
  ArrowLeft,
} from 'lucide-react'
import { KitAvatar, NotebookSheet, VoiceWaveform } from '../components/ui'
import useAppStore from '../stores/appStore'
import { useActiveKit, useKitRoutePrefix } from '../stores/useKitStore'
import { feynmanApi } from '../utils/pedagogyApi'
import RubricFeedbackCard from '../components/drills/RubricFeedbackCard'

type FeynmanEvaluation = Awaited<ReturnType<typeof feynmanApi.evaluate>>

interface SpeechRecognitionResultEntry {
  isFinal: boolean
  0: { transcript: string }
}

interface SpeechRecognitionResultEvent {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultEntry>
}

interface SpeechRecognitionInstance {
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance

export default function FeynmanPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const nodeParam = searchParams.get('node') || ''
  const prefix = useKitRoutePrefix()
  const { skeleton, pillars } = useActiveKit()

  const model = useAppStore((s) => s.model)
  const addToast = useAppStore((s) => s.addToast)

  const [selectedNodeId, setSelectedNodeId] = useState(nodeParam || '')
  const [customTopic, setCustomTopic] = useState('')
  const [explanation, setExplanation] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [result, setResult] = useState<FeynmanEvaluation | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const prevKitKeyRef = useRef(`${prefix}:${skeleton.identity.slug}`)

  useEffect(() => {
    if (!isRecording) return
    const timer = setInterval(() => {
      setRecordingSeconds((s) => s + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [isRecording])

  const nodesByPillar = useMemo(() => {
    return pillars.map((p) => ({
      pillar: p,
      nodes: skeleton.graph.nodes.filter((n) => n.pillarId === p.id),
    }))
  }, [pillars, skeleton.graph.nodes])

  const selectedNode = useMemo(
    () => skeleton.graph.nodes.find((n) => n.id === selectedNodeId) || null,
    [skeleton.graph.nodes, selectedNodeId],
  )

  // Reset dangling node selection, active dictation & verdict when switching Kits on /k/:slug/feynman
  useEffect(() => {
    const kitKey = `${prefix}:${skeleton.identity.slug}`
    if (prevKitKeyRef.current !== kitKey) {
      prevKitKeyRef.current = kitKey
      try {
        recognitionRef.current?.stop()
      } catch {
        // ignore if already stopped
      }
      setIsRecording(false)
      setRecordingSeconds(0)
      setInterimTranscript('')
      setResult(null)
      setExplanation('')
      setCustomTopic('')
      if (!nodeParam || !skeleton.graph.nodes.some((n) => n.id === nodeParam)) {
        setSelectedNodeId('')
      }
    }
  }, [prefix, skeleton.identity.slug, skeleton.graph.nodes, nodeParam])

  // Sync URL ?node=<nodeId> param on entry / change
  useEffect(() => {
    if (nodeParam && skeleton.graph.nodes.some((n) => n.id === nodeParam)) {
      setSelectedNodeId(nodeParam)
    }
  }, [nodeParam, skeleton.graph.nodes])

  useEffect(() => {
    const win = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor
      webkitSpeechRecognition?: SpeechRecognitionConstructor
    }
    const SpeechRecognitionCtor = win.SpeechRecognition || win.webkitSpeechRecognition
    if (SpeechRecognitionCtor) {
      const recognition = new SpeechRecognitionCtor()
      recognition.continuous = true
      recognition.interimResults = true

      recognition.onresult = (event) => {
        let finalChunk = ''
        let liveInterim = ''
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcript = event.results[i][0].transcript
          if (event.results[i].isFinal) {
            finalChunk += `${transcript} `
          } else {
            liveInterim += transcript
          }
        }
        if (finalChunk) {
          setExplanation((prev) => prev + finalChunk)
        }
        setInterimTranscript(liveInterim)
      }

      recognition.onerror = (event) => {
        console.error('Speech recognition error', event.error)
        setInterimTranscript('')
        setIsRecording(false)
      }

      recognition.onend = () => {
        setInterimTranscript('')
        setIsRecording(false)
      }

      recognitionRef.current = recognition
    }
    return () => {
      try {
        recognitionRef.current?.stop()
      } catch {
        // ignore if already stopped
      }
    }
  }, [])

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      addToast({ type: 'error', message: 'Voice recording is not supported in this browser.' })
      return
    }
    if (isRecording) {
      try {
        recognitionRef.current.stop()
      } catch {
        // ignore if already stopped
      }
      setInterimTranscript('')
      setIsRecording(false)
    } else {
      try {
        setRecordingSeconds(0)
        setInterimTranscript('')
        recognitionRef.current.start()
        setIsRecording(true)
      } catch {
        // Recognition may still be stopping from a rapid double-click
        setIsRecording(false)
      }
    }
  }

  const effectiveConceptName = selectedNode ? selectedNode.name : customTopic.trim()

  const handleSelectNode = (val: string) => {
    setSelectedNodeId(val)
    setResult(null)
    const next = new URLSearchParams(searchParams)
    if (val) {
      next.set('node', val)
    } else {
      next.delete('node')
    }
    setSearchParams(next, { replace: true })
  }

  const handlePracticeInChat = () => {
    const gaps = [
      ...(result?.factualOrLogicalErrors || []).map((e) => `- Factual/Logical Error: ${e}`),
      ...(result?.unexplainedJargon || []).map((j) => `- Unexplained Jargon: ${j}`),
      ...(result?.rubricChecks || [])
        .filter((rc) => !rc.met)
        .map((rc) => `- Missing Rubric Point (${rc.point}): ${rc.evidenceOrGap}`),
    ].join('\n')

    try {
      sessionStorage.setItem(
        'toolbox_chat_draft',
        `I practiced explaining "${effectiveConceptName}" via the Feynman Simulator.\n\nMy explanation was:\n> ${explanation}\n\nThe rubric evaluation highlighted these gaps:\n${gaps || result?.constructiveFeedback || 'Refine precision and edge cases.'}\n\nPlease help me master these missing points with Socratic questions!`,
      )
      window.dispatchEvent(new CustomEvent('toolbox-chat-draft'))
      navigate(`${prefix}/chat`)
    } catch {
      navigate(`${prefix}/chat`)
    }
  }

  const handleReset = () => {
    try {
      recognitionRef.current?.stop()
    } catch {
      // ignore if already stopped
    }
    setIsRecording(false)
    setRecordingSeconds(0)
    setInterimTranscript('')
    setSelectedNodeId('')
    setCustomTopic('')
    setExplanation('')
    setResult(null)
    const next = new URLSearchParams(searchParams)
    next.delete('node')
    setSearchParams(next, { replace: true })
  }

  const handleAnalyze = async () => {
    if (!effectiveConceptName || !explanation.trim()) {
      addToast({ type: 'error', message: 'Please select or enter a concept and write your explanation.' })
      return
    }

    setIsAnalyzing(true)
    setResult(null)

    try {
      const evaluated = await feynmanApi.evaluate({
        nodeId: selectedNode?.id || undefined,
        pillarId: selectedNode?.pillarId || undefined,
        topicId: selectedNode?.topicId || undefined,
        conceptName: effectiveConceptName,
        explanation: explanation.trim(),
        model,
      })
      setResult(evaluated)
      useAppStore.getState().bumpSrsVersion()
      if (evaluated.pass) {
        useAppStore.getState().triggerAhaMoment()
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to evaluate explanation.' })
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div
      className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6"
      id="feynman-page"
    >
      <header className="space-y-1.5">
        {prefix && (
          <Link
            to={prefix}
            className="text-xs font-semibold text-on-primary-wash hover:underline inline-flex items-center gap-1"
          >
            <ArrowLeft size={13} />
            Back to {skeleton.identity.name} Path
          </Link>
        )}
        <div className="flex items-center gap-3">
          <KitAvatar size={24} state={isAnalyzing ? 'thinking' : 'idle'} />
          <h1 className="font-serif text-2xl sm:text-3xl font-normal text-on-surface tracking-tight">
            Feynman Simulator
          </h1>
        </div>
        <p className="text-sm text-on-surface-variant">
          Teach a concept from first principles without jargon, graded against
          your curriculum rubric.
        </p>
      </header>

      <NotebookSheet className="p-5 sm:p-6 space-y-5">
        <div className="space-y-3">
          <div>
            <label
              htmlFor="feynman-node-select"
              className="block text-sm font-medium text-on-surface mb-1.5"
            >
              Concept Node ({skeleton.identity.name})
            </label>
            <select
              id="feynman-node-select"
              data-testid="feynman-node-select"
              className="input w-full"
              value={selectedNodeId}
              onChange={(e) => handleSelectNode(e.target.value)}
              disabled={isAnalyzing}
            >
              <option value="">Custom Freeform Topic…</option>
              {nodesByPillar.map(({ pillar, nodes }) =>
                nodes.length > 0 ? (
                  <optgroup
                    key={pillar.id}
                    label={`Pillar ${pillar.number}: ${pillar.name}`}
                  >
                    {nodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null,
              )}
            </select>
          </div>

          {selectedNode ? (
            <div className="rounded-xl border border-outline-variant bg-surface-container p-3 text-xs text-on-surface-variant">
              <strong className="text-on-surface">{selectedNode.name}:</strong>{' '}
              {selectedNode.summary}
            </div>
          ) : (
            <div>
              <label
                htmlFor="feynman-custom-topic"
                className="block text-xs font-medium text-on-surface-variant mb-1"
              >
                Or enter any custom concept:
              </label>
              <input
                id="feynman-custom-topic"
                className="input w-full"
                placeholder="e.g., Consistent Hashing, Paxos, Borrow Checker"
                value={customTopic}
                onChange={(e) => setCustomTopic(e.target.value)}
                disabled={isAnalyzing}
              />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor="feynman-explanation-input"
              className="text-sm font-medium text-on-surface"
            >
              Explain it clearly from first principles:
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <VoiceWaveform
                recording={isRecording}
                seconds={recordingSeconds}
                className="py-1.5 px-3"
              />
              <button
                type="button"
                className={`btn btn-sm ${isRecording ? 'btn-primary' : 'btn-secondary'}`}
                onClick={toggleRecording}
                disabled={isAnalyzing}
              >
                {isRecording ? <MicOff size={14} /> : <Mic size={14} />}
                {isRecording ? 'Stop Recording' : 'Voice Record'}
              </button>
            </div>
          </div>
          <textarea
            id="feynman-explanation-input"
            data-testid="feynman-explanation-input"
            className="input feynman-textarea w-full min-h-[160px]"
            placeholder="Explain the core mechanism, why it is needed, unpack any specialized terms, and state what breaks when assumptions fail..."
            value={explanation + interimTranscript}
            onChange={(e) => {
              setInterimTranscript('')
              setExplanation(e.target.value)
            }}
            disabled={isAnalyzing}
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              void handleAnalyze()
            }}
            disabled={isAnalyzing || !effectiveConceptName || !explanation.trim()}
            id="feynman-analyze-btn"
          >
            {isAnalyzing ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <Play size={16} />
            )}
            {isAnalyzing ? 'Evaluating Against Rubric...' : 'Analyze Explanation'}
          </button>
        </div>
      </NotebookSheet>

      {result && (
        <div className="space-y-4">
          <RubricFeedbackCard
            result={result}
            title={`Feynman Teach-Back Verdict · ${result.conceptName || effectiveConceptName}`}
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handlePracticeInChat}
              id="feynman-practice-chat-btn"
              data-testid="feynman-practice-chat-btn"
            >
              <MessageSquare size={13} /> Practice Missing Gaps in Socratic Chat
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigate(`${prefix}/study`)}
              id="feynman-study-flashcards-btn"
            >
              <GraduationCap size={13} /> Study Flashcards
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleReset}
              id="feynman-reset-btn"
            >
              <RotateCcw size={13} /> New Topic
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
