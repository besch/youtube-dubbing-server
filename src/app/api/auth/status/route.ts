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
      data: { session },
    } = await supabase.auth.getSession();

    return NextResponse.json({
      success: true,
      data: {
        isAuthenticated: !!session?.user,
      },
    });
  } catch (error) {
    console.error("Auth status check error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to check authentication status",
      },
      { status: 500 }
    );
  }
}
