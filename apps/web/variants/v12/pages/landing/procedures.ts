import type { LucideIcon } from 'lucide-react';
import { CircleAlertIcon, ClockIcon, HourglassIcon, ListChecksIcon, SirenIcon, TriangleAlertIcon } from 'lucide-react';

/**
 * v12 "Field manual": the seven procedures of the landing page. The accounts page points each stake account at one of
 * them (`/#p2`), so the ids are part of the address and stay fixed.
 */
export type ProcedureId = 'p1' | 'p2' | 'p3' | 'p4' | 'p5' | 'p6' | 'p7';

export type Urgency = { word: string; tone: 'danger' | 'warning' | 'info' | 'neutral'; icon: LucideIcon };

export const URGENCY = {
  emergency: { word: 'Emergency', tone: 'danger', icon: SirenIcon },
  urgent: { word: 'Act first', tone: 'warning', icon: TriangleAlertIcon },
  dated: { word: 'Before a date', tone: 'warning', icon: ClockIcon },
  wait: { word: 'Wait', tone: 'info', icon: HourglassIcon },
  again: { word: 'Protect again', tone: 'danger', icon: CircleAlertIcon },
  routine: { word: 'Routine', tone: 'neutral', icon: ListChecksIcon },
} as const satisfies Record<string, Urgency>;

/** Short names for the index ("Find your situation") and the accounts page. */
export const PROCEDURES: readonly { id: ProcedureId; code: string; situation: string; urgency: Urgency }[] = [
  { id: 'p1', code: 'P1', situation: 'My main key is stolen', urgency: URGENCY.emergency },
  { id: 'p2', code: 'P2', situation: 'The lock ends soon', urgency: URGENCY.dated },
  { id: 'p3', code: 'P3', situation: 'I lost the second key', urgency: URGENCY.wait },
  { id: 'p4', code: 'P4', situation: 'The lock has ended', urgency: URGENCY.again },
  { id: 'p5', code: 'P5', situation: 'My second key is stolen', urgency: URGENCY.urgent },
  { id: 'p6', code: 'P6', situation: 'I want my SOL out', urgency: URGENCY.routine },
  { id: 'p7', code: 'P7', situation: 'Stakeward is gone', urgency: URGENCY.routine },
];

export function procedure(id: ProcedureId) {
  const found = PROCEDURES.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`Unknown procedure ${id}`);
  return found;
}

/** Status tone classes written out in full, so Tailwind generates them. */
export const TONE_TEXT: Record<Urgency['tone'], string> = {
  danger: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
  neutral: 'text-neutral',
};
