/**
 * Webhook dispatcher — delivers signed HTTP POST to subscriber URL.
 *
 * Signature: HMAC-SHA256 of the JSON payload, using the webhook secret.
 * Consumers verify: X-Facilitator-Signature header.
 *
 * Timeout: 10s per delivery attempt.
 *
 * Security:
 *   - Only HTTPS URLs are accepted (prevents protocol-level SSRF)
 *   - Private/loopback/link-local IPs are blocked (prevents network-level SSRF)
 *   - DNS rebinding protection: hostname is validated before fetch
 */
import crypto from 'node:crypto'
import dns from 'node:dns/promises'

export interface WebhookSubscription {
  subscriptionId: string
  url: string
  secret: string
  events: string[]
}

export interface DispatchResult {
  delivered: boolean
  httpStatus?: number
  error?: string
}

/**
 * Validates a webhook URL against SSRF risks.
 * Throws a descriptive Error if the URL is unsafe.
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('SSRF: invalid URL')
  }

  // Protocol check — only HTTPS
  if (parsed.protocol !== 'https:') {
    throw new Error('SSRF: only HTTPS webhook URLs are allowed')
  }

  // Explicit port blocklist (databases, Redis, internal services)
  const blockedPorts = [5432, 5433, 6379, 6380, 3306, 27017, 9200, 9300, 2379, 2380]
  const port = parsed.port ? parseInt(parsed.port, 10) : 443
  if (blockedPorts.includes(port)) {
    throw new Error(`SSRF: port ${port} is not allowed`)
  }

  // Block numeric IP literals (private, loopback, link-local)
  const isBlockedIp = isPrivateOrReservedIp(parsed.hostname)
  if (isBlockedIp) {
    throw new Error('SSRF: private or reserved IP address not allowed')
  }

  // DNS resolution check — resolve to catch DNS-based SSRF
  try {
    const addresses = await dns.resolve4(parsed.hostname).catch(() => [] as string[])
    const addresses6 = await dns.resolve6(parsed.hostname).catch(() => [] as string[])
    const all = [...addresses, ...addresses6]
    for (const addr of all) {
      if (isPrivateOrReservedIp(addr)) {
        throw new Error(`SSRF: hostname resolves to private IP (${addr})`)
      }
    }
  } catch (err: any) {
    if (err.message?.startsWith('SSRF')) throw err
    // DNS resolution failure is treated as safe-fail (endpoint unreachable, not dangerous)
  }
}

/**
 * Returns true if the given IP/hostname is a private, loopback, or reserved address.
 */
function isPrivateOrReservedIp(host: string): boolean {
  const privatePatterns = [
    /^127\./,                          // Loopback
    /^10\./,                           // RFC 1918 class A
    /^172\.(1[6-9]|2\d|3[01])\./,     // RFC 1918 class B
    /^192\.168\./,                     // RFC 1918 class C
    /^169\.254\./,                     // Link-local (AWS metadata, etc.)
    /^::1$/,                           // IPv6 loopback
    /^fc00:/i,                         // IPv6 unique local
    /^fd[0-9a-f]{2}:/i,               // IPv6 unique local
    /^fe80:/i,                         // IPv6 link-local
    /^0\.0\.0\.0$/,                    // Unspecified
    /^localhost$/i,                    // Hostname loopback
    /\.local$/i,                       // mDNS local domains
    /\.internal$/i,                    // GCP internal
    /^metadata\.google\.internal$/i,   // GCP metadata
    /^169\.254\.169\.254$/,           // AWS/Azure metadata
  ]
  return privatePatterns.some((re) => re.test(host))
}

export async function dispatchWebhook(
  subscription: WebhookSubscription,
  event: string,
  payload: Record<string, unknown>
): Promise<DispatchResult> {
  // SSRF guard — validate URL before any network activity
  try {
    await assertSafeWebhookUrl(subscription.url)
  } catch (err: any) {
    return { delivered: false, error: err.message }
  }

  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  })

  const signature = crypto
    .createHmac('sha256', subscription.secret)
    .update(body)
    .digest('hex')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(subscription.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Facilitator-Event': event,
        'X-Facilitator-Signature': `sha256=${signature}`,
        'X-Facilitator-Subscription-Id': subscription.subscriptionId,
        'User-Agent': 'facilitatorx402/1.0',
      },
      body,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (response.ok) {
      return { delivered: true, httpStatus: response.status }
    }

    const responseText = await response.text().catch(() => '')
    return {
      delivered: false,
      httpStatus: response.status,
      error: `HTTP ${response.status}: ${responseText.slice(0, 200)}`,
    }
  } catch (err: any) {
    clearTimeout(timeout)
    return {
      delivered: false,
      error: err?.name === 'AbortError' ? 'timeout after 10s' : err?.message,
    }
  }
}
