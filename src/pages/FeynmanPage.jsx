import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import {
  BrainCircuit,
  Play,
  Loader,
  Mic,
  MicOff,
  MessageSquare,
  GraduationCap,
  RotateCcw,
  ArrowLeft,
} from 'lucide-react'
import useAppStore from '../stores/appStore'
import { useActiveKit, useKitRoutePrefix } from '../stores/useKitStore'
import { feynmanApi } from '../utils/pedagogyApi'
import RubricFeedbackCard from '../components/drills/RubricFeedbackCard'

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
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [result, setResult] = useState(null)
  const [isRecording, setIsRecording] = useState(false)

  const recognitionRef = useRef(null)

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

  // Sync URL ?node=<nodeId> param on entry / change
  useEffect(() => {
    if (nodeParam && skeleton.graph.nodes.some((n) => n.id === nodeParam)) {
      setSelectedNodeId(nodeParam)
    }
  }, [nodeParam, skeleton.graph.nodes])

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true

      recognition.onresult = (event) => {
        let finalTranscript = ''
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript + ' '
          }
        }
        if (finalTranscript) {
          setExplanation((prev) => prev + finalTranscript)
        }
      }

      recognition.onerror = (event) => {
        console.error('Speech recognition error', event.error)
        setIsRecording(false)
      }

      recognition.onend = () => {
        setIsRecording(false)
      }

      recognitionRef.current = recognition
    }
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }
  }, [])

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      addToast({ type: 'error', message: 'Voice recording is not supported in this browser.' })
      return
    }
    if (isRecording) {
      recognitionRef.current.stop()
      setIsRecording(false)
    } else {
      recognitionRef.current.start()
      setIsRecording(true)
    }
  }

  const effectiveConceptName = selectedNode ? selectedNode.name : customTopic.trim()

  const handleSelectNode = (val) => {
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
      addToast({ type: 'error', message: err.message || 'Failed to evaluate explanation.' })
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div className="page-layout feynman-container" id="feynman-page">
      <div className="page-header">
        <div>
          {prefix && (
            <Link
              to={prefix}
              className="text-xs font-semibold text-on-primary-wash hover:underline inline-flex items-center gap-1 mb-1"
            >
              <ArrowLeft size={13} />
              Back to {skeleton.identity.name} Path
            </Link>
          )}
          <h1 className="page-title feynman-title">
            <BrainCircuit className="icon-accent" size={24} />
            Feynman Simulator
          </h1>
          <p className="page-subtitle">
            Teach a concept from first principles without hiding behind jargon — graded against your {skeleton.identity.name} curriculum rubric.
          </p>
        </div>
      </div>

      <div className="card feynman-card">
        <div className="space-y-3">
          <div>
            <label
              htmlFor="feynman-node-select"
              style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-2)' }}
            >
              Concept Node ({skeleton.identity.name})
            </label>
            <select
              id="feynman-node-select"
              data-testid="feynman-node-select"
              className="input"
              value={selectedNodeId}
              onChange={(e) => handleSelectNode(e.target.value)}
              disabled={isAnalyzing}
            >
              <option value="">Custom Freeform Topic…</option>
              {nodesByPillar.map(({ pillar, nodes }) =>
                nodes.length > 0 ? (
                  <optgroup key={pillar.id} label={`Pillar ${pillar.number}: ${pillar.name}`}>
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
              <strong className="text-on-surface">{selectedNode.name}:</strong> {selectedNode.summary}
            </div>
          ) : (
            <div>
              <label
                htmlFor="feynman-custom-topic"
                style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, marginBottom: 'var(--space-1)' }}
              >
                Or enter any custom concept:
              </label>
              <input
                id="feynman-custom-topic"
                className="input"
                placeholder="e.g., Consistent Hashing, Paxos, Borrow Checker"
                value={customTopic}
                onChange={(e) => setCustomTopic(e.target.value)}
                disabled={isAnalyzing}
              />
            </div>
          )}
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <label htmlFor="feynman-explanation-input" style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
              Explain it clearly from first principles:
            </label>
            <button
              type="button"
              className={`btn btn-sm ${isRecording ? 'btn-primary' : 'btn-outline'}`}
              onClick={toggleRecording}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              disabled={isAnalyzing}
            >
              {isRecording ? <MicOff size={14} /> : <Mic size={14} />}
              {isRecording ? 'Stop Recording' : 'Voice Record'}
            </button>
          </div>
          <textarea
            id="feynman-explanation-input"
            data-testid="feynman-explanation-input"
            className="input feynman-textarea"
            placeholder="Explain the core mechanism, why it is needed, unpack any specialized terms, and state what breaks when assumptions fail..."
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            disabled={isAnalyzing}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleAnalyze}
            disabled={isAnalyzing || !effectiveConceptName || !explanation.trim()}
            id="feynman-analyze-btn"
          >
            {isAnalyzing ? <Loader className="spin" size={16} /> : <Play size={16} />}
            {isAnalyzing ? 'Evaluating Against Rubric...' : 'Analyze Explanation'}
          </button>
        </div>
      </div>

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
