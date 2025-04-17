import { NextRequest, NextResponse } from "next/server";
import * as videoActions from "@/app/actions/video"; // Import all actions
import { z } from "zod";

const SUPABASE_FUNCTION_SECRET = process.env.SUPABASE_FUNCTION_SECRET;

// Define a schema for the expected request body
const triggerActionSchema = z.object({
  actionName: z.string(), // Name of the action function in video.ts
  payload: z.any(), // The payload expected by the action
});

// Define a type for the actions map
type ActionMap = {
  [key: string]: (payload: any) => Promise<any>; // Adjust the action function signature if needed
};

export async function POST(request: NextRequest) {
  // 1. Authentication: Verify the secret from the Supabase Function
  const authorization = request.headers.get("Authorization");
  if (authorization !== `Bearer ${SUPABASE_FUNCTION_SECRET}`) {
    console.error("Unauthorized internal API call attempt");
    return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  // 2. Parse and Validate Request Body
  let parsedBody;
  try {
    const body = await request.json();
    parsedBody = triggerActionSchema.safeParse(body);

    if (!parsedBody.success) {
      console.error(
        "Invalid internal API request body:",
        parsedBody.error.issues
      );
      return new NextResponse(
        JSON.stringify({
          error: "Invalid request body",
          details: parsedBody.error.issues,
        }),
        {
          status: 400,
        }
      );
    }
  } catch (error) {
    console.error("Error parsing internal API request body:", error);
    return new NextResponse(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
    });
  }

  const { actionName, payload } = parsedBody.data;

  // 3. Map Action Name to Function
  // Ensure the action name exists in our imported actions
  const actions: ActionMap = videoActions as any; // Cast to ActionMap, ensure keys match exported function names
  const actionFunction = actions[actionName];

  if (typeof actionFunction !== "function") {
    console.error(
      `Internal API Error: Action '${actionName}' not found or not a function.`
    );
    return new NextResponse(
      JSON.stringify({ error: `Action '${actionName}' not found` }),
      {
        status: 404, // Not Found
      }
    );
  }

  // 4. Execute the Action
  console.log(
    `Executing internal action: ${actionName} with payload:`,
    payload
  );
  try {
    // Note: These actions originally used next-safe-action.
    // Calling them directly bypasses the safe-action client setup (middleware, input schema validation within safe-action).
    // We are relying on the Supabase Function to provide the correct payload structure.
    // We might need to adapt the actions slightly or add validation here if necessary.
    const result = await actionFunction(payload);

    // The result might be in the ActionResponse format { success: boolean, data?: T, error?: AppError }
    // Or it might be the direct return value if the action wasn't originally a safe-action.
    // We return the entire result object.
    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    console.error(
      `Internal API Error executing action '${actionName}':`,
      error
    );
    return new NextResponse(
      JSON.stringify({
        error: `Failed to execute action '${actionName}'`,
        details: error.message,
      }),
      {
        status: 500,
      }
    );
  }
}
