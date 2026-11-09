import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Code2, Eye, Loader2, Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { sanitizeSvg } from "../../utils/sanitizeSvg";

export interface SvgFigureRendererProps {
  code: string;
  className?: string;
}

const MIN_ZOOM = 50;
const MAX_ZOOM = 300;
const ZOOM_STEP = 25;

export default function SvgFigureRenderer({ code, className = "" }: SvgFigureRendererProps) {
  const rawId = useId();
  const instancePrefix = useMemo(
    () => `svg-${rawId.replace(/[^A-Za-z0-9_-]/g, "") || "fig"}`,
    [rawId],
  );

  const [zoom, setZoom] = useState(100);
  const [showCode, setShowCode] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const result = useMemo(() => sanitizeSvg(code, instancePrefix), [code, instancePrefix]);
  const modalResult = useMemo(
    () => (isExpanded ? sanitizeSvg(code, `${instancePrefix}-modal`) : null),
    [code, instancePrefix, isExpanded],
  );

  useEffect(() => {
    if (!isExpanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setIsExpanded(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isExpanded]);

  const handleZoomOut = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP));
  };

  const handleZoomIn = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP));
  };

  const handleZoomReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoom(100);
  };

  const handleToggleCode = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowCode((v) => !v);
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded((v) => !v);
  };

  const canZoom = result.status === "ok" && !showCode;

  return (
    <>
      <figure
        data-testid="svg-figure"
        className={`my-3 rounded-lg border border-outline-variant bg-surface-container-low text-on-surface overflow-hidden ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-outline-variant px-3 py-1.5 text-xs text-on-surface-variant">
          <span className="font-medium select-none">Diagram</span>
          <div className="flex items-center gap-1">
            {canZoom && (
              <>
                <button
                  type="button"
                  onClick={handleZoomOut}
                  disabled={zoom <= MIN_ZOOM}
                  aria-label="Zoom out"
                  title="Zoom out"
                  className="inline-flex h-6 w-6 items-center justify-center rounded border border-transparent hover:border-outline-variant hover:text-on-surface disabled:opacity-40"
                >
                  <ZoomOut size={13} />
                </button>
                <button
                  type="button"
                  onClick={handleZoomReset}
                  aria-label="Reset zoom"
                  title="Reset zoom (100%)"
                  className="inline-flex h-6 items-center gap-1 rounded px-1.5 font-mono text-[11px] hover:border-outline-variant hover:text-on-surface"
                >
                  <span>{zoom}%</span>
                  {zoom !== 100 && <RotateCcw size={10} />}
                </button>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  disabled={zoom >= MAX_ZOOM}
                  aria-label="Zoom in"
                  title="Zoom in"
                  className="inline-flex h-6 w-6 items-center justify-center rounded border border-transparent hover:border-outline-variant hover:text-on-surface disabled:opacity-40"
                >
                  <ZoomIn size={13} />
                </button>
                <button
                  type="button"
                  onClick={handleToggleExpand}
                  aria-label="Expand figure"
                  title="Expand figure"
                  className="inline-flex h-6 w-6 items-center justify-center rounded border border-transparent hover:border-outline-variant hover:text-on-surface"
                >
                  <Maximize2 size={13} />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleToggleCode}
              aria-label={showCode ? "Show diagram" : "View SVG source"}
              title={showCode ? "Show diagram" : "View SVG source"}
              className="inline-flex h-6 items-center gap-1 rounded border border-outline-variant px-2 text-[11px] hover:text-on-surface"
            >
              {showCode ? <Eye size={12} /> : <Code2 size={12} />}
              <span>{showCode ? "Preview" : "Code"}</span>
            </button>
          </div>
        </div>

        <div className="p-3 overflow-auto max-h-[520px]">
          {showCode ? (
            <pre
              data-testid="svg-raw-source"
              className="m-0 overflow-x-auto rounded border border-outline-variant p-3 font-mono text-xs text-on-surface-variant whitespace-pre-wrap break-words text-left"
            >
              <code>{code}</code>
            </pre>
          ) : result.status === "incomplete" ? (
            <div
              data-testid="svg-streaming-fallback"
              className="flex items-center justify-center gap-2 py-8 text-xs text-on-surface-variant"
            >
              <Loader2 size={14} className="animate-spin" />
              <span>Rendering diagram...</span>
            </div>
          ) : result.status === "error" ? (
            <div
              data-testid="svg-error-fallback"
              className="flex flex-col items-center justify-center gap-2 py-6 text-center text-xs text-on-surface-variant"
            >
              <span>Diagram could not be rendered ({result.reason})</span>
              <button
                type="button"
                onClick={handleToggleCode}
                className="rounded border border-outline-variant px-2.5 py-1 text-on-surface hover:opacity-80"
              >
                View raw source
              </button>
            </div>
          ) : (
            <div className="flex justify-center overflow-auto">
              <div
                data-testid="svg-viewport"
                style={{
                  width: `${zoom}%`,
                  maxWidth: zoom > 100 ? "none" : "100%",
                  transition: "width 120ms ease-out",
                }}
                className="flex justify-center"
              >
                {result.element}
              </div>
            </div>
          )}
        </div>
      </figure>

      {isExpanded &&
        modalResult?.status === "ok" &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Expanded SVG figure"
            data-testid="svg-expanded-modal"
            className="fixed inset-0 z-[9999] flex flex-col bg-surface/90 backdrop-blur-sm p-4 sm:p-8 text-on-surface"
            onClick={(e) => {
              e.stopPropagation();
              if (e.target === e.currentTarget) setIsExpanded(false);
            }}
          >
            <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low">
              <div className="flex items-center justify-between border-b border-outline-variant px-4 py-2.5 text-xs text-on-surface-variant">
                <span className="font-medium text-on-surface">Expanded Diagram</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleZoomOut}
                    disabled={zoom <= MIN_ZOOM}
                    aria-label="Modal zoom out"
                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-outline-variant hover:text-on-surface disabled:opacity-40"
                  >
                    <ZoomOut size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={handleZoomReset}
                    aria-label="Modal reset zoom"
                    className="inline-flex h-7 items-center rounded border border-outline-variant px-2 font-mono text-xs hover:text-on-surface"
                  >
                    {zoom}%
                  </button>
                  <button
                    type="button"
                    onClick={handleZoomIn}
                    disabled={zoom >= MAX_ZOOM}
                    aria-label="Modal zoom in"
                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-outline-variant hover:text-on-surface disabled:opacity-40"
                  >
                    <ZoomIn size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleExpand}
                    aria-label="Minimize figure"
                    className="inline-flex h-7 items-center gap-1 rounded border border-outline-variant px-2.5 text-on-surface"
                  >
                    <Minimize2 size={14} />
                    <span>Close</span>
                  </button>
                </div>
              </div>
              <div className="flex flex-1 items-center justify-center overflow-auto p-6">
                <div
                  style={{
                    width: `${zoom}%`,
                    maxWidth: zoom > 100 ? "none" : "100%",
                  }}
                  className="flex justify-center"
                >
                  {modalResult.element}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
