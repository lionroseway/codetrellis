/**
 * Channel events — Phase 1.3 of the CDev target architecture.
 *
 * See docs/cdev/08-agent-collaboration.md for the design.
 *
 * Six event types form a tight peer-to-peer vocabulary for team
 * coordination: both humans and agents can post; both can respond.
 * Events live in the manifest (`<projectRoot>/.codetrellis/plans/<slug>/
 * channels/<event-uid>.yaml`) so they travel through git like any
 * other plan content.
 *
 * The vocabulary is intentionally small. `checkpoint`-style progress
 * milestones don't live here — they belong in the plan timeline
 * (`plan_events`).
 */

export type ChannelEventType =
  | 'stuck'           // Failing repeatedly, need help.
  | 'need-decision'   // Genuine choice can't make alone.
  | 'need-context'    // Missing knowledge to proceed.
  | 'handing-off'     // Another actor should take over; here's what was tried.
  | 'steer'           // Direction in response to stuck or need-decision.
  | 'weigh-in';       // Here's my thinking — what do others see?

export type ChannelEventStatus = 'open' | 'resolved' | 'dismissed';

/**
 * Flexible payload — every event carries at minimum a human-readable
 * `message`. Type-specific fields are optional; the renderer surfaces
 * the ones present.
 */
export interface ChannelEventPayload {
  /** Plain-English description of the event. Required. */
  message: string;

  /** For stuck / handing-off: a short list of what was tried. */
  attempted?: string[];

  /** Optional structured references to entities the event touches. */
  references?: {
    commits?: string[];
    files?: string[];
    tools?: string[];
    items?: string[];
  };

  /** For need-decision: the alternatives the asker has identified. */
  options?: string[];

  /** Free-form extension point for type-specific fields the UI may render. */
  [extra: string]: unknown;
}

export interface ChannelEvent {
  uid: string;
  planUid: string;
  /** Optional anchor to a specific plan item. */
  itemUid: string | null;
  eventType: ChannelEventType;
  payload: ChannelEventPayload;
  /** Responsible human's identity (email or role string). */
  author: string;
  /** 'human' or an agent-type identifier. */
  authorType: string;
  /** Model in use when the author is an agent. */
  agentModel: string | null;
  /** UID of the event this one responds to, when threaded. */
  respondsTo: string | null;
  status: ChannelEventStatus;
  /** UNIX ms. */
  createdAt: number;
  /** UNIX ms. Updated on status changes. */
  updatedAt: number;
}

/** The complete set of valid event types, for runtime validation. */
export const CHANNEL_EVENT_TYPES: readonly ChannelEventType[] = [
  'stuck',
  'need-decision',
  'need-context',
  'handing-off',
  'steer',
  'weigh-in',
] as const;

/** The complete set of valid status values, for runtime validation. */
export const CHANNEL_EVENT_STATUSES: readonly ChannelEventStatus[] = [
  'open',
  'resolved',
  'dismissed',
] as const;
