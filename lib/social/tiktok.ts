// Publisher de TikTok — Direct Post real, vía la Edge Function
// supabase/functions/tiktok-upload/index.ts (acción "direct_init"). Mismo
// contrato que los demás publishers (publishToYouTube, publishToFacebook,
// publishToInstagram): recibe `post`/`credentials`/`onOperationRef`, devuelve
// `PublishResult`.
//
// Arquitectura deliberada — TikTok NUNCA recibe/almacena credenciales acá:
//   Agent 3 -> Edge Function tiktok-upload -> social_accounts -> TikTok API
// `credentials` se recibe por el mismo contrato que los demás publishers
// pero se ignora a propósito (ver lib/social/credentialFields.ts: tiktok: []
// - el Edge Function resuelve access_token/refresh_token internamente desde
// social_accounts usando account_id, nunca desde acá).
//
// Fuente del video: post.local_file_path (igual que YouTube) - NUNCA
// Supabase Storage. Los bytes se leen del disco por streams acotados
// (createReadStream con {start,end}) y se mandan chunk por chunk al Edge
// Function - nunca se carga el video completo en memoria acá tampoco.
//
// SEGURIDAD - nunca se loguea/imprime: access_token, refresh_token,
// client_secret, session_id completo, upload_url. Sí se loguea (vía errores
// normales o PublicationOutcomeUncertainError, nunca console.log directo):
// postId/accountId/publish_id/chunk_index/total_chunks/status.
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { composeCaptionWithHashtags } from "./captionComposition";
import { PublicationOutcomeUncertainError } from "./types";
import type { PublishResult, SocialPost } from "./types";

const STATUS_POLL_INTERVAL_MS = 2000;
const STATUS_POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos, recomendación explícita de la tarea

function edgeFunctionUrl(): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL en el entorno - necesario para llamar a la Edge Function tiktok-upload.");
  }
  return `${base.replace(/\/$/, "")}/functions/v1/tiktok-upload`;
}

interface DirectInitResponse {
  ok: boolean;
  session_id?: string;
  publish_id?: string;
  chunk_size?: number;
  total_chunk_count?: number;
  error?: string;
  message?: string;
}

async function callDirectInit(accountId: string, videoSize: number, title: string | undefined): Promise<DirectInitResponse> {
  const res = await fetch(edgeFunctionUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "direct_init", account_id: accountId, video_size: videoSize, ...(title ? { title } : {}) }),
  });
  const data = (await res.json().catch(() => ({}))) as DirectInitResponse;
  if (!res.ok || !data.ok) {
    throw new Error(`TikTok direct_init falló (HTTP ${res.status}): ${data.message ?? data.error ?? "sin detalle"}.`);
  }
  return data;
}

interface ChunkRange {
  index: number;
  start: number;
  end: number; // inclusivo
  length: number;
}

// Recalcula los mismos rangos que supabase/functions/tiktok-upload/chunkPlan.ts
// a partir de chunk_size/total_chunk_count (ya devueltos por direct_init) -
// NO se reimplementa el algoritmo de decisión de chunk_size acá (eso vive
// SOLO en chunkPlan.ts/planUploadChunks - el Edge Function ya lo corrió y
// validó antes de llamar a TikTok). Esto es solo la aritmética determinista
// de límites por índice, idéntica a la del Edge Function.
function chunkRangeAt(index: number, videoSize: number, chunkSize: number, totalChunkCount: number): ChunkRange {
  const start = index * chunkSize;
  const isLast = index === totalChunkCount - 1;
  const end = isLast ? videoSize - 1 : start + chunkSize - 1;
  return { index, start, end, length: end - start + 1 };
}

async function uploadOneChunk(sessionId: string, range: ChunkRange, filePath: string): Promise<void> {
  const url = `${edgeFunctionUrl()}?action=upload_chunk&session_id=${encodeURIComponent(sessionId)}&chunk_index=${range.index}`;
  const stream = Readable.toWeb(createReadStream(filePath, { start: range.start, end: range.end })) as unknown as ReadableStream;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(range.length) },
    // @ts-expect-error -- duplex es requerido por undici para body en streaming y aún no está en los tipos de fetch (mismo patrón que youtube.ts)
    duplex: "half",
    body: stream,
  });
  if (!res.ok) {
    // Fetch SÍ devolvió una respuesta HTTP - el Edge Function contestó
    // explícitamente (aceptó o rechazó). Es un error normal, no incierto:
    // ver el comentario de publishToTikTok() para el razonamiento completo.
    const data = await res.json().catch(() => ({}));
    throw new Error(`TikTok upload_chunk falló para el chunk ${range.index} (HTTP ${res.status}): ${data.message ?? data.error ?? "sin detalle"}.`);
  }
}

type StatusResult = { status: string; failReason: string | null };

async function fetchStatus(sessionId: string): Promise<StatusResult> {
  const res = await fetch(edgeFunctionUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "status", session_id: sessionId }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string; fail_reason?: string | null; message?: string; error?: string };
  if (!res.ok || !data.ok || !data.status) {
    // Mismo criterio que uploadOneChunk: hubo respuesta HTTP explícita del
    // Edge Function - error normal, no incierto.
    throw new Error(`TikTok status falló (HTTP ${res.status}): ${data.message ?? data.error ?? "sin detalle"}.`);
  }
  return { status: data.status, failReason: data.fail_reason ?? null };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function publishToTikTok(
  post: SocialPost,
  _credentials: Record<string, string>, // deliberadamente ignorado - ver comentario de encabezado
  onOperationRef?: (ref: string) => void | Promise<void>
): Promise<PublishResult> {
  if (!post.local_file_path) {
    throw new Error("TikTok requiere post.local_file_path (entrega directa desde disco, igual que YouTube) - no está presente.");
  }
  const fileStat = statSync(post.local_file_path); // lanza si el archivo no existe/no se puede leer
  const videoSize = fileStat.size;

  // Caption: post.caption + post.hashtags, sin duplicar - misma composición
  // ya usada por Instagram/Facebook (lib/social/captionComposition.ts), no
  // se inventa una transformación nueva.
  const title = composeCaptionWithHashtags(post.caption, post.hashtags) || undefined;

  // --- direct_init ---
  let publishId: string;
  let sessionId: string;
  let chunkSize: number;
  let totalChunkCount: number;
  try {
    const initData = await callDirectInit(post.account_id, videoSize, title);
    if (!initData.publish_id || !initData.session_id || !initData.chunk_size || !initData.total_chunk_count) {
      throw new Error("TikTok direct_init respondió ok pero sin publish_id/session_id/chunk_size/total_chunk_count completos.");
    }
    publishId = initData.publish_id;
    sessionId = initData.session_id;
    chunkSize = initData.chunk_size;
    totalChunkCount = initData.total_chunk_count;
  } catch (err) {
    // Todavía NO existe ningún publish_id - un fallo acá (de red o HTTP) es
    // seguro de reintentar normalmente, ninguna operación externa se creó.
    throw err instanceof Error ? err : new Error(String(err));
  }

  // --- operation ref: CRÍTICO, antes de subir ningún chunk (ver tarea §7) ---
  // TikTok YA creó la operación (publish_id real) en cuanto direct_init tuvo
  // éxito. Si onOperationRef() falla (persistencia a Supabase, por ejemplo),
  // NUNCA se debe tratar como "seguro reintentar" - eso crearía un SEGUNDO
  // direct_init (un segundo Direct Post real) sobre el mismo post. Se
  // convierte explícitamente en PublicationOutcomeUncertainError, a
  // diferencia de publishToYouTube() (que no envuelve este callback) -
  // decisión deliberada y específica de TikTok, pedida explícitamente.
  if (onOperationRef) {
    try {
      await onOperationRef(publishId);
    } catch (err) {
      throw new PublicationOutcomeUncertainError(
        `direct_init de TikTok ya creó publish_id=${publishId}, pero no se pudo persistir la referencia de operación - no se reintenta automáticamente para evitar un segundo Direct Post: ${err instanceof Error ? err.message : String(err)}`,
        { platform: "tiktok", operationRef: publishId, originalError: err }
      );
    }
  }

  // --- upload por chunks, streaming desde disco ---
  for (let i = 0; i < totalChunkCount; i++) {
    const range = chunkRangeAt(i, videoSize, chunkSize, totalChunkCount);
    try {
      await uploadOneChunk(sessionId, range, post.local_file_path);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("TikTok upload_chunk falló")) {
        // Error HTTP EXPLÍCITO del Edge Function (fetch() sí devolvió una
        // respuesta) - se trata como error normal, tal como pide la tarea.
        throw err;
      }
      // fetch() en sí lanzó (red/timeout/conexión perdida) - ya existe un
      // publish_id real y pudimos haber enviado parte de este chunk; no se
      // puede afirmar que TikTok no lo haya recibido. Incierto, nunca un
      // reintento automático que dispare otro direct_init.
      throw new PublicationOutcomeUncertainError(
        `Fallo de red subiendo el chunk ${i + 1}/${totalChunkCount} a TikTok (publish_id=${publishId}) - no se puede confirmar si se recibió: ${err instanceof Error ? err.message : String(err)}`,
        { platform: "tiktok", operationRef: publishId, originalError: err }
      );
    }
  }

  // --- polling de status ---
  const deadline = Date.now() + STATUS_POLL_TIMEOUT_MS;
  for (;;) {
    let result: StatusResult;
    try {
      result = await fetchStatus(sessionId);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("TikTok status falló")) {
        // Falló, pero los chunks YA se subieron con éxito - no reintentar
        // automáticamente creando un nuevo direct_init tampoco acá.
        throw new PublicationOutcomeUncertainError(
          `No se pudo consultar el status final de TikTok (publish_id=${publishId}) tras subir todos los chunks: ${err.message}`,
          { platform: "tiktok", operationRef: publishId, originalError: err }
        );
      }
      throw new PublicationOutcomeUncertainError(
        `Fallo de red consultando el status de TikTok (publish_id=${publishId}): ${err instanceof Error ? err.message : String(err)}`,
        { platform: "tiktok", operationRef: publishId, originalError: err }
      );
    }

    if (result.status === "PUBLISH_COMPLETE") {
      return { externalPostId: publishId };
    }
    if (result.status === "FAILED") {
      throw new Error(`TikTok rechazó la publicación (publish_id=${publishId}): ${result.failReason ?? "sin fail_reason reportado"}.`);
    }
    if (Date.now() >= deadline) {
      // Timeout alcanzado mientras TikTok todavía podía estar procesando -
      // la publicación pudo completarse después de este punto. Incierto,
      // requiere reconciliación manual, nunca un reintento automático.
      throw new PublicationOutcomeUncertainError(
        `Timeout esperando el status final de TikTok (publish_id=${publishId}, último status conocido: ${result.status}) - la publicación puede completarse igual más tarde.`,
        { platform: "tiktok", operationRef: publishId }
      );
    }
    await sleep(STATUS_POLL_INTERVAL_MS);
  }
}
