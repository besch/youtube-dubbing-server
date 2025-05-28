import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// Force this route to be dynamic since it uses cookies
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cookieStore = cookies();
    const supabase: SupabaseClient = createClient(cookieStore);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized",
        },
        { status: 401 }
      );
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json(
        {
          success: false,
          error: "Profile not found",
        },
        { status: 404 }
      );
    }

    const isPremium = profile.subscription_status === "premium";

    if (isPremium) {
      return NextResponse.json({
        success: true,
        data: {
          canProcess: true,
          remainingVideos: Infinity,
          isPremium: true,
        },
      });
    }

    const { data: videos } = await supabase
      .from("daily_video_limits")
      .select("created_at")
      .eq("user_id", user.id)
      .gte("created_at", new Date().toISOString().split("T")[0])
      .order("created_at", { ascending: false });

    const dailyVideoCount = videos?.length ?? 0;
    const canProcess = dailyVideoCount < 3;

    return NextResponse.json({
      success: true,
      data: {
        canProcess,
        dailyVideoCount,
        remainingVideos: Math.max(0, 3 - dailyVideoCount),
        isPremium: false,
      },
    });
  } catch (error) {
    console.error("Video limit check error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to check video limits",
      },
      { status: 500 }
    );
  }
}
