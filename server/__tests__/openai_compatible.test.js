import { describe, it, expect, beforeEach } from 'vitest'
import { OpenAICompatibleProvider, _resetJsonModeCache } from '../providers/openai_compatible.js'
import { CustomEndpointProvider, customModelId, parseCustomModelId } from '../providers/custom.js'

const BASE = 'http://localhost:11434/v1'

/** Build a fetch Response-like object with a JSON body. */
const jsonResponse = (body, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
})

/** Build a fetch Response-like object with an SSE stream body. */
function sseResponse(lines) {
  const encoder = new TextEncoder()
  const chunks = lines.map((l) => encoder.encode(l))
  let i = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined },
      }),
    },
  }
}

const chatResponse = (content, extra = {}) =>
  jsonResponse({ choices: [{ message: { content, ...extra } }] })

beforeEach(() => {
  _resetJsonModeCache()
  fetch.mockReset()
})

describe('custom endpoint connectivity (fetchModels)', () => {
  it('lists models from an OpenAI-compatible /models endpoint', async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse({ data: [{ id: 'llama3.2:3b', created: 1750000000 }, { id: 'qwen2.5' }] })
    )
    const models = await OpenAICompatibleProvider.fetchModels('', BASE)
    expect(models).toEqual([
      { id: 'llama3.2:3b', releasedAt: 1750000000000 },
      { id: 'qwen2.5', releasedAt: null },
    ])
    expect(fetch).toHaveBeenCalledWith(`${BASE}/models`, { headers: {} })
  })

  it('sends a Bearer header when an API key is set', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ data: [] }))
    await OpenAICompatibleProvider.fetchModels('sk-test', BASE)
    expect(fetch).toHaveBeenCalledWith(`${BASE}/models`, {
      headers: { Authorization: 'Bearer sk-test' },
    })
  })

  it('reports unreachable servers with a friendly message', async () => {
    fetch.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(OpenAICompatibleProvider.fetchModels('', BASE)).rejects.toThrow(
      `Could not reach ${BASE}`
    )
  })

  it('surfaces the server error message on HTTP failures', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ error: { message: 'Invalid API key' } }, false, 401))
    await expect(OpenAICompatibleProvider.fetchModels('bad', BASE)).rejects.toThrow('Invalid API key')
  })

  it('verifies keys through testApiKey without spending tokens', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ data: [] }))
    const provider = new OpenAICompatibleProvider('sk-test', BASE)
    await expect(provider.testApiKey('sk-test')).resolves.toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe(`${BASE}/models`)
  })
})

describe('adaptive structured output (generateJSON)', () => {
  const schema = {
    type: 'object',
    properties: { cards: { type: 'array', items: { type: 'string' } } },
  }

  it('uses strict json_schema mode when the server supports it', async () => {
    fetch.mockResolvedValueOnce(chatResponse('{"cards":["a"]}'))
    const provider = new OpenAICompatibleProvider('', BASE)
    const result = await provider.generateJSON('make cards', schema, { model: 'llama3.2:3b' })
    expect(result).toEqual({ cards: ['a'] })

    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema.schema).toEqual(schema)
  })

  it('falls back json_schema → json_object → prompt when the engine lacks support', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'response_format json_schema is not supported' } }, false, 400))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'response_format json_object is not supported' } }, false, 400))
      .mockResolvedValueOnce(chatResponse('```json\n{"cards":["a","b"]}\n```'))

    const provider = new OpenAICompatibleProvider('', BASE)
    const result = await provider.generateJSON('make cards', schema, { model: 'llama3.2:3b' })
    expect(result).toEqual({ cards: ['a', 'b'] })
    expect(fetch).toHaveBeenCalledTimes(3)

    const bodies = fetch.mock.calls.map(([, init]) => JSON.parse(init.body))
    expect(bodies[0].response_format.type).toBe('json_schema')
    expect(bodies[1].response_format.type).toBe('json_object')
    expect(bodies[2].response_format).toBeUndefined()
  })

  it('remembers the working mode per endpoint+model (no repeated failures)', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'json_schema not supported' } }, false, 400))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'json_object not supported' } }, false, 400))
      .mockResolvedValueOnce(chatResponse('{"cards":[]}'))

    const provider = new OpenAICompatibleProvider('', BASE)
    await provider.generateJSON('make cards', schema, { model: 'llama3.2:3b' })
    expect(fetch).toHaveBeenCalledTimes(3)

    // Second call starts directly in prompt mode
    fetch.mockResolvedValueOnce(chatResponse('{"cards":["c"]}'))
    const result = await provider.generateJSON('more cards', schema, { model: 'llama3.2:3b' })
    expect(result).toEqual({ cards: ['c'] })
    expect(fetch).toHaveBeenCalledTimes(4)
    const lastBody = JSON.parse(fetch.mock.calls[3][1].body)
    expect(lastBody.response_format).toBeUndefined()
  })

  it('falls back when the model returns unparseable JSON', async () => {
    fetch
      .mockResolvedValueOnce(chatResponse('Sure! Here are your cards: a, b, c'))
      .mockResolvedValueOnce(chatResponse('{"cards":["a"]}'))

    const provider = new OpenAICompatibleProvider('', BASE)
    const result = await provider.generateJSON('make cards', schema, { model: 'm' })
    expect(result).toEqual({ cards: ['a'] })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('wraps array-root schemas for json_schema mode and unwraps the result', async () => {
    const arraySchema = { type: 'array', items: { type: 'string' } }
    fetch.mockResolvedValueOnce(chatResponse('{"items":["q1","q2"]}'))

    const provider = new OpenAICompatibleProvider('', BASE)
    const result = await provider.generateJSON('make questions', arraySchema, { model: 'm' })
    expect(result).toEqual(['q1', 'q2'])

    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.response_format.json_schema.schema.type).toBe('object')
    expect(body.response_format.json_schema.schema.properties.items).toEqual(arraySchema)
  })

  it('throws the last error when every mode fails', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'nope 1' } }, false, 400))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'nope 2' } }, false, 400))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'nope 3' } }, false, 500))

    const provider = new OpenAICompatibleProvider('', BASE)
    await expect(provider.generateJSON('x', schema, { model: 'm' })).rejects.toThrow('nope 3')
  })
})

describe('streaming chat', () => {
  it('yields text chunks from the SSE stream', async () => {
    fetch.mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: [DONE]\n\n',
      ])
    )
    const provider = new OpenAICompatibleProvider('', BASE)
    const chunks = []
    for await (const chunk of provider.streamChat('be brief', [], 'hi', { model: 'm' })) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
    ])
  })

  it('degrades to plain chat when the engine rejects tools', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'tools is not supported by this model' } }, false, 400))
      .mockResolvedValueOnce(
        sseResponse(['data: {"choices":[{"delta":{"content":"plain answer"}}]}\n\n', 'data: [DONE]\n\n'])
      )

    const provider = new OpenAICompatibleProvider('', BASE)
    const tools = [{ name: 'lookup', description: 'd', parameters: { type: 'object' } }]
    const chunks = []
    for await (const chunk of provider.streamChatWithTools('sys', [], 'hi', tools, async () => ({}), { model: 'm' })) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual([{ type: 'text', text: 'plain answer' }])
  })

  it('executes tool calls and loops until the model answers', async () => {
    fetch
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{
            message: {
              content: null,
              tool_calls: [{ id: 'c1', function: { name: 'lookup', arguments: '{"q":"cap"}' } }],
            },
          }],
        })
      )
      .mockResolvedValueOnce(chatResponse('CAP theorem says...'))

    const executed = []
    const provider = new OpenAICompatibleProvider('', BASE)
    const tools = [{ name: 'lookup', description: 'd', parameters: { type: 'object' } }]
    const chunks = []
    for await (const chunk of provider.streamChatWithTools(
      'sys', [], 'hi', tools,
      async (name, args) => { executed.push([name, args]); return { found: true } },
      { model: 'm' }
    )) {
      chunks.push(chunk)
    }

    expect(executed).toEqual([['lookup', { q: 'cap' }]])
    expect(chunks).toEqual([
      { type: 'tool', name: 'lookup' },
      { type: 'text', text: 'CAP theorem says...' },
    ])
    // Second request carries the tool result back to the model
    const secondBody = JSON.parse(fetch.mock.calls[1][1].body)
    expect(secondBody.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' })
  })
})

describe('custom endpoint model namespacing', () => {
  it('builds and parses namespaced model IDs (colons in upstream IDs survive)', () => {
    const id = customModelId('ep-1', 'llama3.2:3b')
    expect(id).toBe('custom:ep-1:llama3.2:3b')
    expect(parseCustomModelId(id)).toEqual({ endpointId: 'ep-1', upstreamModelId: 'llama3.2:3b' })
    expect(parseCustomModelId('gemini-3.5-flash')).toBe(null)
  })

  it('strips the namespace before sending requests upstream', async () => {
    fetch.mockResolvedValueOnce(chatResponse('ok'))
    const provider = new CustomEndpointProvider({
      id: 'ep-1',
      name: 'Homelab',
      base_url: BASE,
      api_key: '',
    })
    await provider.generateText('hi', { model: 'custom:ep-1:llama3.2:3b' })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.model).toBe('llama3.2:3b')
  })
})
