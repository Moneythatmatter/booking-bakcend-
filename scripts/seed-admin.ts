import { supabaseAdmin } from "../config/supabase";
import { env } from "../config/env";

async function main() {
  if (!env.seedAdminEmail || !env.seedAdminPassword) {
    throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in the backend environment.");
  }
  if (env.seedAdminPassword.length < 8) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 8 characters.");
  }

  const { data: listed, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
  if (listError) throw listError;
  let user = listed.users.find((item) => item.email?.toLowerCase() === env.seedAdminEmail.toLowerCase());

  if (!user) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: env.seedAdminEmail,
      password: env.seedAdminPassword,
      email_confirm: true,
      user_metadata: { full_name: "Super Admin" },
    });
    if (error || !data.user) throw error ?? new Error("Could not create the super admin.");
    user = data.user;
  }

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      email: env.seedAdminEmail,
      full_name: "Super Admin",
      platform_role: "super_admin",
      status: "active",
    })
    .eq("id", user.id);
  if (error) throw error;

  console.log(`Super admin ready: ${env.seedAdminEmail}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
