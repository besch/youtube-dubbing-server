import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const cookieStore = cookies();
    const supabase = createClient(cookieStore);

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
