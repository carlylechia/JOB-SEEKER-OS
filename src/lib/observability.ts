type AlertLevel = 'info' | 'warn' | 'error';

type ImportantEventArgs = {
  event: string;
  userId?: string;
  jobId?: string;
  route?: string;
  error?: unknown;
  context?: Record<string, unknown>;
};

type AlertPayload = {
  title: string;
  message: string;
  level?: AlertLevel;
  context?: Record<string, unknown>;
};

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[unserializable context]';
  }
}

function truncate(value: string, max = 1800) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function formatDiscordContent(payload: AlertPayload) {
  const level = payload.level ?? 'error';

  const lines = [
    `**[Job Seeker OS] ${payload.title}**`,
    '',
    payload.message,
    '',
    `**Level:** ${level.toUpperCase()}`,
  ];

  if (payload.context && Object.keys(payload.context).length > 0) {
    const contextBlock = truncate(safeStringify(payload.context));
    lines.push('', '**Context:**', `\`\`\`json\n${contextBlock}\n\`\`\``);
  }

  return truncate(lines.join('\n'), 1900);
}

export async function sendAlert(payload: AlertPayload) {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;

  if (!webhookUrl) {
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: formatDiscordContent(payload),
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('[observability] Discord webhook failed', {
        status: response.status,
        statusText: response.statusText,
        body: text,
      });
    }
  } catch (error) {
    console.error('[observability] Failed to send alert', error);
  }
}

export async function logImportantInfo(args: ImportantEventArgs) {
  console.info(`[important] ${args.event}`, {
    userId: args.userId,
    jobId: args.jobId,
    route: args.route,
    ...(args.context ?? {}),
  });
}

export async function logImportantError(args: ImportantEventArgs) {
  const mergedContext: Record<string, unknown> = {
    userId: args.userId,
    jobId: args.jobId,
    route: args.route,
    ...(args.context ?? {}),
  };

  if (args.error instanceof Error) {
    mergedContext.errorName = args.error.name;
    mergedContext.errorMessage = args.error.message;
    mergedContext.errorStack = args.error.stack;
  } else if (args.error !== undefined) {
    mergedContext.error = args.error;
  }

  console.error(`[important-error] ${args.event}`, mergedContext);

  await sendAlert({
    title: args.event,
    message: `An important application error occurred${args.route ? ` on ${args.route}` : ''}.`,
    level: 'error',
    context: mergedContext,
  });
}
