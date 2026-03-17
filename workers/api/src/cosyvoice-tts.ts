/**
 * CosyVoice TTS Handler
 *
 * Uses Cloudflare Workers connect() API for raw TCP/TLS to DashScope,
 * with manual WebSocket handshake to pass Authorization header
 * (Workers' fetch() strips custom headers from WebSocket upgrades).
 */

import type { ValidatedEnv } from "./env";
import { corsHeaders, corsResponse } from "./cors";
// @ts-ignore — cloudflare:sockets is a Workers built-in, no type declarations
import { connect } from "cloudflare:sockets";

const DASHSCOPE_HOST = "dashscope.aliyuncs.com";
const DASHSCOPE_PATH = "/api-ws/v1/inference/";
const MODEL = "cosyvoice-v3-flash";
const DEFAULT_VOICE = "longanyang";
const TIMEOUT_MS = 30_000;

interface TtsRequestBody { text: string; voice?: string; }

interface DashScopeMessage {
  header?: { event?: string; code?: number; error_message?: string; };
  payload?: { output?: { code?: number; message?: string } };
  code?: number; message?: string;
}

interface ParsedFrame {
  fin: boolean;
  opcode: number;
  payload: Uint8Array<ArrayBufferLike>;
}

function extractError(msg: DashScopeMessage): string | null {
  const code = msg.header?.code ?? msg.payload?.output?.code ?? msg.code;
  if (typeof code === "number" && code !== 0)
    return msg.header?.error_message ?? msg.payload?.output?.message ?? msg.message ?? `DashScope error ${code}`;
  if (msg.header?.event === "task-failed")
    return msg.header?.error_message ?? "task failed";
  return null;
}

// --- Minimal WebSocket frame encoder/decoder ---

function encodeFrame(data: Uint8Array<ArrayBufferLike>, opcode: number): Uint8Array {
  const len = data.byteLength;
  const mask = crypto.getRandomValues(new Uint8Array(4));
  let header: number[];

  if (len < 126) {
    header = [0x80 | opcode, 0x80 | len];
  } else if (len < 65536) {
    header = [0x80 | opcode, 0x80 | 126, (len >> 8) & 0xff, len & 0xff];
  } else {
    header = [0x80 | opcode, 0x80 | 127, 0, 0, 0, 0,
      (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff];
  }

  const frame = new Uint8Array(header.length + 4 + len);
  frame.set(header, 0);
  frame.set(mask, header.length);
  for (let i = 0; i < len; i++) {
    frame[header.length + 4 + i] = data[i] ^ mask[i % 4];
  }
  return frame;
}

function encodeTextFrame(text: string): Uint8Array {
  return encodeFrame(new TextEncoder().encode(text), 0x1);
}

function encodeCloseFrame(): Uint8Array {
  return encodeFrame(new Uint8Array([0x03, 0xe8]), 0x8); // 1000 normal close
}

function concatUint8Arrays(...chunks: ArrayLike<number>[]): Uint8Array<ArrayBufferLike> {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

function parseFrames(buf: Uint8Array<ArrayBufferLike>): {
  frames: ParsedFrame[];
  remaining: Uint8Array<ArrayBufferLike>;
} {
  const frames: ParsedFrame[] = [];
  let offset = 0;

  while (offset < buf.length) {
    if (offset + 2 > buf.length) break;
    const byte0 = buf[offset];
    const byte1 = buf[offset + 1];
    const fin = (byte0 & 0x80) !== 0;
    const opcode = byte0 & 0x0f;
    const masked = (byte1 & 0x80) !== 0;
    let payloadLen = byte1 & 0x7f;
    let headerLen = 2;

    if (payloadLen === 126) {
      if (offset + 4 > buf.length) break;
      payloadLen = (buf[offset + 2] << 8) | buf[offset + 3];
      headerLen = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buf.length) break;
      payloadLen = 0;
      for (let i = 2; i < 10; i++) payloadLen = payloadLen * 256 + buf[offset + i];
      if (payloadLen > 100_000_000) throw new Error(`WebSocket frame too large: ${payloadLen}`);
      headerLen = 10;
    }

    if (masked) headerLen += 4;
    if (offset + headerLen + payloadLen > buf.length) break;

    let payload = buf.slice(offset + headerLen, offset + headerLen + payloadLen);
    if (masked) {
      const maskKey = buf.slice(offset + headerLen - 4, offset + headerLen);
      const unmasked = new Uint8Array(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        unmasked[i] = payload[i] ^ maskKey[i % 4];
      }
      payload = unmasked;
    }

    frames.push({ fin, opcode, payload });
    offset += headerLen + payloadLen;
  }

  return { frames, remaining: buf.slice(offset) };
}

async function synthesizeSpeech(text: string, voice: string, apiKey: string): Promise<Uint8Array> {
  const taskId = crypto.randomUUID();

  // Connect via TLS to DashScope
  const socket = connect(
    { hostname: DASHSCOPE_HOST, port: 443 },
    { secureTransport: "on", allowHalfOpen: false },
  );
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  try {
    // Manual WebSocket handshake
    const wsKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    const upgradeReq =
      `GET ${DASHSCOPE_PATH} HTTP/1.1\r\n` +
      `Host: ${DASHSCOPE_HOST}\r\n` +
      `Upgrade: websocket\r\n` +
      `Connection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${wsKey}\r\n` +
      `Sec-WebSocket-Version: 13\r\n` +
      `Authorization: Bearer ${apiKey}\r\n` +
      `\r\n`;

    await writer.write(new TextEncoder().encode(upgradeReq));

    // Read HTTP upgrade response
    let httpBuf: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    let wsDataBuf: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("Connection closed during handshake");

      httpBuf = concatUint8Arrays(httpBuf, value);

      const headerEnd = new TextDecoder().decode(httpBuf).indexOf("\r\n\r\n");
      if (headerEnd >= 0) {
        const httpResponse = new TextDecoder().decode(httpBuf.slice(0, headerEnd));
        if (!httpResponse.startsWith("HTTP/1.1 101")) {
          const bodyStart = headerEnd + 4;
          const responseBody = new TextDecoder().decode(httpBuf.slice(bodyStart, bodyStart + 300));
          throw new Error(`Handshake ${httpResponse.split("\r\n")[0]}: ${responseBody}`);
        }
        wsDataBuf = httpBuf.slice(headerEnd + 4);
        break;
      }
    }

    // Send TTS messages
    const sendText = async (msg: object) => {
      await writer.write(encodeTextFrame(JSON.stringify(msg)));
    };

    await sendText({
      header: { action: "run-task", task_id: taskId, streaming: "duplex" },
      payload: {
        task_group: "audio", task: "tts", function: "SpeechSynthesizer",
        model: MODEL, parameters: { voice, format: "mp3", sample_rate: 22050 }, input: {},
      },
    });
    await sendText({
      header: { action: "continue-task", task_id: taskId },
      payload: { input: { text } },
    });
    await sendText({
      header: { action: "finish-task", task_id: taskId },
      payload: { input: {} },
    });

    // Read WebSocket frames
    const audioChunks: Uint8Array<ArrayBufferLike>[] = [];
    const deadline = Date.now() + TIMEOUT_MS;
    let fragmentedOpcode: number | null = null;
    let fragmentedPayload: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

    const handleCompleteFrame = async (
      opcode: number,
      payload: Uint8Array<ArrayBufferLike>,
    ): Promise<Uint8Array<ArrayBufferLike> | null> => {
      if (opcode === 0x8) {
        throw new Error("WebSocket closed by server");
      }
      if (opcode === 0x9 || opcode === 0xa) {
        return null;
      }
      if (opcode === 0x2) {
        audioChunks.push(payload);
        return null;
      }
      if (opcode !== 0x1) {
        return null;
      }

      const msg = JSON.parse(new TextDecoder().decode(payload)) as DashScopeMessage;
      const err = extractError(msg);
      if (err) throw new Error(err);
      if (msg.header?.event === "task-finished") {
        const merged = concatUint8Arrays(...audioChunks);
        await writer.write(encodeCloseFrame());
        return merged;
      }
      return null;
    };

    while (Date.now() < deadline) {
      const { frames, remaining } = parseFrames(wsDataBuf);
      wsDataBuf = remaining;

      for (const frame of frames) {
        if (frame.opcode === 0x0) {
          if (fragmentedOpcode === null) {
            throw new Error("Unexpected WebSocket continuation frame");
          }
          fragmentedPayload = concatUint8Arrays(fragmentedPayload, frame.payload);
          if (frame.fin) {
            const result = await handleCompleteFrame(fragmentedOpcode, fragmentedPayload);
            fragmentedOpcode = null;
            fragmentedPayload = new Uint8Array(0);
            if (result) {
              return result;
            }
          }
          continue;
        }

        if (!frame.fin) {
          fragmentedOpcode = frame.opcode;
          fragmentedPayload = frame.payload;
          continue;
        }

        const result = await handleCompleteFrame(frame.opcode, frame.payload);
        if (result) {
          return result;
        }
      }

      const { value, done } = await reader.read();
      if (done) break;
      wsDataBuf = concatUint8Arrays(wsDataBuf, value);
    }

    throw new Error("TTS timeout");
  } finally {
    try { writer.releaseLock(); } catch { /* already released */ }
    try { reader.releaseLock(); } catch { /* already released */ }
    try { socket.close(); } catch { /* already closed */ }
  }
}

export async function handleTTS(request: Request, env: ValidatedEnv, origin?: string | null): Promise<Response> {
  if (request.method !== "POST") {
    return corsResponse(JSON.stringify({ error: "Method not allowed" }), 405, undefined, origin);
  }

  try {
    const body = await request.json().catch(() => null) as TtsRequestBody | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const voice = typeof body?.voice === "string" && body.voice.trim() ? body.voice.trim() : DEFAULT_VOICE;

    if (!text) return corsResponse(JSON.stringify({ error: "Missing 'text'" }), 400, undefined, origin);

    const audio = await synthesizeSpeech(text, voice, env.DASHSCOPE_API_KEY);

    return new Response(audio, {
      status: 200,
      headers: { ...corsHeaders(origin), "Content-Type": "audio/mpeg", "Cache-Control": "no-cache" },
    });
  } catch (err) {
    console.error("[tts] Error:", err);
    return corsResponse(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), 500, undefined, origin);
  }
}
