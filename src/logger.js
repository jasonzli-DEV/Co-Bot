const LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
const CURRENT = LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LEVELS.INFO;

function fmt(level, component, message, data) {
  const ts = new Date().toISOString();
  let out = `[${ts}] [${level.padEnd(5)}] [${component}] ${message}`;
  if (data) out += ' ' + JSON.stringify(data);
  return out;
}

export const error = (c, m, d) => CURRENT >= LEVELS.ERROR && console.error(fmt('ERROR', c, m, d));
export const warn  = (c, m, d) => CURRENT >= LEVELS.WARN  && console.warn(fmt('WARN',  c, m, d));
export const info  = (c, m, d) => CURRENT >= LEVELS.INFO  && console.log(fmt('INFO',  c, m, d));
export const debug = (c, m, d) => CURRENT >= LEVELS.DEBUG && console.log(fmt('DEBUG', c, m, d));
