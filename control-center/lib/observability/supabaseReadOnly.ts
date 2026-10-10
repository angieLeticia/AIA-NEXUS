// Dedicated Supabase client for the observability layer. SECURITY INVARIANTS:
//   1. Every query in this file lists explicit columns — grep this file for
//      `select("*")` or `select('*')`; if that ever matches, it's a bug.
//   2. social_accounts.credentials is NEVER selected here, under any alias,
//      in any function. Only non-secret columns (id, platform, channel_id,
//      is_active) are read from that table.
//   3. This module only ever calls .select(...) — no .insert/.update/.upsert
//      /.delete is defined anywhere below, and none should ever be added.
// Server-only: imported exclusively from app/api/** route handlers, never
// from a "use client" component (the service-role key must never reach the
// browser bundle).
import "server-only";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from control-center/.env.local");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export interface ContentAccountRow {
  id: string;
  folder_name: string;
  channel_id: string;
  channel_status: string;
  is_active: boolean;
}

export async function getContentAccounts(): Promise<ContentAccountRow[]> {
  const { data, error } = await supabase
    .from("content_accounts")
    .select("id, folder_name, channel_id, channel_status, is_active");
  if (error) throw new Error(`getContentAccounts: ${error.message}`);
  return data ?? [];
}

export interface ContentFileRow {
  id: string;
  content_account_id: string;
  file_path: string;
  file_hash: string;
  episode_id: string | null;
  folder_type: string;
  status: string;
  detected_at: string;
  error_message: string | null;
}

export async function getContentFiles(limit = 500): Promise<ContentFileRow[]> {
  const { data, error } = await supabase
    .from("content_files")
    .select("id, content_account_id, file_path, file_hash, episode_id, folder_type, status, detected_at, error_message")
    .order("detected_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getContentFiles: ${error.message}`);
  return data ?? [];
}

export interface ContentMetadataRow {
  id: string;
  content_file_id: string;
  status: string;
  retry_count: number;
  created_at: string;
}

export async function getContentMetadata(limit = 500): Promise<ContentMetadataRow[]> {
  const { data, error } = await supabase
    .from("content_metadata")
    .select("id, content_file_id, status, retry_count, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getContentMetadata: ${error.message}`);
  return data ?? [];
}

export interface SocialAccountRow {
  id: string;
  platform: string;
  channel_id: string;
  is_active: boolean;
}

// credentials is INTENTIONALLY absent from this select list — see file header.
export async function getSocialAccounts(): Promise<SocialAccountRow[]> {
  const { data, error } = await supabase.from("social_accounts").select("id, platform, channel_id, is_active");
  if (error) throw new Error(`getSocialAccounts: ${error.message}`);
  return data ?? [];
}

export interface SocialPostRow {
  id: string;
  status: string;
  account_id: string;
  content_file_id: string | null;
  scheduled_at: string;
  claimed_at: string | null;
  external_post_id: string | null;
  publisher_operation_ref: string | null;
  publication_authorized_at: string | null;
  publication_authorized_by: string | null;
  published_at: string | null;
  error_message: string | null;
  retry_count: number;
}

export async function getSocialPosts(limit = 1000): Promise<SocialPostRow[]> {
  const { data, error } = await supabase
    .from("social_posts")
    .select(
      "id, status, account_id, content_file_id, scheduled_at, claimed_at, external_post_id, publisher_operation_ref, publication_authorized_at, publication_authorized_by, published_at, error_message, retry_count"
    )
    .order("scheduled_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getSocialPosts: ${error.message}`);
  return data ?? [];
}

export async function getSocialPostById(id: string): Promise<SocialPostRow | null> {
  const { data, error } = await supabase
    .from("social_posts")
    .select(
      "id, status, account_id, content_file_id, scheduled_at, claimed_at, external_post_id, publisher_operation_ref, publication_authorized_at, publication_authorized_by, published_at, error_message, retry_count"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getSocialPostById: ${error.message}`);
  return data ?? null;
}

export interface ContentFileConflictRow {
  id: string;
  file_hash: string;
  original_content_file_id: string;
  conflicting_account_id: string;
  conflicting_file_path: string;
  resolved: boolean;
}

export async function getContentFileConflicts(): Promise<ContentFileConflictRow[]> {
  const { data, error } = await supabase
    .from("content_file_conflicts")
    .select("id, file_hash, original_content_file_id, conflicting_account_id, conflicting_file_path, resolved");
  if (error) throw new Error(`getContentFileConflicts: ${error.message}`);
  return data ?? [];
}

export async function getContentFileById(id: string): Promise<ContentFileRow | null> {
  const { data, error } = await supabase
    .from("content_files")
    .select("id, content_account_id, file_path, file_hash, episode_id, folder_type, status, detected_at, error_message")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getContentFileById: ${error.message}`);
  return data ?? null;
}

export async function getContentMetadataByFileId(contentFileId: string): Promise<ContentMetadataRow | null> {
  const { data, error } = await supabase
    .from("content_metadata")
    .select("id, content_file_id, status, retry_count, created_at")
    .eq("content_file_id", contentFileId)
    .maybeSingle();
  if (error) throw new Error(`getContentMetadataByFileId: ${error.message}`);
  return data ?? null;
}

export async function searchContentFilesByPath(query: string, limit = 25): Promise<ContentFileRow[]> {
  const { data, error } = await supabase
    .from("content_files")
    .select("id, content_account_id, file_path, file_hash, episode_id, folder_type, status, detected_at, error_message")
    .ilike("file_path", `%${query}%`)
    .limit(limit);
  if (error) throw new Error(`searchContentFilesByPath: ${error.message}`);
  return data ?? [];
}
