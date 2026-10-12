// A collaboration between a brand and a creator, as an explicit state machine
// instead of a loose set of flags, so both sides always know whose turn it is
// and each screen reads its next action straight from the current state.

export type Status =
  | 'requested' // waiting for the brand's approval
  | 'scheduled' // waiting for the event date
  | 'subscribed' // checked in at the door, content pending
  | 'submitted' // waiting for the brand's review
  | 'changes_requested' // back to the creator
  | 'completed'
  | 'rejected';

const next: Record<Status, readonly Status[]> = {
  requested: ['scheduled', 'rejected'],
  scheduled: ['subscribed'],
  subscribed: ['submitted'],
  submitted: ['completed', 'changes_requested'],
  changes_requested: ['submitted'],
  completed: [],
  rejected: [],
};

export class InvalidTransition extends Error {
  constructor(
    readonly from: string,
    readonly to: Status,
  ) {
    super(`Invalid transition ${from} → ${to}`);
  }
}

/** Fails loudly instead of leaving a collaboration in a state nobody planned for. */
export function transition(from: string, to: Status): Status {
  if (!isStatus(from) || !next[from].includes(to)) {
    throw new InvalidTransition(from, to);
  }
  return to;
}

export function nextSteps(from: Status): readonly Status[] {
  return next[from];
}

function isStatus(value: string): value is Status {
  return value in next;
}
