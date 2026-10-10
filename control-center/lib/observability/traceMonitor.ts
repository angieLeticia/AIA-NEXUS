// Reconstructs a timeline for a file/episode/post from real evidence only.
// Every TraceEvent carries its source (SUPABASE/MANIFEST/LOG/...) so the UI
// can visually distinguish confirmed evidence from inference — never present
// a guess as a fact.
import {
  getContentAccounts,
  getContentFiles,
  getContentMetadata,
  getSocialAccounts,
  getSocialPosts,
  type SocialPostRow,
} from "./supabaseReadOnly";
import type { TraceEvent, TraceResult } from "@/types/observability";

function norm(s: string): string {
  return s.toLowerCase().trim();
}

export async function runTrace(query: string): Promise<TraceResult> {
  const q = norm(query);
  const [accounts, files, metadata, socialAccounts, posts] = await Promise.all([
    getContentAccounts(),
    getContentFiles(3000),
    getContentMetadata(3000),
    getSocialAccounts(),
    getSocialPosts(5000),
  ]);

  const accountNameById = Object.fromEntries(accounts.map((a) => [a.id, a.folder_name]));
  const platformByAccountId = Object.fromEntries(socialAccounts.map((a) => [a.id, a.platform]));

  // Resolution order: exact content_file_id / content_metadata_id / social_post_id /
  // external_post_id match first (unambiguous), then fall back to filename substring.
  let matchedFile = files.find((f) => f.id === query);
  let matchedPost = posts.find((p) => p.id === query || p.external_post_id === query);
  let matchedMeta = metadata.find((m) => m.id === query);

  if (!matchedFile && matchedMeta) matchedFile = files.find((f) => f.id === matchedMeta!.content_file_id);
  if (!matchedFile && matchedPost) matchedFile = files.find((f) => f.id === matchedPost!.content_file_id);

  if (!matchedFile) {
    matchedFile = files.find((f) => norm(f.file_path).includes(q));
  }

  if (!matchedFile) {
    return { query, matched: {}, timeline: [{ stage: "SEARCH", status: "UNKNOWN", timestamp: null, source: "SUPABASE", detail: "No content_file matched this query." }] };
  }

  if (!matchedMeta) matchedMeta = metadata.find((m) => m.content_file_id === matchedFile!.id);
  const relatedPosts = posts.filter((p) => p.content_file_id === matchedFile!.id);

  const timeline: TraceEvent[] = [];

  timeline.push({
    stage: "FILE DETECTED",
    status: "DONE",
    timestamp: matchedFile.detected_at,
    source: "SUPABASE",
    detail: `${matchedFile.file_path} (content_files.id=${matchedFile.id})`,
  });

  timeline.push({
    stage: "WATCHER → CONTENT_FILE",
    status: "DONE",
    timestamp: matchedFile.detected_at,
    source: "SUPABASE",
    detail: `status=${matchedFile.status}, episode_id=${matchedFile.episode_id ?? "null"}, folder_type=${matchedFile.folder_type}`,
  });

  if (matchedMeta) {
    timeline.push({
      stage: "AGENT 1 / WHISPER + OLLAMA",
      status: matchedMeta.status === "ready" ? "DONE" : matchedMeta.status === "error" ? "ERROR" : "IN_PROGRESS",
      timestamp: matchedMeta.created_at,
      source: "SUPABASE",
      detail: `content_metadata.id=${matchedMeta.id}, status=${matchedMeta.status}, retry_count=${matchedMeta.retry_count}`,
    });
    timeline.push({
      stage: "CONTENT_METADATA READY",
      status: matchedMeta.status === "ready" ? "DONE" : "PENDING",
      timestamp: matchedMeta.status === "ready" ? matchedMeta.created_at : null,
      source: "SUPABASE",
      detail: null,
    });
  } else {
    timeline.push({ stage: "AGENT 1 / WHISPER + OLLAMA", status: "PENDING", timestamp: null, source: "SUPABASE", detail: "No content_metadata row yet." });
  }

  if (relatedPosts.length > 0) {
    timeline.push({
      stage: "SCHEDULER → SOCIAL_POSTS",
      status: "DONE",
      timestamp: relatedPosts[0].scheduled_at,
      source: "SUPABASE",
      detail: `${relatedPosts.length} social_post(s) created`,
    });
    for (const post of relatedPosts) {
      const platform = platformByAccountId[post.account_id] ?? "unknown";
      timeline.push({
        stage: `AUTHORIZATION (${platform})`,
        status: post.publication_authorized_at ? "DONE" : "PENDING",
        timestamp: post.publication_authorized_at,
        source: "SUPABASE",
        detail: post.publication_authorized_at ? `by ${post.publication_authorized_by}` : "Not yet authorized",
      });
      timeline.push({
        stage: `PUBLISHER → ${platform.toUpperCase()}`,
        status: post.status === "published" ? "DONE" : post.status === "error" ? "ERROR" : post.status === "publishing" ? "IN_PROGRESS" : "PENDING",
        timestamp: post.published_at,
        source: "SUPABASE",
        detail: post.external_post_id ? `external_post_id=${post.external_post_id}` : post.error_message,
      });
    }
  } else {
    timeline.push({ stage: "SCHEDULER → SOCIAL_POSTS", status: "PENDING", timestamp: null, source: "SUPABASE", detail: "No social_posts yet." });
  }

  return {
    query,
    matched: {
      contentFileId: matchedFile.id,
      contentMetadataId: matchedMeta?.id,
      socialPostIds: relatedPosts.map((p) => p.id),
      account: accountNameById[matchedFile.content_account_id],
      episode: matchedFile.episode_id ?? undefined,
      filePath: matchedFile.file_path,
    },
    timeline,
  };
}

export function _internalRelatedPosts(posts: SocialPostRow[], contentFileId: string): SocialPostRow[] {
  return posts.filter((p) => p.content_file_id === contentFileId);
}
