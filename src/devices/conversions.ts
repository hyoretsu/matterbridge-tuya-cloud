import { Status, StatusResponseError } from 'matterbridge/matter/types';
import type { Transaction } from 'matterbridge/matter';

/** Attribute change events are synchronous. Cloud work joins commit phase one,
 * so writes wait for success and a rejection rolls Matter state back. */
export function cloudWrite(transaction: Transaction, role: object, operation: () => Promise<void>, priority = 1): void {
  const existing = transaction.getParticipant(role) as { operation: () => Promise<void>; priority: number } | undefined;
  if (existing) {
    if (priority >= existing.priority) { existing.operation = operation; existing.priority = priority; }
    return;
  }
  const pending = { role, operation, priority, toString: () => 'Tuya cloud write', commit1: () => pending.operation() };
  transaction.addParticipants(pending);
}

export function numeric(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '' || typeof value === 'boolean') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
export function boolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true' || value === 'True') return true;
  if (value === false || value === 'false' || value === 'False') return false;
  return undefined;
}
export function scale(value: number, sourceMin: number, sourceMax: number, targetMin: number, targetMax: number): number {
  if (sourceMax <= sourceMin) throw new Error('Invalid conversion range');
  return Math.round(targetMin + Math.min(1, Math.max(0, (value - sourceMin) / (sourceMax - sourceMin))) * (targetMax - targetMin));
}
export function unsupported(message = 'Operation unavailable in Tuya cloud API'): never {
  throw new StatusResponseError(message, Status.UnsupportedCommand);
}
export async function matterCommand(operation: () => Promise<void>): Promise<void> {
  try { await operation(); } catch (error) {
    if (error instanceof StatusResponseError) throw error;
    throw new StatusResponseError(error instanceof Error ? error.message : 'Tuya command failed', Status.Failure);
  }
}

export function unsupportedWrite(message:string):never {throw new StatusResponseError(message,Status.UnsupportedWrite);}
