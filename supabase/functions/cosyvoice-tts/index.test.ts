import {
  buildContinueTaskMessage,
  buildFinishTaskMessage,
  buildRunTaskMessage,
  concatAudioChunks,
  extractWsError,
} from "./index.ts";

Deno.test("buildRunTaskMessage uses DashScope CosyVoice payload shape", () => {
  const message = buildRunTaskMessage("task-123", "longxiaochun");

  if (message.header.action !== "run-task") {
    throw new Error("run-task action mismatch");
  }

  if (message.header.streaming !== "duplex") {
    throw new Error("streaming mode mismatch");
  }

  if (message.payload.model !== "cosyvoice-v3-flash") {
    throw new Error("model mismatch");
  }

  if (message.payload.parameters.voice !== "longxiaochun") {
    throw new Error("voice mismatch");
  }

  if (message.payload.parameters.format !== "mp3") {
    throw new Error("format mismatch");
  }
});

Deno.test("continue and finish messages keep the task id", () => {
  const continueMessage = buildContinueTaskMessage("task-456", "hello");
  const finishMessage = buildFinishTaskMessage("task-456");

  if (continueMessage.header.task_id !== "task-456") {
    throw new Error("continue-task task id mismatch");
  }

  if (continueMessage.payload.input.text !== "hello") {
    throw new Error("continue-task text mismatch");
  }

  if (finishMessage.header.action !== "finish-task") {
    throw new Error("finish-task action mismatch");
  }
});

Deno.test("concatAudioChunks merges audio buffers in order", () => {
  const merged = concatAudioChunks([
    new Uint8Array([1, 2]),
    new Uint8Array([3]),
    new Uint8Array([4, 5]),
  ]);

  const expected = [1, 2, 3, 4, 5];
  if (merged.length !== expected.length) {
    throw new Error("merged length mismatch");
  }

  expected.forEach((value, index) => {
    if (merged[index] !== value) {
      throw new Error("merged content mismatch");
    }
  });
});

Deno.test("extractWsError surfaces non-zero codes", () => {
  const error = extractWsError({
    header: {
      code: 400,
      error_message: "bad request",
    },
  });

  if (error !== "bad request") {
    throw new Error("expected error message from non-zero code");
  }
});
