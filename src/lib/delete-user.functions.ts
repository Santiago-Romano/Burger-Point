import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const deleteUserAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    if (data.userId === context.userId) {
      return { success: false as const, reason: "self" as const };
    }

    try {
      const { data: callerIsAdmin, error: callerRoleError } = await context.supabase.rpc(
        "has_role",
        { _user_id: context.userId, _role: "admin" },
      );
      if (callerRoleError || !callerIsAdmin) {
        return { success: false as const, reason: "forbidden" as const };
      }

      const { data: targetIsAdmin, error: targetRoleError } = await context.supabase.rpc(
        "has_role",
        { _user_id: data.userId, _role: "admin" },
      );
      if (targetRoleError) {
        return { success: false as const, reason: "server" as const };
      }
      if (targetIsAdmin) {
        return { success: false as const, reason: "remove_admin_role_first" as const };
      }

      if (!process.env["SUPABASE_URL"] || !process.env["SUPABASE_SERVICE_ROLE_KEY"]) {
        return { success: false as const, reason: "configuration" as const };
      }

      // This key is loaded only inside the server handler and is never sent to the browser.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: target, error: lookupError } = await supabaseAdmin.auth.admin.getUserById(
        data.userId,
      );
      if (lookupError || !target.user) {
        return { success: false as const, reason: "not_found" as const };
      }

      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
      if (deleteError) {
        const message = deleteError.message.toLowerCase();
        return {
          success: false as const,
          reason:
            message.includes("storage") || message.includes("object")
              ? ("storage_objects" as const)
              : ("server" as const),
        };
      }

      return { success: true as const };
    } catch (error) {
      console.error("[delete-user] Failed to delete an account", error);
      return { success: false as const, reason: "server" as const };
    }
  });
