// Derives pipeline-stage counts and per-account summaries purely from
// read-only Supabase projections (supabaseReadOnly.ts). No filesystem scan of
// D:\MATERIAL VIDEOS happens here or anywhere in this app — content_files
// already mirrors everything the real Watcher has registered.
import {
  getContentAccounts,
  getContentFiles,
  getContentMetadata,
  getSocialPosts,
  type ContentFileRow,
  type ContentMetadataRow,
  type SocialPostRow,
} from "./supabaseReadOnly";
import type { AccountSummary, PipelineStageCounts } from "@/types/observability";

export interface PipelineSnapshot {
  stageCounts: PipelineStageCounts;
  accounts: AccountSummary[];
  accountNameById: Record<string, string>;
}

export async function getPipelineSnapshot(): Promise<PipelineSnapshot> {
  const [accounts, files, metadata, posts] = await Promise.all([
    getContentAccounts(),
    getContentFiles(2000),
    getContentMetadata(2000),
    getSocialPosts(5000),
  ]);

  const accountNameById = Object.fromEntries(accounts.map((a) => [a.id, a.folder_name]));
  const fileById = new Map<string, ContentFileRow>(files.map((f) => [f.id, f]));
  const metaByFileId = new Map<string, ContentMetadataRow>(metadata.map((m) => [m.content_file_id, m]));

  const stageCounts: PipelineStageCounts = {
    files: files.length,
    analyzing: 0,
    ready: 0,
    authorized: 0, // authorization is tracked per social_post, not per file — see publication_authorized_at below
    producing: 0,
    produced: 0,
    pendingPublication: 0,
    published: 0,
    errors: 0,
  };

  for (const f of files) {
    if (f.status === "analyzing") stageCounts.analyzing += 1;
    if (f.status === "invalid" || f.status === "account_conflict") stageCounts.errors += 1;
  }
  for (const m of metadata) {
    if (m.status === "ready") stageCounts.ready += 1;
    if (m.status === "error") stageCounts.errors += 1;
  }
  for (const p of posts) {
    if (p.publication_authorized_at) stageCounts.authorized += 1;
    if (p.status === "pending") stageCounts.pendingPublication += 1;
    if (p.status === "published") stageCounts.published += 1;
    if (p.status === "error") stageCounts.errors += 1;
  }

  const byAccount = new Map<string, AccountSummary>();
  for (const a of accounts) {
    byAccount.set(a.id, {
      account: a.folder_name,
      ready: 0,
      pending: 0,
      processing: 0,
      error: 0,
      authorized: 0,
      producing: 0,
      published: 0,
    });
  }

  for (const m of metadata) {
    const file = fileById.get(m.content_file_id);
    if (!file) continue;
    const summary = byAccount.get(file.content_account_id);
    if (!summary) continue;
    if (m.status === "ready") summary.ready += 1;
    if (m.status === "transcribing" || m.status === "analyzing") summary.processing += 1;
    if (m.status === "error") summary.error += 1;
  }

  for (const p of posts) {
    const file = p.content_file_id ? fileById.get(p.content_file_id) : undefined;
    if (!file) continue;
    const summary = byAccount.get(file.content_account_id);
    if (!summary) continue;
    if (p.status === "pending" && !p.publication_authorized_at) summary.pending += 1;
    if (p.publication_authorized_at) summary.authorized += 1;
    if (p.status === "published") summary.published += 1;
    if (p.status === "error") summary.error += 1;
  }

  return { stageCounts, accounts: [...byAccount.values()], accountNameById };
}

export function findSocialPostsForAccount(posts: SocialPostRow[], accountSocialAccountIds: Set<string>): SocialPostRow[] {
  return posts.filter((p) => accountSocialAccountIds.has(p.account_id));
}
