import { AppError } from "@/lib/errors";

export interface ActionError {
  message: string;
  code: string;
}

export interface ActionResponse<T = void> {
  success: boolean;
  data?: T;
  error?: ActionError;
}

export interface SubscriptionResponse {
  url: string;
}

export interface VideoLimitResponse {
  canGenerate: boolean;
}
