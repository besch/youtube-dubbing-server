import { NextRequest, NextResponse } from "next/server";
import * as videoInternalActions from "@/app/actions/videoInternal"; // Import internal actions
import { z } from "zod";

const SUPABASE_FUNCTION_SECRET = process.env.SUPABASE_FUNCTION_SECRET;

// Define a schema for the expected request body
const triggerActionSchema = z.object({
  actionName: z.string(), // Name of the action function in video.ts
  payload: z.any(), // The payload expected by the action
});

// Define a type for the actions map
type ActionMap = {
  // Adjust the action function signature if needed - internal actions don't have ctx
  [key: string]: (payload: any) => Promise<any>;
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
  // Use the imported internal actions
  const actions: ActionMap = videoInternalActions as any; // Cast to ActionMap
  const actionFunction = actions[actionName];

  if (typeof actionFunction !== "function") {
    console.error(
      `Internal API Error: Action '${actionName}' not found or not a function in internal actions.`
    );
    return new NextResponse(
      JSON.stringify({
        error: `Action '${actionName}' not found in internal actions`,
      }),
      {
        status: 404, // Not Found
      }
    );
  }

  // 4. Execute the Action
  console.log(
    `Executing internal action: ${actionName} with payload:`,
    JSON.stringify(payload, null, 2) // Stringify payload for better logging
  );
  try {
    // Call the internal action function directly
    const result = await actionFunction(payload);

    // The result should be in the ActionResponse format { success: boolean, data?: T, error?: AppErrorJSON }
    // Always return 200 OK, and let the caller check the `success` flag in the body.
    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    // This catch block might be less likely to be hit if actions handle errors internally,
    // but it's good for catching unexpected issues during the call itself.
    console.error(
      `Internal API Error during execution of action '${actionName}':`,
      error
    );
    // Return a generic 500 error
    return new NextResponse(
      JSON.stringify({
        error: `Unexpected error executing action '${actionName}'`,
        details: error.message, // Include error message if available
      }),
      {
        status: 500,
      }
    );
  }
}
