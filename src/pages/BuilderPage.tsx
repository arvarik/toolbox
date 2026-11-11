import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { MessageSquare, Save, Layout, Download, Calculator, ShieldCheck } from 'lucide-react'
import Toolbox from '../components/builder/Toolbox'
import Canvas from '../components/builder/Canvas'
import BoardList, { type BoardTabItem } from '../components/builder/BoardList'
import TemplateGallery, { type CanvasTemplateItem } from '../components/builder/TemplateGallery'
import ArchitectureAuditModal from '../components/builder/ArchitectureAuditModal'
import ChatPanel from '../components/shared/ChatPanel'
import useAppStore from '../stores/appStore'
import { useActiveKit, useKitRoutePrefix } from '../stores/useKitStore'
import useIsMobile from '../hooks/useIsMobile'
import '../components/graph/graph-flow.css'
import { boardsApi } from '../utils/api'
import { auditArchitecture, type AuditReport } from '../utils/architectureLinter'
import {
  toFlowNodes,
  toFlowEdges,
  toBoardData,
  categoryColor,
  DEFAULT_CONCEPT_PROTOCOLS,
  readStoreEdges,
  readStoreNodes,
  writeStoreGraph,
  type PersistedBoardData,
} from '../components/builder/boardModel'

// Auto-save debounce interval (ms)
const AUTO_SAVE_DELAY = 3000

interface ServerBoardDetail {
  id: string
  name: string
  data?: Partial<PersistedBoardData>
}

export default function BuilderPage() {
  const toggleChat = useAppStore((s) => s.toggleChat)
  const setCalcModalOpen = useAppStore((s) => s.setCalcModalOpen)
  const [searchParams] = useSearchParams()
  const nodes = useAppStore((s) => readStoreNodes(s))
  const edges = useAppStore((s) => readStoreEdges(s))
  const addToast = useAppStore((s) => s.addToast)
  const { kit, kitSlug, skeleton, capabilities } = useActiveKit()
  const prefix = useKitRoutePrefix()

  const canvasMode: 'concept' | 'architecture' =
    capabilities?.canvas === 'concept' ? 'concept' : 'architecture'
  const isConceptMode = canvasMode === 'concept'

  const protocolOptions = useMemo(() => {
    const configured = skeleton?.canvasConfig?.protocols || []
    if (configured.length > 0) return configured
    return isConceptMode ? DEFAULT_CONCEPT_PROTOCOLS : []
  }, [skeleton, isConceptMode])

  const [activeEdgeLabel, setActiveEdgeLabel] = useState('')
  useEffect(() => {
    setActiveEdgeLabel(isConceptMode ? (protocolOptions[0] || 'implies') : '')
  }, [isConceptMode, protocolOptions])

  const [boards, setBoards] = useState<BoardTabItem[]>([])
  const [activeBoard, setActiveBoard] = useState<string | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showAuditModal, setShowAuditModal] = useState(false)
  const auditReport = useMemo<AuditReport>(
    () => auditArchitecture(nodes, edges, { mode: canvasMode }),
    [nodes, edges, canvasMode]
  )
  const isMobile = useIsMobile()
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedData = useRef<string | null>(null)

  // Track which board IDs are local-only (not yet saved to DB)
  const [unsavedIds, setUnsavedIds] = useState<Set<string>>(() => new Set())

  // Prevent the board-load effect from clearing canvas when we just dropped a node
  const skipNextLoad = useRef(false)

  // ─── Initial Load (and reload when active Kit changes) ───
  useEffect(() => {
    let cancelled = false

    // Immediately cancel any pending auto-save and clear previous Kit's canvas
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current)
      autoSaveTimer.current = null
    }
    skipNextLoad.current = false
    lastSavedData.current = null
    setActiveBoard(null)
    setBoards([])
    setUnsavedIds(new Set())
    setShowTemplates(false)
    setShowAuditModal(false)
    writeStoreGraph({ nodes: [], edges: [] })

    // No saved boards, or the list request failed: start a default local board
    const startLocalBoard = () => {
      const newBoard: BoardTabItem = {
        id: `local-${Date.now()}`,
        name: isConceptMode ? 'Untitled Concept Map' : 'Untitled Board',
      }
      skipNextLoad.current = true
      setBoards([newBoard])
      setActiveBoard(newBoard.id)
      setUnsavedIds(new Set([newBoard.id]))
    }

    boardsApi.list<BoardTabItem>().then((rawList) => {
      if (cancelled) return
      const list = Array.isArray(rawList) ? rawList : []
      if (list.length > 0) {
        setBoards(list)
        // Deep link support: /builder?board=<id> (e.g. from the Knowledge Graph)
        const requested = searchParams.get('board')
        const match = requested ? list.find((b) => b.id === requested) : undefined
        setActiveBoard((match ?? list[0]).id)
      } else {
        startLocalBoard()
      }
    }).catch(() => {
      if (!cancelled) startLocalBoard()
    })

    return () => { cancelled = true }
    // Reload boards if the active Kit or route prefix changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit?.id, kitSlug, prefix])

  // ─── Load board data when activeBoard changes ───
  useEffect(() => {
    if (!activeBoard) return

    // Skip if flagged (e.g., after a save promotion that shouldn't trigger reload)
    if (skipNextLoad.current) {
      skipNextLoad.current = false
      return
    }

    // Local (unsaved) boards have no data on the server
    if (unsavedIds.has(activeBoard)) {
      writeStoreGraph({ nodes: [], edges: [] })
      lastSavedData.current = null
      return
    }

    let cancelled = false
    // Load from server (persisted board shape → React Flow shape)
    boardsApi.get<ServerBoardDetail | null>(activeBoard).then((board) => {
      if (cancelled) return
      if (board && board.data) {
        const boardNodes = board.data.nodes || []
        const boardEdges = board.data.edges || []
        writeStoreGraph({
          nodes: toFlowNodes(boardNodes),
          edges: toFlowEdges(boardEdges, boardNodes),
        })
        lastSavedData.current = JSON.stringify({ nodes: boardNodes, edges: boardEdges })
      } else {
        writeStoreGraph({ nodes: [], edges: [] })
        lastSavedData.current = null
      }
    }).catch(() => {
      if (cancelled) return
      writeStoreGraph({ nodes: [], edges: [] })
      lastSavedData.current = null
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBoard])

  // ─── Auto-save: debounced save when nodes or edges change ───
  // Compare and persist in the board shape, so selection/drag churn in
  // the React Flow state never triggers a save on its own.
  useEffect(() => {
    // Skip local (unsaved) boards
    if (!activeBoard || unsavedIds.has(activeBoard)) return

    const boardData = toBoardData(nodes, edges)
    const currentData = JSON.stringify(boardData)
    if (currentData === lastSavedData.current) return

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)

    autoSaveTimer.current = setTimeout(async () => {
      const currentBoard = boards.find((b) => b.id === activeBoard)
      if (!currentBoard) return
      try {
        await boardsApi.update(activeBoard, { name: currentBoard.name, data: boardData })
        lastSavedData.current = currentData
      } catch {
        // Silent fail for auto-save
      }
    }, AUTO_SAVE_DELAY)

    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
  }, [nodes, edges, activeBoard, boards, unsavedIds])

  // ─── Board Management Handlers ───

  const handleNewBoard = useCallback(() => {
    const newId = `local-${Date.now()}`
    const newBoard: BoardTabItem = { id: newId, name: `Board ${boards.length + 1}` }
    setBoards((prev) => [...prev, newBoard])
    setUnsavedIds((prev) => new Set([...prev, newId]))
    setActiveBoard(newId)
  }, [boards.length])

  const ensureSavedBoard = useCallback(async ({ silent = false }: { silent?: boolean } = {}): Promise<string | null> => {
    if (!activeBoard) return null
    const currentBoard = boards.find((b) => b.id === activeBoard)
    if (!currentBoard) return null

    const name = currentBoard.name
    const data = toBoardData(nodes, edges)
    const isLocal = unsavedIds.has(activeBoard)

    if (isLocal) {
      const saved = (await boardsApi.create({ name, data })) as BoardTabItem
      setBoards((prev) =>
        prev.map((b) => (b.id === activeBoard ? { ...b, id: saved.id, name: saved.name } : b))
      )
      setUnsavedIds((prev) => {
        const next = new Set(prev)
        next.delete(activeBoard)
        return next
      })
      skipNextLoad.current = true
      setActiveBoard(saved.id)
      lastSavedData.current = JSON.stringify(data)
      if (!silent) addToast({ type: 'success', message: 'Board created and saved' })
      return saved.id
    }

    await boardsApi.update(activeBoard, { name, data })
    lastSavedData.current = JSON.stringify(data)
    if (!silent) addToast({ type: 'success', message: 'Board saved' })
    return activeBoard
  }, [activeBoard, boards, nodes, edges, unsavedIds, addToast])

  const handleSaveBoard = useCallback(async () => {
    try {
      await ensureSavedBoard({ silent: false })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error && err.message ? err.message : 'Failed to save board',
      })
    }
  }, [ensureSavedBoard, addToast])

  const handleRenameBoard = useCallback(async (id: string, newName: string) => {
    // Update local state immediately
    setBoards((prev) => prev.map((b) => (b.id === id ? { ...b, name: newName } : b)))

    // If saved, also update on server
    if (!unsavedIds.has(id)) {
      try {
        await boardsApi.rename(id, newName)
      } catch {
        addToast({ type: 'error', message: 'Failed to rename board' })
      }
    }
  }, [unsavedIds, addToast])

  const handleDeleteBoard = useCallback(async (id: string) => {
    // Don't delete the last board
    if (boards.length <= 1) {
      addToast({ type: 'warning', message: 'Cannot delete the last board' })
      return
    }

    // If saved, delete from server
    if (!unsavedIds.has(id)) {
      try {
        await boardsApi.delete(id)
      } catch {
        addToast({ type: 'error', message: 'Failed to delete board' })
        return
      }
    }

    // Remove from local state
    setBoards((prev) => prev.filter((b) => b.id !== id))
    setUnsavedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })

    // If deleting the active board, switch to another
    if (id === activeBoard) {
      const remaining = boards.filter((b) => b.id !== id)
      if (remaining[0]) {
        setActiveBoard(remaining[0].id)
      }
    }

    addToast({ type: 'success', message: 'Board deleted' })
  }, [boards, activeBoard, unsavedIds, addToast])

  const handleDuplicateBoard = useCallback((id: string) => {
    const source = boards.find((b) => b.id === id)
    if (!source) return

    const newId = `local-${Date.now()}`
    const newBoard: BoardTabItem = { id: newId, name: `${source.name} (copy)` }
    setBoards((prev) => {
      const idx = prev.findIndex((b) => b.id === id)
      const next = [...prev]
      next.splice(idx + 1, 0, newBoard)
      return next
    })
    setUnsavedIds((prev) => new Set([...prev, newId]))

    // If duplicating the active board, copy nodes/edges too
    if (id === activeBoard) {
      const clonedNodes = [...nodes]
      const clonedEdges = [...edges]
      setActiveBoard(newId)
      setTimeout(() => {
        writeStoreGraph({ nodes: clonedNodes, edges: clonedEdges })
      }, 0)
    } else {
      setActiveBoard(newId)
    }

    addToast({ type: 'success', message: `Duplicated "${source.name}"` })
  }, [boards, activeBoard, nodes, edges, addToast])

  const handleReorderBoards = useCallback(async (reorderedBoards: BoardTabItem[]) => {
    setBoards(reorderedBoards)

    // Only persist order for saved boards
    const savedIds = reorderedBoards
      .filter((b) => !unsavedIds.has(b.id))
      .map((b) => b.id)

    if (savedIds.length > 0) {
      try {
        await boardsApi.reorder(savedIds)
      } catch {
        // Silent fail for reorder
      }
    }
  }, [unsavedIds])

  // ─── Canvas Handlers ───

  // Load template onto canvas (templates ship in the persisted board shape)
  const handleLoadTemplate = (template: CanvasTemplateItem) => {
    const ts = Date.now()
    const idMap: Record<string, string> = {}
    const newNodes = template.nodes.map((n) => {
      const newId = `${n.id}-${ts}`
      idMap[n.id] = newId
      return { ...n, id: newId }
    })
    const newEdges = template.edges.map((e) => ({
      ...e,
      id: `${e.id}-${ts}`,
      from: idMap[e.from] || e.from,
      to: idMap[e.to] || e.to,
    }))
    writeStoreGraph({
      nodes: toFlowNodes(newNodes),
      edges: toFlowEdges(newEdges, newNodes),
    })
    setShowTemplates(false)
    addToast({ type: 'success', message: `Loaded "${template.name}" template` })
  }

  // Export board as PNG image (draws from the persisted board shape)
  const handleExportImage = useCallback(() => {
    const canvasEl = document.getElementById('builder-canvas')
    if (!canvasEl) return

    try {
      const { nodes: boardNodes, edges: boardEdges } = toBoardData(nodes, edges)
      const rect = canvasEl.getBoundingClientRect()
      const canvas2d = document.createElement('canvas')
      const scale = 2
      canvas2d.width = rect.width * scale
      canvas2d.height = rect.height * scale
      const ctx = canvas2d.getContext('2d')
      if (!ctx) return

      const isDark = document.documentElement.getAttribute('data-theme') !== 'light'
      ctx.fillStyle = isDark ? '#16161d' : '#f1f3f5'
      ctx.fillRect(0, 0, canvas2d.width, canvas2d.height)

      // Draw dot grid
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)'
      for (let x = 0; x < canvas2d.width; x += 24 * scale) {
        for (let y = 0; y < canvas2d.height; y += 24 * scale) {
          ctx.beginPath()
          ctx.arc(x, y, 1 * scale, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      ctx.scale(scale, scale)

      boardNodes.forEach((node) => {
        const color = categoryColor(node.category, node.color)
        const x = node.x || 0
        const y = node.y || 0
        const w = 140
        const h = 52

        ctx.fillStyle = isDark ? '#1c1c27' : '#ffffff'
        ctx.strokeStyle = color + '44'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.roundRect(x, y, w, h, 8)
        ctx.fill()
        ctx.stroke()

        ctx.fillStyle = color
        ctx.beginPath()
        ctx.roundRect(x, y, 4, h, [4, 0, 0, 4])
        ctx.fill()

        ctx.fillStyle = isDark ? '#f4f4f5' : '#111827'
        ctx.font = '12px Inter, sans-serif'
        ctx.textBaseline = 'middle'
        ctx.fillText(node.name || 'Node', x + 14, y + h / 2)
      })

      boardEdges.forEach((edge) => {
        const fromNode = boardNodes.find((n) => n.id === edge.from)
        const toNode = boardNodes.find((n) => n.id === edge.to)
        if (!fromNode || !toNode) return

        const fromX = (fromNode.x || 0) + 70
        const fromY = (fromNode.y || 0) + 52
        const toX = (toNode.x || 0) + 70
        const toY = toNode.y || 0

        const fromColor = categoryColor(fromNode.category, fromNode.color)
        ctx.strokeStyle = fromColor + '88'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(fromX, fromY)
        const midY = (fromY + toY) / 2
        ctx.bezierCurveTo(fromX, midY, toX, midY, toX, toY)
        ctx.stroke()
      })

      canvas2d.toBlob((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${boards.find((b) => b.id === activeBoard)?.name || 'board'}.png`
        a.click()
        URL.revokeObjectURL(url)
        addToast({ type: 'success', message: 'Board exported as image' })
      })
    } catch {
      addToast({ type: 'error', message: 'Failed to export board' })
    }
  }, [nodes, edges, boards, activeBoard, addToast])

  return (
    <div className="builder-layout" id="builder-page">
      {/* Left: Component toolbox */}
      <Toolbox />

      {/* Center: Canvas area */}
      <div className="builder-canvas-area">
        {/* Board tabs */}
        <BoardList
          boards={boards}
          activeId={activeBoard}
          unsavedIds={unsavedIds}
          onSelect={setActiveBoard}
          onNew={handleNewBoard}
          onRename={handleRenameBoard}
          onDelete={handleDeleteBoard}
          onDuplicate={handleDuplicateBoard}
          onReorder={handleReorderBoards}
        />

        {/* Toolbar */}
        <div className="builder-toolbar">
          <div className="builder-toolbar-group builder-toolbar-hint">
            <span>
              Drag to connect anchors · Click an edge to remove it · <kbd>⌫</kbd> deletes selection
            </span>
          </div>

          <div className="builder-toolbar-group">
            {protocolOptions.length > 0 && (
              <select
                aria-label={isConceptMode ? 'Linking phrase' : 'Edge protocol'}
                value={activeEdgeLabel}
                onChange={(e) => setActiveEdgeLabel(e.target.value)}
                title={isConceptMode ? 'Default linking phrase for new propositions' : 'Default protocol label for new edges'}
                style={{
                  fontSize: 'var(--text-xs)',
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                }}
              >
                <option value="">
                  {isConceptMode ? 'No linking phrase' : 'Protocol (optional)'}
                </option>
                {protocolOptions.map((proto) => (
                  <option key={proto} value={proto}>
                    {proto}
                  </option>
                ))}
              </select>
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowAuditModal(true)}
              title={isConceptMode ? 'Audit Concept Map & Run AI Critique' : 'Audit Architecture (Linter & AI Critique)'}
              id="builder-audit-btn"
              style={{ position: 'relative' }}
            >
              <ShieldCheck size={14} />
              Audit
              {auditReport.stats.criticalCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: -3,
                  right: -3,
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: '9px',
                  fontWeight: 800,
                  borderRadius: 'var(--radius-full)',
                  padding: '1px 5px',
                  lineHeight: '12px',
                }}>
                  {auditReport.stats.criticalCount}
                </span>
              )}
            </button>
            {capabilities?.calculator !== false && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setCalcModalOpen(true)}
                title="BotE Calculator (⌘E)"
                id="builder-calc-btn"
              >
                <Calculator size={14} />
                Estimate
              </button>
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowTemplates((prev) => !prev)}
              title="Load Template"
              id="template-btn"
            >
              <Layout size={14} />
              Templates
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleExportImage}
              title="Export as Image"
              id="export-image-btn"
            >
              <Download size={14} />
              Export
            </button>
            <button className="btn btn-secondary btn-sm" id="save-board-btn" onClick={handleSaveBoard}>
              <Save size={14} />
              Save
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => toggleChat('builder')}
              id="builder-chat-btn"
            >
              <MessageSquare size={14} />
              {isConceptMode ? 'Verify Map' : 'Verify Design'}
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div style={{ position: 'relative', flex: 1 }}>
          <Canvas defaultEdgeLabel={activeEdgeLabel} isConceptMode={isConceptMode} />
          {showTemplates && (
            <TemplateGallery
              onSelect={handleLoadTemplate}
              onClose={() => setShowTemplates(false)}
            />
          )}
          <ArchitectureAuditModal
            open={showAuditModal}
            onClose={() => setShowAuditModal(false)}
            audit={auditReport}
            mode={canvasMode}
            boardId={activeBoard}
            onEnsureSavedBoard={() => ensureSavedBoard({ silent: true })}
            boardData={toBoardData(nodes, edges)}
          />
        </div>
      </div>

      {/* Right: AI Chat panel */}
      {!isMobile && (
        <ChatPanel
          page="builder"
          title={isConceptMode ? 'Verify Concept Map' : 'Verify Architecture'}
          placeholder={
            isConceptMode
              ? 'Describe your concept map or ask to stress-test propositions...'
              : 'Describe your system for AI review...'
          }
        />
      )}
    </div>
  )
}
