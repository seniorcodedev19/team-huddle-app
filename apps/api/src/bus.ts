import { EventEmitter } from "node:events";

/* The notification bus: how a write in one request reaches a browser holding
   an open stream.

   This is a seam, not infrastructure. Today one Node process serves everyone,
   so an EventEmitter is the whole implementation. The day a second instance
   exists, a Redis (or Postgres LISTEN/NOTIFY) implementation goes behind this
   same interface and nothing above it changes — see
   docs/v1.2-review-pubsub.md for why that is deferred rather than built now.

   What the bus carries is deliberately minimal: a user id and an activity id.
   It makes delivery immediate; it is never what makes delivery reliable. The
   durable record is activity_recipients, and a client that reconnects asks
   for everything newer than the last id it saw. Losing a message here costs a
   notification's promptness, never the notification. */
export interface NotificationBus {
  /** Tell these users that an activity is waiting. */
  publish(userIds: number[], activityId: number): void;
  /** Listen for one user. Returns the unsubscribe. */
  subscribe(userId: number, onActivity: (activityId: number) => void): () => void;
}

class InProcessBus implements NotificationBus {
  private emitter = new EventEmitter();

  constructor() {
    /* One listener per open stream, and a person may have several tabs. The
       default limit of 10 would warn about a leak that is not one. */
    this.emitter.setMaxListeners(0);
  }

  publish(userIds: number[], activityId: number) {
    for (const id of userIds) this.emitter.emit(`u:${id}`, activityId);
  }

  subscribe(userId: number, onActivity: (activityId: number) => void) {
    const key = `u:${userId}`;
    this.emitter.on(key, onActivity);
    return () => this.emitter.off(key, onActivity);
  }
}

export const bus: NotificationBus = new InProcessBus();
