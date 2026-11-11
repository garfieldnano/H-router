import { cookies } from "next/headers";
import {
  getDashboardAuthSession,
  getSessionRole,
} from "@/lib/auth/dashboardSession";

/**
 * Returns the dashboard session payload when the caller is a member session
 * (JWT role "member"), otherwise null. Route handlers use this to scope data
 * to the caller's memberId — a member must never see another member's data.
 */
export async function getRequestMemberSession() {
  const cookieStore = await cookies();
  const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
  return getSessionRole(session) === "member" ? session : null;
}
