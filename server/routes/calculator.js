/**
 * @fileoverview BotE Calculator API — the AI sanity checker.
 *
 *   POST /api/calculator/audit - "Audit My Math": structured AI critique
 *                                of the user's capacity estimates.
 */

import { Router } from 'express'
import { z } from 'zod'
import { runStructured } from '../ai/engine.js'
import logger from '../utils/logger.js'

const router = Router()

const AUDIT_SCHEMA = z.object({
  verdict: z.enum(['sound', 'revisit'])
    .describe('"sound" when the estimates hold up for the scenario; "revisit" when something material is off'),
  summary: z.string()
    .describe('Two or three sentences: the overall quality of this estimate and the single most important improvement'),
  findings: z.array(
    z.object({
      severity: z.enum(['critical', 'warning', 'info'])
        .describe('critical = the estimate is materially wrong; warning = a real-world factor was omitted; info = a refinement'),
      area: z.string()
        .describe('Short label: Traffic, Storage, Cache, Bandwidth, Hardware, or Assumptions'),
      finding: z.string()
        .describe('What is off or missing, with the concrete numbers involved'),
      suggestion: z.string()
        .describe('The specific fix: which input to change or which factor to add, with a suggested value'),
    })
  ).describe('Ordered most severe first. Empty when everything holds up.'),
  omittedFactors: z.array(z.string())
    .describe('Real-world factors this estimate ignores (index overhead, compression, replication lag buffers, connection overhead, cold storage tiering, etc.). Only list factors that matter at THIS scale.'),
})

/**
 * POST /api/calculator/audit
 * Body: { scenario, inputs, results, model }
 *  - scenario: { id, name, description } of the selected problem
 *  - inputs:   the sanitized calculator inputs
 *  - results:  formatted key results (strings with units)
 */
router.post('/audit', async (req, res) => {
  const { scenario, inputs, results, model } = req.body

  if (!inputs || !results) {
    return res.status(400).json({ message: 'inputs and results are required' })
  }

  const scenarioText = scenario && scenario.id !== 'custom'
    ? `The user is sizing this system: "${scenario.name}" — ${scenario.description}`
    : 'The user is sizing a custom system (no named scenario).'

  const prompt = `You are a principal engineer auditing a candidate's back-of-the-envelope capacity estimate during a system design interview.

${scenarioText}

Their input assumptions:
${JSON.stringify(inputs, null, 2)}

The computed results (from these standard formulas: QPS = DAU × req/user ÷ 86,400; storage = writes × size × retention × replication × (1 + overhead); cache = working-set % × daily read volume; servers = peak QPS ÷ (QPS/node × utilization)):
${JSON.stringify(results, null, 2)}

Audit the estimate. Ground rules:
- Judge whether the INPUT ASSUMPTIONS are realistic for this scenario (e.g. a URL shortener with 2 KB payloads, or a flash sale with a 2× peak multiplier, deserve a flag).
- Check for omitted real-world factors ONLY when they materially change the answer at this scale: index/metadata overhead, compression ratios, replication lag buffers, write amplification, connection/TLS overhead, CDN offload of media egress, hot-partition skew, cold-storage tiering.
- Use the numbers given. Never invent traffic figures that contradict the inputs, and never demand precision beyond back-of-the-envelope (±2× is fine).
- If the estimate is broadly sound, say so — verdict "sound", few or no findings. Do not manufacture problems.
- Keep every finding concrete and tied to a number the user can change.`

  try {
    const audit = await runStructured({
      model,
      prompt,
      schema: AUDIT_SCHEMA,
      feature: 'calculator/audit',
    })
    res.json(audit)
  } catch (err) {
    logger.error('[calculator/audit] Error:', err.message)
    res.status(500).json({ message: err.message || 'Failed to audit the estimate.' })
  }
})

export default router
