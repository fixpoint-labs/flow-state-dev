/**
 * Binary <-> base64 helpers shared by streaming emitters and TTS pipelines.
 * Node uses Buffer for the fast path; browsers/edge runtimes fall back to a
 * charCode loop + btoa. The conversion is symmetric with `atob` decoders on
 * the client.
 */

/**
 * Encodes raw audio (or any binary) bytes as a base64 string suitable for
 * embedding in a JSON SSE frame.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}
