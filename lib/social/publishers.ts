import { publishToYouTube } from "./youtube";
import { publishToFacebook } from "./facebook";
import { publishToInstagram } from "./instagram";
import { publishToTikTok } from "./tiktok";
import type { PublishResult, SocialPlatform, SocialPost } from "./types";

// Fase 5.4 — onOperationRef es OPCIONAL y aditivo: reporta una referencia de
// operación real (uploadUrl de YouTube, creationId de Instagram) en cuanto el
// publisher la obtiene, ANTES de terminar — es lo que permite persistirla y
// poder reconciliar si el proceso muere a mitad de publicar (ver
// agent/publish/reconciliation.mts). Ningún publisher existente rompe su
// firma por esto: los que no tienen una referencia intermedia (Facebook)
// simplemente nunca llaman al callback.
export type OperationRefCallback = (ref: string) => void | Promise<void>;
type Publisher = (post: SocialPost, credentials: Record<string, string>, onOperationRef?: OperationRefCallback) => Promise<PublishResult>;

// Registro único de "cómo se publica en cada plataforma". Añadir una nueva es
// implementar su publishToX (recibe credenciales genéricas) y sumarla aquí.
// TikTok — Direct Post real vía la Edge Function tiktok-upload (acción
// direct_init). credentials se ignora a propósito: el Edge Function resuelve
// access_token/refresh_token internamente desde social_accounts por
// account_id, nunca desde Agent 3 (ver lib/social/tiktok.ts, comentario de
// encabezado, y lib/social/credentialFields.ts: tiktok: []).
export const PUBLISHERS: Partial<Record<SocialPlatform, Publisher>> = {
  youtube: (post, creds, onOperationRef) => publishToYouTube(post, creds as never, onOperationRef),
  facebook: (post, creds) => publishToFacebook(post, creds as never),
  instagram: (post, creds, onOperationRef) => publishToInstagram(post, creds as never, onOperationRef),
  tiktok: (post, creds, onOperationRef) => publishToTikTok(post, creds, onOperationRef),
};
