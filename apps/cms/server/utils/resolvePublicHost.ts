import { promises as dnsPromises } from 'node:dns';
import { isIP } from 'node:net';
import { isPrivateHost } from './webhookUrl';

const DEFAULT_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.WEBHOOK_DNS_TIMEOUT_MS) || 3000, 100),
  30_000
);

export type DnsResolver = {
  resolve4: (hostname: string) => Promise<string[]>;
  resolve6: (hostname: string) => Promise<string[]>;
};

export type ResolveOpts = {
  timeoutMs?: number;
  dns?: DnsResolver;
};

export type ResolveResult = { addresses: string[] };

export type DnsErrorReason = 'PRIVATE_IP' | 'NXDOMAIN' | 'TIMEOUT';

export class WebhookDnsError extends Error {
  readonly reason: DnsErrorReason;
  readonly hostname: string;
  readonly offending?: string;

  constructor(reason: DnsErrorReason, hostname: string, offending?: string) {
    super(`${reason}: ${hostname}${offending ? ` (${offending})` : ''}`);
    this.name = 'WebhookDnsError';
    this.reason = reason;
    this.hostname = hostname;
    this.offending = offending;
  }
}

/**
 * Resolve a hostname to its public IPv4/IPv6 addresses, rejecting if any
 * resolved address is private. IP literals are returned as-is without a DNS
 * query. Used at both webhook validate-time and worker dispatch-time.
 *
 * Strict semantics: a single private IP in the answer set causes rejection.
 * See `~/Sites/boject-cms-internal/docs/superpowers/specs/2026-05-03-webhook-ssrf-dns-rebinding-design.md`.
 */
export async function resolvePublicHost(
  hostname: string,
  opts?: ResolveOpts
): Promise<ResolveResult> {
  if (isIP(hostname) > 0) {
    return { addresses: [hostname] };
  }

  const dns = opts?.dns ?? dnsPromises;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new WebhookDnsError('TIMEOUT', hostname));
    }, timeoutMs);
  });

  try {
    const settled = await Promise.race([
      Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]),
      timeoutPromise,
    ]);

    const addresses = settled.flatMap((r) =>
      r.status === 'fulfilled' ? r.value : []
    );

    if (addresses.length === 0) {
      throw new WebhookDnsError('NXDOMAIN', hostname);
    }

    for (const ip of addresses) {
      if (isPrivateHost(ip)) {
        throw new WebhookDnsError('PRIVATE_IP', hostname, ip);
      }
    }

    return { addresses };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
