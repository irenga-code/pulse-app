import { createContext, type Context } from 'react';

type Registry = Map<string, Context<unknown>>;
const registry: Registry = ((globalThis as { __pulseContexts?: Registry }).__pulseContexts ??= new Map());

/**
 * createContext that keeps the same context object when the dev server hot-reloads the module that made it.
 * Without this, editing a file the provider module imports re-creates the context while the mounted provider still
 * holds the old one, and every useX() hook throws "must be used within ...Provider" until a full reload.
 * Production builds never re-run modules, so this is a plain createContext there.
 */
export function stableContext<T>(key: string, defaultValue: T): Context<T> {
  if (!import.meta.hot) return createContext(defaultValue);
  if (!registry.has(key)) registry.set(key, createContext<unknown>(defaultValue));
  return registry.get(key) as Context<T>;
}
