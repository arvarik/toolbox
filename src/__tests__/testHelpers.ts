import type { KitSkeletonV1 } from '../../shared/kits/kitSkeleton'
import { SYSTEM_DESIGN_KIT_SKELETON } from '../../shared/kits/systemDesignKit'
import useKitStore, { type KitDetailItem, type KitSummaryItem } from '../stores/useKitStore'

export interface MakeTestKitOptions
  extends Partial<Omit<KitDetailItem, 'skeleton' | 'capabilities'>> {
  capabilities?: Partial<KitSkeletonV1['capabilities']>
  skeleton?: KitSkeletonV1
  mutateSkeleton?: (skeleton: KitSkeletonV1) => void
}

export function makeTestKit(opts: MakeTestKitOptions = {}): KitDetailItem {
  const {
    capabilities: capOverrides,
    skeleton: customSkeleton,
    mutateSkeleton,
    ...summaryOverrides
  } = opts
  const slug = summaryOverrides.slug ?? customSkeleton?.identity.slug ?? 'system-design'
  const name = summaryOverrides.name ?? customSkeleton?.identity.name ?? 'System Design'
  const skeleton = customSkeleton
    ? structuredClone(customSkeleton)
    : structuredClone(SYSTEM_DESIGN_KIT_SKELETON)

  skeleton.identity = {
    ...skeleton.identity,
    slug,
    name,
    ...(summaryOverrides.description ? { description: summaryOverrides.description } : {}),
    ...(summaryOverrides.icon ? { icon: summaryOverrides.icon } : {}),
    ...(summaryOverrides.color ? { color: summaryOverrides.color } : {}),
  }
  if (capOverrides) {
    skeleton.capabilities = { ...skeleton.capabilities, ...capOverrides }
  }
  mutateSkeleton?.(skeleton)

  const topicCount = skeleton.pillars.reduce((sum, p) => sum + p.topics.length, 0)
  return {
    id: `kit-${slug}`,
    slug,
    name,
    description: skeleton.identity.description,
    icon: skeleton.identity.icon,
    color: skeleton.identity.color,
    status: 'ready',
    statusDetail: null,
    forkedFromSharedId: null,
    forkedVersion: 1,
    upstreamSlug: null,
    upstreamLatestVersion: null,
    hasUpstreamUpdate: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastOpenedAt: null,
    pillarCount: skeleton.pillars.length,
    topicCount,
    nodeCount: skeleton.graph.nodes.length,
    capabilities: skeleton.capabilities,
    deckCount: 1,
    cardCount: 0,
    dueCount: 0,
    newCount: 0,
    reviewedCount: 0,
    masteryPercent: 0,
    guideFilledCount: 0,
    guideTotalCount: Math.max(1, topicCount * 2),
    archivedNotesCount: 0,
    drillCount: 0,
    ...summaryOverrides,
    skeleton,
  }
}

export function resetKitStore(
  activeKit: KitDetailItem | null = null,
  kits: KitSummaryItem[] = activeKit ? [activeKit] : [],
): void {
  const cache: Record<string, KitDetailItem> = {}
  if (activeKit) cache[activeKit.slug] = activeKit
  useKitStore.setState({
    kits,
    activeKitSlug: activeKit?.slug ?? null,
    activeKit,
    kitCache: cache,
    isLoadingList: false,
  })
}

export function sseStreamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}
