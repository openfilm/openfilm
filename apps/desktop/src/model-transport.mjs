import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';

const active = new AsyncLocalStorage();
const requests = new WeakMap();

// Keep only the error code. Error messages and request objects can contain credentials or prompt data.
const TRANSPORT_CODE = /^(?:UND_ERR_[A-Z_]+|ERR_TLS_[A-Z_]+|E(?:CONNRESET|CONNREFUSED|HOSTUNREACH|NETUNREACH|TIMEDOUT|AI_AGAIN|NOTFOUND|PIPE)|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$/;

channel('undici:request:create').subscribe(({ request }) => {
  const scope = active.getStore();
  if (!scope?.transport.attempt || request.method !== 'POST' || String(request.origin) !== scope.origin) return;
  const wire = { phase: 'connecting' };
  scope.transport.attempt.wire = wire;
  requests.set(request, wire);
});
channel('undici:request:bodySent').subscribe(({ request }) => {
  const wire = requests.get(request);
  if (wire?.phase === 'connecting') wire.phase = 'waiting';
});
channel('undici:request:headers').subscribe(({ request, response }) => {
  const wire = requests.get(request);
  if (!wire) return;
  wire.phase = 'streaming';
  wire.status = response.statusCode;
  const headers = response.headers;
  if (!Array.isArray(headers)) return;
  for (let i = 0; i < headers.length; i += 2) {
    if (!/^(?:x-request-id|request-id|cf-ray)$/i.test(String(headers[i]))) continue;
    const value = String(headers[i + 1]).trim();
    if (/^[\w.-]{1,128}$/.test(value)) { wire.requestId = value; break; }
  }
});
channel('undici:request:error').subscribe(({ request, error }) => {
  const wire = requests.get(request);
  if (!wire) return;
  for (let cause = error, depth = 0; cause && depth < 5; cause = cause.cause, depth += 1) {
    if (typeof cause.code === 'string' && TRANSPORT_CODE.test(cause.code)) { wire.code = cause.code; break; }
  }
});

export function observeModelTransport(baseUrl, transport, run) {
  const url = new URL(baseUrl);
  transport.host = url.host;
  transport.attempt = null;
  return active.run({ origin: url.origin, transport }, run);
}

export function connectionDetails(transport, message, retries) {
  const { attempt, host } = transport;
  const wire = attempt?.wire;
  return {
    host,
    phase: wire?.phase ?? (/^terminated\.?$/i.test(message.errorMessage.trim()) ? 'streaming' : 'unknown'),
    ...(wire?.status ? { status: wire.status } : {}),
    ...(wire?.requestId ? { requestId: wire.requestId } : {}),
    ...(wire?.code ? { code: wire.code } : {}),
    ...(attempt ? { elapsedMs: Math.max(0, Date.now() - attempt.startedAt) } : {}),
    retries,
    partial: message.content.some((block) => block.type === 'text' && block.text.length > 0),
  };
}
