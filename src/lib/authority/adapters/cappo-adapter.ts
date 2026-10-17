import { canonicalHash } from '../canonical'
import type { TargetAdapter } from '../executor'
import type { TargetReceipt } from '../targets'

export type CappoClientConfig = {
  baseUrl: string
  mountId: string
  bearerToken?: string
}

export type CappoExecutePayload = {
  token_id: string
  nonce: string
  action: string
  target_ref: string
  resource: string
  arguments: Record<string, unknown>
  operation_id: string
}

/**
 * CAPPO Target Adapter (Class B1 - Fenced Consequence Boundary).
 *
 * Enforces hardware/store-side CAS authority epoch fencing at Port 8002.
 * When authority advances (epoch E1 -> E2), any permit bound to E1 is
 * refused at begin_consequence() with Delta C = 0 and error_summary="stale_authority_epoch".
 */
export class CappoTargetAdapter implements TargetAdapter {
  readonly id = 'veklom-cappo-adapter'
  readonly targetClass = 'B1' as const
  readonly supportsConditionalMutation = false

  private readonly baseUrl: string
  private readonly mountId: string
  private readonly bearerToken?: string

  constructor(config: CappoClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.mountId = config.mountId
    this.bearerToken = config.bearerToken
  }

  async execute(input: {
    idempotencyKey: string
    payloadHash: string
    fencingGeneration?: number
    expectedPreStateRoot?: string
    expectedGeneration?: number
  }): Promise<TargetReceipt> {
    const generation = input.fencingGeneration
    if (generation === undefined || !Number.isSafeInteger(generation)) {
      return this.receipt({
        targetClass: 'B1',
        outcome: 'REJECTED',
        reason: 'FENCING_GENERATION_REQUIRED',
        key: input.idempotencyKey,
        mutationSequence: null,
      })
    }

    const url = `${this.baseUrl}/v1/capability/mounts/${this.mountId}/execute`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Authority-Epoch': String(generation),
    }
    if (this.bearerToken) {
      headers.Authorization = `Bearer ${this.bearerToken}`
    }

    const payload: CappoExecutePayload = {
      token_id: `token-${input.idempotencyKey.slice(0, 16)}`,
      nonce: input.idempotencyKey.slice(16, 48),
      action: 'record.create',
      target_ref: 'veklom.local-records@v1',
      resource: `co2router-${input.payloadHash.slice(0, 16)}`,
      arguments: {
        idempotencyKey: input.idempotencyKey,
        payloadHash: input.payloadHash,
        fencingGeneration: generation,
      },
      operation_id: `op-${input.idempotencyKey}`,
    }

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })
    } catch (error) {
      throw new Error(`CAPPO transport failure: ${error instanceof Error ? error.message : String(error)}`)
    }

    if (!response.ok && response.status !== 403 && response.status !== 400 && response.status !== 200) {
      throw new Error(`CAPPO HTTP error status ${response.status}`)
    }

    const body = (await response.json()) as {
      decision?: string
      reason?: string
      error_summary?: string
      receipt_id?: string
      version?: number
    }

    if (body.decision === 'deny' || body.reason === 'stale_authority_epoch' || body.reason === 'mount_terminated') {
      return this.receipt({
        targetClass: 'B1',
        outcome: 'REJECTED',
        reason: body.reason || 'FENCE_REFUSAL',
        key: input.idempotencyKey,
        mutationSequence: null,
      })
    }

    if (body.decision === 'allow') {
      return this.receipt({
        targetClass: 'B1',
        outcome: 'APPLIED',
        key: input.idempotencyKey,
        mutationSequence: body.version ?? 1,
      })
    }

    return this.receipt({
      targetClass: 'B1',
      outcome: 'REJECTED',
      reason: body.reason || 'UNKNOWN_REFUSAL',
      key: input.idempotencyKey,
      mutationSequence: null,
    })
  }

  private receipt(fields: Omit<TargetReceipt, 'receiptHash'>): TargetReceipt {
    return { ...fields, receiptHash: canonicalHash(fields) }
  }
}
