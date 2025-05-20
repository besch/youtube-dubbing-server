import { Metadata } from "next";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { UserProfile } from "@/components/user/user-profile";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Profile",
  description: "Manage your account settings and subscription",
};

export default async function ProfilePage() {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          cookieStore.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (!user || userError) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return (
      <div className="container py-10">
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-medium">Profile</h3>
            <p className="text-sm text-muted-foreground">
              Loading your profile...
            </p>
          </div>
          <div className="space-y-4">
            <Skeleton className="h-[200px] w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-10">
      <UserProfile profile={profile} />
    </div>
  );
}
