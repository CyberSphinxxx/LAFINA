import { useEffect } from 'react';

/**
 * Handles hardware Back inside a tool screen — for example from an open deck
 * back to the deck list — before the app leaves the tool. Returns true when
 * it dealt with the press.
 */
export type ToolBackHandler = () => boolean;

/** Given to tool screens by the app shell; `null` withdraws the handler. */
export type RegisterToolBack = (handler: ToolBackHandler | null) => void;

/** Registers `handler` while mounted, and whenever it changes. */
export const useToolBack = (
  register: RegisterToolBack | undefined,
  handler: ToolBackHandler | null
): void => {
  useEffect(() => {
    if (!register) return undefined;
    register(handler);
    return () => register(null);
  }, [register, handler]);
};
