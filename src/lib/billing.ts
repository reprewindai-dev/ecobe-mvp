import { createHmac, timingSafeEqual } from 'crypto'

import { prisma } from './prisma'
import { env } from './env'

type StripeEvent = {
  id: string
  type: string
  created?: number
  data?: {
    object?: Record<string, any>
  }
}

export async function processStripeWebhook(rawBody: string, signatureHeader: string | null) {
  const event = parseStripeEvent(rawBody, signatureHeader)
  const object = event.data?.object ?? {}
  const organizationId = await resolveOrganizationId(event.type, object)

  if (!organizationId) {
    throw new Error(`Unable to resolve organization for Stripe event ${event.id}`)
  }

  try {
    await handleStripeEvent(event, organizationId)
    await recordWebhookDelivery({
      organizationId,
      providerEventId: event.id,
      eventType: event.type,
      status: 'processed',
      responseCode: 200,
      requestBody: event,
      responseBody: { received: true },
    })
  } catch (error) {
    await recordWebhookDelivery({
      organizationId,
      providerEventId: event.id,
      eventType: event.type,
      status: 'failed',
      responseCode: 500,
      requestBody: event,
      responseBody: { error: error instanceof Error ? error.message : String(error) },
    })
    throw error
  }

  return event
}

function parseStripeEvent(rawBody: string, signatureHeader: string | null): StripeEvent {
  if (env.STRIPE_WEBHOOK_SECRET) {
    verifyStripeSignature(rawBody, signatureHeader, env.STRIPE_WEBHOOK_SECRET)
  }

  return JSON.parse(rawBody) as StripeEvent
}

function verifyStripeSignature(payload: string, signatureHeader: string | null, secret: string) {
  if (!signatureHeader) {
    throw new Error('Missing Stripe-Signature header')
  }

  const parsed = Object.fromEntries(
    signatureHeader.split(',').map((entry) => {
      const [key, value] = entry.split('=')
      return [key, value]
    })
  )

  const timestamp = parsed.t
  const signature = parsed.v1

  if (!timestamp || !signature) {
    throw new Error('Invalid Stripe-Signature header')
  }

  const signedPayload = `${timestamp}.${payload}`
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex')
  const provided = Buffer.from(signature)
  const computed = Buffer.from(expected)

  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
    throw new Error('Stripe signature verification failed')
  }
}

async function resolveOrganizationId(eventType: string, object: Record<string, any>) {
  const metadataOrganizationId = object.metadata?.organizationId
  if (metadataOrganizationId) {
    return metadataOrganizationId
  }

  const customerId = extractCustomerId(object)
  if (!customerId) {
    return null
  }

  const billingAccount = await prisma.billingAccount.findFirst({
    where: {
      stripeCustomerId: customerId,
    },
    select: {
      organizationId: true,
    },
  })

  if (billingAccount) {
    return billingAccount.organizationId
  }

  if (eventType.startsWith('customer.') && object.metadata?.organizationSlug) {
    const organization = await prisma.organization.findUnique({
      where: { slug: object.metadata.organizationSlug },
      select: { id: true },
    })
    return organization?.id ?? null
  }

  return null
}

async function handleStripeEvent(event: StripeEvent, organizationId: string) {
  const object = event.data?.object ?? {}

  switch (event.type) {
    case 'customer.created':
    case 'customer.updated':
      await upsertBillingAccount({
        organizationId,
        stripeCustomerId: object.id,
        status: 'active',
      })
      break
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await syncSubscription(organizationId, object)
      break
    case 'invoice.created':
    case 'invoice.finalized':
    case 'invoice.paid':
    case 'invoice.payment_failed':
    case 'invoice.voided':
      await syncInvoice(organizationId, object)
      break
    default:
      break
  }
}

async function upsertBillingAccount(input: {
  organizationId: string
  stripeCustomerId?: string | null
  status: 'active' | 'past_due' | 'canceled'
}) {
  return prisma.billingAccount.upsert({
    where: { organizationId: input.organizationId },
    update: {
      stripeCustomerId: input.stripeCustomerId ?? undefined,
      status: input.status,
    },
    create: {
      organizationId: input.organizationId,
      stripeCustomerId: input.stripeCustomerId ?? undefined,
      status: input.status,
    },
  })
}

async function syncSubscription(organizationId: string, object: Record<string, any>) {
  const billingAccount = await upsertBillingAccount({
    organizationId,
    stripeCustomerId: extractCustomerId(object),
    status: mapStripeStatus(object.status),
  })

  const subscriptionId = object.id
  if (!subscriptionId) {
    throw new Error('Stripe subscription event missing subscription id')
  }

  await prisma.subscription.upsert({
    where: {
      externalSubscriptionId: subscriptionId,
    },
    update: {
      planTier: extractPlanTier(object),
      status: mapStripeStatus(object.status),
      currentPeriodStart: toDate(object.current_period_start),
      currentPeriodEnd: toDate(object.current_period_end),
      cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
    },
    create: {
      billingAccountId: billingAccount.id,
      externalSubscriptionId: subscriptionId,
      planTier: extractPlanTier(object),
      status: mapStripeStatus(object.status),
      currentPeriodStart: toDate(object.current_period_start),
      currentPeriodEnd: toDate(object.current_period_end),
      cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
    },
  })
}

async function syncInvoice(organizationId: string, object: Record<string, any>) {
  const billingAccount = await upsertBillingAccount({
    organizationId,
    stripeCustomerId: extractCustomerId(object),
    status: mapInvoiceStatus(object.status),
  })

  const invoiceId = object.id
  if (!invoiceId) {
    throw new Error('Stripe invoice event missing invoice id')
  }

  const invoice = await prisma.invoice.upsert({
    where: {
      externalInvoiceId: invoiceId,
    },
    update: {
      amountDue: centsToDollars(object.amount_due),
      amountPaid: centsToDollars(object.amount_paid),
      currency: normalizeCurrency(object.currency),
      status: mapInvoiceStatus(object.status),
      hostedInvoiceUrl: object.hosted_invoice_url ?? null,
      periodStart: toDate(object.period_start),
      periodEnd: toDate(object.period_end),
    },
    create: {
      billingAccountId: billingAccount.id,
      externalInvoiceId: invoiceId,
      amountDue: centsToDollars(object.amount_due),
      amountPaid: centsToDollars(object.amount_paid),
      currency: normalizeCurrency(object.currency),
      status: mapInvoiceStatus(object.status),
      hostedInvoiceUrl: object.hosted_invoice_url ?? null,
      periodStart: toDate(object.period_start),
      periodEnd: toDate(object.period_end),
    },
  })

  await prisma.invoiceLineItem.deleteMany({
    where: { invoiceId: invoice.id },
  })

  const lineItems = Array.isArray(object.lines?.data) ? object.lines.data : []
  if (!lineItems.length) {
    return
  }

  await prisma.invoiceLineItem.createMany({
    data: lineItems.map((item: Record<string, any>) => ({
      invoiceId: invoice.id,
      description: item.description ?? 'Stripe invoice line item',
      quantity: Number(item.quantity ?? 1),
      unitAmount: centsToDollars(item.price?.unit_amount ?? item.amount ?? 0),
      amount: centsToDollars(item.amount ?? 0),
      currency: normalizeCurrency(item.currency ?? object.currency),
      metadata: item.metadata ?? {},
    })),
  })
}

async function recordWebhookDelivery(input: {
  organizationId: string
  providerEventId: string
  eventType: string
  status: string
  responseCode: number
  requestBody: unknown
  responseBody: unknown
}) {
  await prisma.webhookDelivery.create({
    data: {
      organizationId: input.organizationId,
      provider: 'stripe',
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      status: input.status,
      responseCode: input.responseCode,
      requestBody: input.requestBody as any,
      responseBody: input.responseBody as any,
      processedAt: new Date(),
    },
  })
}

function extractCustomerId(object: Record<string, any>) {
  if (typeof object.customer === 'string') {
    return object.customer
  }

  if (typeof object.id === 'string' && String(object.object) === 'customer') {
    return object.id
  }

  return null
}

function extractPlanTier(object: Record<string, any>) {
  return (
    object.metadata?.planTier ??
    object.items?.data?.[0]?.price?.lookup_key ??
    object.items?.data?.[0]?.price?.nickname ??
    'tier_2'
  )
}

function mapStripeStatus(status?: string): 'active' | 'past_due' | 'canceled' {
  if (!status) {
    return 'active'
  }

  if (['canceled', 'unpaid', 'incomplete_expired'].includes(status)) {
    return 'canceled'
  }

  if (['past_due', 'incomplete'].includes(status)) {
    return 'past_due'
  }

  return 'active'
}

function mapInvoiceStatus(status?: string): 'active' | 'past_due' | 'canceled' {
  if (!status) {
    return 'active'
  }

  if (['void', 'voided', 'uncollectible'].includes(status)) {
    return 'canceled'
  }

  if (['open', 'draft'].includes(status)) {
    return 'past_due'
  }

  return 'active'
}

function toDate(value?: number | string | null) {
  if (value === null || value === undefined) {
    return null
  }

  const numeric = Number(value)
  if (Number.isNaN(numeric)) {
    return null
  }

  return new Date(numeric * 1000)
}

function centsToDollars(value?: number | null) {
  return Number(((value ?? 0) / 100).toFixed(2))
}

function normalizeCurrency(value?: string | null) {
  return (value ?? 'usd').toUpperCase()
}
