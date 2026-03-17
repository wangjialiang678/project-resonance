/**
 * DashScope CosyVoice TTS Edge Function
 *
 * Receives text input, synthesizes speech via DashScope's duplex WebSocket API,
 * buffers the complete MP3 response, then returns it as audio/mpeg.
 */

import WebSocket, { type RawData } from "npm:ws";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DASHSCOPE_WS_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/inference/";
const DASHSCOPE_MODEL = "cosyvoice-v3-flash";
const DEFAULT_VOICE = "longanyang";
const AUDIO_FORMAT = "mp3";
const SAMPLE_RATE = 22050;
const REQUEST_TIMEOUT_MS = 30_000;

interface TtsRequestBody {
  text: string;
  voice?: string;
}

interface DashScopeMessage {
  header?: {
    action?: string;
    event?: string;
    task_id?: string;
    code?: number;
    error_message?: string;
  };
  payload?: {
    output?: {
      code?: number;
      message?: string;
    };
  };
  code?: number;
  message?: string;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function buildRunTaskMessage(taskId: string, voice: string) {
  return {
    header: {
      action: "run-task",
      task_id: taskId,
      streaming: "duplex",
    },
    payload: {
      task_group: "audio",
      task: "tts",
      function: "SpeechSynthesizer",
      model: DASHSCOPE_MODEL,
      parameters: {
        voice,
        format: AUDIO_FORMAT,
        sample_rate: SAMPLE_RATE,
      },
      input: {},
    },
  };
}

export function buildContinueTaskMessage(taskId: string, text: string) {
  return {
    header: {
      action: "continue-task",
      task_id: taskId,
    },
    payload: {
      input: {
        text,
      },
    },
  };
}

export function buildFinishTaskMessage(taskId: string) {
  return {
    header: {
      action: "finish-task",
      task_id: taskId,
    },
    payload: {
      input: {},
    },
  };
}

export function concatAudioChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
}

export function extractWsError(message: DashScopeMessage): string | null {
  const code = message.header?.code ?? message.payload?.output?.code ??
    message.code;
  if (typeof code === "number" && code !== 0) {
    return message.header?.error_message ?? message.payload?.output?.message ??
      message.message ??
      `DashScope WebSocket returned code ${code}`;
  }

  if (message.header?.event === "task-failed") {
    return message.header?.error_message ?? message.payload?.output?.message ??
      message.message ?? "DashScope task failed";
  }

  return null;
}

function rawDataToUint8Array(data: RawData): Uint8Array {
  if (data instanceof Uint8Array) {
    return new Uint8Array(data);
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  if (Array.isArray(data)) {
    return concatAudioChunks(data.map((chunk) => rawDataToUint8Array(chunk)));
  }

  throw new Error("Received unsupported WebSocket data format");
}

function rawDataToString(data: RawData): string {
  return new TextDecoder().decode(rawDataToUint8Array(data));
}

async function synthesizeSpeech(
  text: string,
  voice: string,
  apiKey: string,
): Promise<Uint8Array> {
  const taskId = crypto.randomUUID();
  const ws = new WebSocket(DASHSCOPE_WS_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  return await new Promise<Uint8Array>((resolve, reject) => {
    const audioChunks: Uint8Array[] = [];
    let isSettled = false;

    const timeoutId = setTimeout(() => {
      fail(new Error("DashScope CosyVoice request timed out after 30 seconds"));
    }, REQUEST_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeoutId);

      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
    };

    const finish = (audio: Uint8Array) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      resolve(audio);
    };

    const fail = (error: Error) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      reject(error);
    };

    ws.on("open", () => {
      try {
        ws.send(JSON.stringify(buildRunTaskMessage(taskId, voice)));
        ws.send(JSON.stringify(buildContinueTaskMessage(taskId, text)));
        ws.send(JSON.stringify(buildFinishTaskMessage(taskId)));
      } catch (error) {
        fail(
          error instanceof Error
            ? error
            : new Error("Failed to send WebSocket messages"),
        );
      }
    });

    ws.on("message", (data, isBinary) => {
      if (!isBinary) {
        try {
          const message = JSON.parse(rawDataToString(data)) as DashScopeMessage;
          const errorMessage = extractWsError(message);

          if (errorMessage) {
            fail(new Error(errorMessage));
            return;
          }

          if (message.header?.event === "task-finished") {
            finish(concatAudioChunks(audioChunks));
          }
        } catch (error) {
          fail(
            error instanceof Error
              ? error
              : new Error("Failed to parse DashScope WebSocket response"),
          );
        }

        return;
      }

      audioChunks.push(rawDataToUint8Array(data));
    });

    ws.on("error", (error) => {
      fail(
        error instanceof Error
          ? error
          : new Error("Failed to connect to DashScope WebSocket"),
      );
    });

    ws.on("close", (code, reasonBuffer) => {
      if (!isSettled) {
        const reason = new TextDecoder().decode(reasonBuffer);
        fail(
          new Error(
            `DashScope WebSocket closed before completion (code: ${code}, reason: ${
              reason || "unknown"
            })`,
          ),
        );
      }
    });
  });
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const apiKey = Deno.env.get("DASHSCOPE_API_KEY");
  if (!apiKey) {
    return jsonResponse({ error: "DASHSCOPE_API_KEY not configured" }, 500);
  }

  try {
    const body = await req.json().catch(() => null) as TtsRequestBody | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const voice = typeof body?.voice === "string" && body.voice.trim()
      ? body.voice.trim()
      : DEFAULT_VOICE;

    if (!text) {
      return jsonResponse({ error: "Missing 'text' field" }, 400);
    }

    console.log(
      "[cosyvoice-tts] Generating speech, voice:",
      voice,
      "text length:",
      text.length,
    );

    const audio = await synthesizeSpeech(text, voice, apiKey);

    return new Response(audio, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("[cosyvoice-tts] Error:", error);
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
