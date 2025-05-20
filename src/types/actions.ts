import { AppError } from "@/lib/errors";

export interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: AppError;
}

export interface SubscriptionResponse {
  url: string;
}

export interface VideoLimitResponse {
  canGenerate: boolean;
}
