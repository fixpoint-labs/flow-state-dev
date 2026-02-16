export type SSEFrame = {
  id?: string;
  event?: string;
  data?: unknown;
  retry?: number;
  comment?: string;
};

function toDataString(data: unknown): string {
  if (data === undefined) {
    return "";
  }

  if (typeof data === "string") {
    return data;
  }

  return JSON.stringify(data);
}

export function serializeSSEFrame(frame: SSEFrame): string {
  const lines: string[] = [];

  if (frame.comment !== undefined) {
    lines.push(`: ${frame.comment}`);
  }

  if (frame.id !== undefined) {
    lines.push(`id: ${frame.id}`);
  }

  if (frame.event !== undefined) {
    lines.push(`event: ${frame.event}`);
  }

  if (frame.retry !== undefined) {
    lines.push(`retry: ${Math.max(0, Math.floor(frame.retry))}`);
  }

  const dataString = toDataString(frame.data);
  const dataLines = dataString.split("\n");
  for (const line of dataLines) {
    lines.push(`data: ${line}`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function serializeSSEFrames(frames: SSEFrame[]): string {
  return frames.map((frame) => serializeSSEFrame(frame)).join("");
}
