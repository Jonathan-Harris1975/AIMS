import pino from "pino";

function normaliseEnvString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function isProductionEnv(value = process.env.NODE_ENV) {
  return normaliseEnvString(value).toLowerCase() === "production";
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return false;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function serialiseError(err) {
  if (!(err instanceof Error)) return err;
  return {
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
    },
  };
}

function normaliseLogArgs(args) {
  if (!Array.isArray(args) || args.length === 0) return args;

  const [first, second, ...rest] = args;

  if (typeof first === "string" && second instanceof Error) {
    return [serialiseError(second), first, ...rest];
  }

  if (typeof first === "string" && isPlainObject(second)) {
    return [second, first, ...rest];
  }

  if (first instanceof Error && typeof second === "string") {
    return [serialiseError(first), second, ...rest];
  }

  return args;
}

function wrapLogger(instance) {
  const methodNames = new Set(["trace", "debug", "info", "warn", "error", "fatal"]);

  return new Proxy(instance, {
    get(target, prop, receiver) {
      if (prop === "child") {
        return (bindings, options) => wrapLogger(target.child(bindings, options));
      }

      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }

      if (!methodNames.has(prop)) {
        return value.bind(target);
      }

      return (...args) => value.apply(target, normaliseLogArgs(args));
    },
  });
}

const isProd =
  isProductionEnv() ||
  parseBoolean(process.env.SHIPPER) ||
  parseBoolean(process.env.SHIPER);

let loggerInstance = globalThis.__AI_PODCAST_LOGGER__;

if (!loggerInstance) {
  loggerInstance = pino(
    isProd
      ? {
          level: process.env.LOG_LEVEL || "info",
          base: { service: "AI-management-suite" },
          timestamp: pino.stdTimeFunctions.isoTime,
          messageKey: "msg",
        }
      : {
          level: process.env.LOG_LEVEL || "debug",
          base: { service: "AI-management-suite" },
          timestamp: pino.stdTimeFunctions.isoTime,
          messageKey: "msg",
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              singleLine: false,
              translateTime: "SYS:standard",
              ignore: "pid,hostname",
              messageKey: "msg",
            },
          },
        }
  );

  globalThis.__AI_PODCAST_LOGGER__ = loggerInstance;
}

const log = wrapLogger(loggerInstance);

const isDebugRoutes = parseBoolean(process.env.DEBUG_ROUTES);
export function safeRouteLog(obj = {}) {
  if (!isDebugRoutes) return;
  log.info(obj, "debug.route");
}

export const info = (msg, obj = {}) => log.info(obj, msg);
export const warn = (msg, obj = {}) => log.warn(obj, msg);
export const error = (msg, obj = {}) => log.error(obj, msg);
export const debug = (msg, obj = {}) => log.debug(obj, msg);
export const success = (msg, obj = {}) => log.info(obj, msg);
export { log, loggerInstance as rawLog };
export default log;
