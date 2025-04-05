import { NextResponse } from "next/server";
import { deleteAccountAction } from "@/app/actions/account/deleteAccountAction";

export async function POST(request: Request) {
  try {
    // No input parsing needed as the action schema is empty
    const result = await deleteAccountAction({});
    return NextResponse.json(result);
  } catch (error) {
    // This catch block might be redundant if the safe action client handles errors,
    // but it's good practice for unhandled exceptions during action invocation itself.
    console.error("[API /api/actions/account/deleteAccount] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "UNEXPECTED_ERROR",
          message: "An unexpected server error occurred.",
        },
      },
      { status: 500 }
    );
  }
}
