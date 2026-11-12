import { supabaseAdmin } from "../config/supabase";
import { activityDetail, fillPreviousChanges, summarizeActivity } from "./log.service";
import { assertNoError } from "../utils/errors";

export async function listActivity(options: { propertyId?: string; limit: number }) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 365);
  let request = supabaseAdmin
    .from("activity_logs")
    .select("id, action, entity_type, entity_id, metadata, created_at, actor:profiles(full_name, email), property:properties(name)")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(options.limit);
  if (options.propertyId) request = request.eq("property_id", options.propertyId);
  const { data, error } = await request;
  assertNoError(error);
  return fillPreviousChanges(data ?? []).map((row) => ({
    ...row,
    summary: summarizeActivity(row.action, (row.metadata ?? {}) as Record<string, unknown>),
    detail: activityDetail(row.action, (row.metadata ?? {}) as Record<string, unknown>),
  }));
}
