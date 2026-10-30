type Fields = Record<string, unknown>;

function write(level: string, msg: string, fields?: Fields): void {
  const line = { t: new Date().toISOString(), level, service: process.env.SERVICE_NAME ?? 'ars', msg, ...fields };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

export const log = {
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields),
};

export function errorFields(error: unknown): Fields {
  if (error instanceof Error) return { error: error.message, stack: error.stack };
  return { error: String(error) };
}
