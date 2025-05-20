import { Metadata } from "next";
import { createServerClient } from "@/lib/supabase";
import { UserProfile } from "@/components/user/user-profile";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Profile",
  description: "Manage your account settings and subscription",
};

export default async function ProfilePage() {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    redirect("/login");
  }

  return <UserProfile profile={profile} />;
}
