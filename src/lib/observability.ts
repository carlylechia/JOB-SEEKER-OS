type LogLevel = 'info' | 'warn' | 'error';

type EventPayload = {
  event: string;
  userId?: string;
  jobId?: string;
  route?: string;
  context?: Record<string, unknown>;
  error?: unknown;
};

function stringifyError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

async function sendAlert(level: LogLevel, payload: EventPayload) {
  const webhook = process.env.ALERT_WEBHOOK_URL;
  if (!webhook || level !== 'error') return;

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `[Job Seeker OS][${level.toUpperCase()}] ${payload.event}`,
        payload: {
          ...payload,
          error: payload.error ? stringifyError(payload.error) : undefined,
          timestamp: new Date().toISOString(),
        },
      }),
    });
  } catch {
    // avoid recursive logging loops
  }
}

export async function logEvent(level: LogLevel, payload: EventPayload) {
  const body = {
    ...payload,
    error: payload.error ? stringifyError(payload.error) : undefined,
    timestamp: new Date().toISOString(),
  };

  if (level === 'error') console.error(body);
  else if (level === 'warn') console.warn(body);
  else console.info(body);

  await sendAlert(level, payload);
}

export async function logImportantInfo(payload: EventPayload) {
  return logEvent('info', payload);
}

export async function logImportantError(payload: EventPayload) {
  return logEvent('error', payload);
}
