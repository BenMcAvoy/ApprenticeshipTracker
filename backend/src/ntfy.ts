export type Notification = {
  title: string;
  message: string;
  /** 1 (min) – 5 (max); ntfy default is 3 */
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  /** URL opened when the notification is tapped */
  click?: string;
};

const TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/;
// ntfy rejects bodies over 4096 bytes.
const MAX_MESSAGE_BYTES = 3900;

export const isValidTopic = (topic: string) => TOPIC_RE.test(topic);

function truncate(message: string) {
  if (Buffer.byteLength(message) <= MAX_MESSAGE_BYTES) return message;
  let out = message;
  while (Buffer.byteLength(out) > MAX_MESSAGE_BYTES - 20) out = out.slice(0, Math.floor(out.length * 0.9));
  return `${out.trimEnd()}\n…(truncated)`;
}

/** Publishes via ntfy's JSON API (UTF-8 safe, unlike header-based publishing). */
export async function sendNtfy(server: string, topic: string, notification: Notification): Promise<void> {
  if (!isValidTopic(topic)) throw new Error("Invalid ntfy topic (letters, numbers, _ and - only).");
  const res = await fetch(server.replace(/\/+$/, ""), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topic, ...notification, message: truncate(notification.message) }),
    signal: AbortSignal.timeout(15_000),
  }).catch((error: Error & { cause?: { message?: string } }) => {
    throw new Error(`Couldn't reach ${server}: ${error.cause?.message ?? error.message}`);
  });
  if (!res.ok) throw new Error(`ntfy responded HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
}
